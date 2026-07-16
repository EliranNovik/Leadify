const crypto = require('crypto');
const supabase = require('../config/supabase');

const DEFAULT_SESSION_TTL_MINUTES = 10;

function sessionTtlMinutes() {
  const n = Number(process.env.KIOSK_DISPLAY_SESSION_TTL_MINUTES || DEFAULT_SESSION_TTL_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : DEFAULT_SESSION_TTL_MINUTES;
}

async function ensureContractPublicToken(contractId) {
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('id, public_token')
    .eq('id', contractId)
    .maybeSingle();

  if (error) throw error;
  if (!contract) {
    const err = new Error('Contract not found');
    err.statusCode = 404;
    throw err;
  }

  let publicToken = contract.public_token;
  if (!publicToken) {
    publicToken = crypto.randomUUID();
    const { error: updateError } = await supabase
      .from('contracts')
      .update({ public_token: publicToken })
      .eq('id', contractId);
    if (updateError) throw updateError;
  }

  return { resourceId: String(contract.id), resourceToken: publicToken };
}

async function resolvePoaCredentials(poaIdOrToken) {
  const raw = String(poaIdOrToken || '').trim();
  if (!raw) {
    const err = new Error('POA id or token required');
    err.statusCode = 400;
    throw err;
  }

  const byId = await supabase
    .from('poa_documents')
    .select('id, secure_token')
    .eq('id', raw)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return { resourceId: String(byId.data.id), resourceToken: byId.data.secure_token };
  }

  const byToken = await supabase
    .from('poa_documents')
    .select('id, secure_token')
    .eq('secure_token', raw)
    .maybeSingle();

  if (byToken.error) throw byToken.error;
  if (!byToken.data) {
    const err = new Error('POA not found');
    err.statusCode = 404;
    throw err;
  }

  return { resourceId: String(byToken.data.id), resourceToken: byToken.data.secure_token };
}

async function resolvePaymentCredentials(paymentTokenOrId) {
  const raw = String(paymentTokenOrId || '').trim();
  if (!raw) {
    const err = new Error('Payment link token required');
    err.statusCode = 400;
    throw err;
  }

  const { data: byToken, error: tokenError } = await supabase
    .from('payment_links')
    .select('id, secure_token')
    .eq('secure_token', raw)
    .maybeSingle();

  if (tokenError) throw tokenError;
  if (byToken) {
    return { resourceId: String(byToken.id), resourceToken: byToken.secure_token };
  }

  const { data: byId, error: idError } = await supabase
    .from('payment_links')
    .select('id, secure_token')
    .eq('id', raw)
    .maybeSingle();

  if (idError) throw idError;
  if (!byId) {
    const err = new Error('Payment link not found');
    err.statusCode = 404;
    throw err;
  }

  return { resourceId: String(byId.id), resourceToken: byId.secure_token };
}

async function resolveResourceCredentials(resourceType, resourceId, resourceToken) {
  const type = String(resourceType || '').trim();
  if (type === 'digital_contract') {
    return ensureContractPublicToken(resourceId);
  }
  if (type === 'poa') {
    return resolvePoaCredentials(resourceToken || resourceId);
  }
  if (type === 'payment') {
    return resolvePaymentCredentials(resourceToken || resourceId);
  }
  const err = new Error(`Unsupported resource type: ${type}`);
  err.statusCode = 400;
  throw err;
}

async function expireStaleSessions() {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('kiosk_display_sessions')
    .update({ status: 'expired' })
    .in('status', ['pending', 'active'])
    .lt('expires_at', now);

  if (error) throw error;
}

async function cancelActiveSessionsForDevice(kioskDeviceId, cancelledBy = null) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('kiosk_display_sessions')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: cancelledBy,
    })
    .eq('kiosk_device_id', kioskDeviceId)
    .in('status', ['pending', 'active']);

  if (error) throw error;
}

async function createDisplaySession({
  kioskDeviceId,
  resourceType,
  resourceId,
  resourceToken,
  requestedBy,
  allowedActions,
}) {
  await expireStaleSessions();

  const resolved = await resolveResourceCredentials(resourceType, resourceId, resourceToken);
  const ttlMin = sessionTtlMinutes();
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await cancelActiveSessionsForDevice(kioskDeviceId, requestedBy);

  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .insert({
      kiosk_device_id: kioskDeviceId,
      resource_type: resourceType,
      resource_id: resolved.resourceId,
      resource_token: resolved.resourceToken,
      status: 'pending',
      allowed_actions: allowedActions || ['view', 'complete'],
      expires_at: expiresAt,
      requested_by: requestedBy || null,
    })
    .select(
      'id, kiosk_device_id, resource_type, resource_id, status, allowed_actions, expires_at, created_at',
    )
    .single();

  if (error) throw error;
  console.info('[kiosk-audit] display_session_created', {
    sessionId: data.id,
    kioskDeviceId,
    resourceType,
    resourceId: resolved.resourceId,
    requestedBy,
    expiresAt,
  });
  return data;
}

async function getSessionById(sessionId) {
  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function activateSession(session) {
  if (session.status === 'active') return session;
  if (session.status !== 'pending') return session;

  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', session.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getActiveSessionForDevice(kioskDeviceId) {
  await expireStaleSessions();

  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .select(
      'id, kiosk_device_id, resource_type, resource_id, status, allowed_actions, expires_at, created_at, activated_at',
    )
    .eq('kiosk_device_id', kioskDeviceId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getSessionAccess(sessionId, kioskDeviceId) {
  await expireStaleSessions();

  const session = await getSessionById(sessionId);
  if (!session || session.kiosk_device_id !== kioskDeviceId) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  if (session.status === 'cancelled' || session.status === 'expired' || session.status === 'completed') {
    const err = new Error('Session is no longer active');
    err.statusCode = 410;
    throw err;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await supabase.from('kiosk_display_sessions').update({ status: 'expired' }).eq('id', session.id);
    const err = new Error('Session expired');
    err.statusCode = 410;
    throw err;
  }

  const active = await activateSession(session);

  return {
    sessionId: active.id,
    resourceType: active.resource_type,
    resourceId: active.resource_id,
    resourceToken: active.resource_token,
    allowedActions: active.allowed_actions || ['view', 'complete'],
    expiresAt: active.expires_at,
  };
}

async function completeSession(sessionId, kioskDeviceId) {
  const session = await getSessionById(sessionId);
  if (!session || session.kiosk_device_id !== kioskDeviceId) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select('id, status, completed_at')
    .single();

  if (error) throw error;
  console.info('[kiosk-audit] display_session_completed', {
    sessionId,
    kioskDeviceId,
    resourceType: session.resource_type,
    resourceId: session.resource_id,
    requestedBy: session.requested_by,
  });
  return data;
}

async function cancelSession(sessionId, { kioskDeviceId, cancelledBy } = {}) {
  const session = await getSessionById(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  if (kioskDeviceId && session.kiosk_device_id !== kioskDeviceId) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('kiosk_display_sessions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy || null,
    })
    .eq('id', sessionId)
    .select('id, status, cancelled_at')
    .single();

  if (error) throw error;
  console.info('[kiosk-audit] display_session_cancelled', {
    sessionId,
    kioskDeviceId: kioskDeviceId || session.kiosk_device_id,
    resourceType: session.resource_type,
    resourceId: session.resource_id,
    cancelledBy,
    requestedBy: session.requested_by,
  });
  return data;
}

async function getDeviceState(kioskDevice) {
  if (!kioskDevice || kioskDevice.status === 'revoked') {
    return { mode: 'locked' };
  }

  await expireStaleSessions();
  const session = await getActiveSessionForDevice(kioskDevice.id);

  if (session) {
    return {
      mode: 'document',
      sessionId: session.id,
      resourceType: session.resource_type,
      expiresAt: session.expires_at,
    };
  }

  return { mode: 'attendance', device: { id: kioskDevice.id, name: kioskDevice.name, slug: kioskDevice.slug } };
}

module.exports = {
  createDisplaySession,
  getSessionAccess,
  completeSession,
  cancelSession,
  cancelActiveSessionsForDevice,
  getActiveSessionForDevice,
  getDeviceState,
  expireStaleSessions,
  resolveResourceCredentials,
};
