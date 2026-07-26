const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { PKPass } = require('passkit-generator');
const supabase = require('../config/supabase');

const FIRM_NAME = 'Decker, Pex, Levi Law Offices';
const OFFICE_ADDRESS = 'Menachem Begin Rd. 11, Ramat Gan, Israel';
const OFFICE_LABEL = 'Tel Aviv Office';
const PASS_MODEL_DIR = path.join(__dirname, '../../passModels/businessCard.pass');
const LOCAL_WWDR_PATH = path.join(__dirname, '../../certs/AppleWWDRCAG4.pem');

function normalizePem(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\\n/g, '\n').trim();
}

function readOptionalFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  } catch {
    // ignore
  }
  return null;
}

function getPublicAppOrigin() {
  return (
    process.env.CRM_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}

function buildCardUrl(employeeId) {
  return `${getPublicAppOrigin()}/business-card/${employeeId}`;
}

function splitName(officialName) {
  const parts = String(officialName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first: 'Employee', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function appleConfig() {
  const passTypeIdentifier = (process.env.APPLE_PASS_TYPE_ID || '').trim();
  const teamIdentifier = (process.env.APPLE_TEAM_ID || '').trim();
  const signerCert = normalizePem(process.env.APPLE_PASS_CERT_PEM);
  const signerKey = normalizePem(process.env.APPLE_PASS_KEY_PEM);
  const signerKeyPassphrase = process.env.APPLE_PASS_KEY_PASSPHRASE || undefined;
  const wwdrFromEnv = normalizePem(process.env.APPLE_WWDR_CERT_PEM);
  const wwdrFromFile = readOptionalFile(process.env.APPLE_WWDR_CERT_PATH || LOCAL_WWDR_PATH);
  const wwdr = wwdrFromEnv || (wwdrFromFile ? wwdrFromFile.toString('utf8') : '');

  return {
    configured: Boolean(passTypeIdentifier && teamIdentifier && signerCert && signerKey && wwdr),
    passTypeIdentifier,
    teamIdentifier,
    signerCert,
    signerKey,
    signerKeyPassphrase,
    wwdr,
  };
}

function googleConfig() {
  const issuerId = (process.env.GOOGLE_WALLET_ISSUER_ID || '').trim();
  const classSuffix = (process.env.GOOGLE_WALLET_CLASS_SUFFIX || 'business-card').trim();
  const clientEmail = (
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    ''
  ).trim();
  const privateKey = normalizePem(
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY ||
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
      '',
  );

  return {
    configured: Boolean(issuerId && clientEmail && privateKey),
    issuerId,
    classSuffix,
    clientEmail,
    privateKey,
  };
}

function getWalletStatus() {
  return {
    appleConfigured: appleConfig().configured,
    googleConfigured: googleConfig().configured,
    firmName: FIRM_NAME,
  };
}

async function fetchPublicBusinessCardDirect(employeeId) {
  const { data: employee, error: empErr } = await supabase
    .from('tenants_employee')
    .select(
      `
      id,
      display_name,
      official_name,
      photo_url,
      mobile,
      phone,
      phone_ext,
      bonuses_role,
      linkedin_url,
      department_id,
      tenant_departement!department_id ( name )
    `,
    )
    .eq('id', employeeId)
    .maybeSingle();

  if (empErr) {
    console.error('[wallet] tenants_employee fallback failed', empErr);
    return null;
  }
  if (!employee) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('email')
    .eq('employee_id', employeeId)
    .maybeSingle();

  const dept = employee.tenant_departement;
  const departmentName = Array.isArray(dept) ? dept[0]?.name : dept?.name;

  return {
    id: Number(employee.id),
    display_name: String(employee.display_name || ''),
    official_name: String(employee.official_name || employee.display_name || ''),
    photo_url: employee.photo_url || null,
    mobile: String(employee.mobile || ''),
    phone: String(employee.phone || ''),
    phone_ext: String(employee.phone_ext || ''),
    email: userRow?.email || null,
    department_name: String(departmentName || 'General'),
    bonuses_role: String(employee.bonuses_role || 'Employee'),
    linkedin_url: employee.linkedin_url || null,
  };
}

async function fetchPublicBusinessCard(employeeId) {
  const id = Number(employeeId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Invalid employee id');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase.rpc('get_public_business_card', {
    p_employee_id: id,
  });

  if (!error && data && typeof data === 'object' && data.id != null) {
    return {
      id: Number(data.id),
      display_name: String(data.display_name || ''),
      official_name: String(data.official_name || data.display_name || ''),
      photo_url: data.photo_url || null,
      mobile: String(data.mobile || ''),
      phone: String(data.phone || ''),
      phone_ext: String(data.phone_ext || ''),
      email: data.email || null,
      department_name: String(data.department_name || 'General'),
      bonuses_role: String(data.bonuses_role || 'Employee'),
      linkedin_url: data.linkedin_url || null,
    };
  }

  if (error) {
    console.error('[wallet] get_public_business_card failed — falling back to direct query', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      employeeId: id,
    });
  }

  const fallback = await fetchPublicBusinessCardDirect(id);
  if (fallback) return fallback;

  const err = new Error(
    error
      ? `Could not load business card (${error.code || error.message || 'rpc_error'})`
      : 'Business card not found',
  );
  err.status = error ? 500 : 404;
  throw err;
}

function roleLine(profile) {
  return `${profile.bonuses_role} – ${profile.department_name} Department`;
}

function phoneLine(profile) {
  if (profile.mobile) return profile.mobile;
  if (profile.phone) {
    return profile.phone_ext
      ? `${profile.phone} Ext. ${profile.phone_ext}`
      : profile.phone;
  }
  return '';
}

async function buildApplePkPassBuffer(employeeId) {
  const cfg = appleConfig();
  if (!cfg.configured) {
    const err = new Error(
      'Apple Wallet is not configured. Set APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, and APPLE_WWDR_CERT_PEM.',
    );
    err.status = 503;
    err.code = 'APPLE_WALLET_NOT_CONFIGURED';
    throw err;
  }

  const profile = await fetchPublicBusinessCard(employeeId);
  const cardUrl = buildCardUrl(profile.id);
  const serialNumber = `dpl-bc-${profile.id}`;

  const pass = await PKPass.from(
    {
      model: PASS_MODEL_DIR,
      certificates: {
        wwdr: cfg.wwdr,
        signerCert: cfg.signerCert,
        signerKey: cfg.signerKey,
        signerKeyPassphrase: cfg.signerKeyPassphrase,
      },
    },
    {
      serialNumber,
      passTypeIdentifier: cfg.passTypeIdentifier,
      teamIdentifier: cfg.teamIdentifier,
      organizationName: FIRM_NAME,
      description: `${profile.official_name} — Business Card`,
      logoText: 'DP',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(15, 36, 31)',
      labelColor: 'rgb(201, 169, 110)',
    },
  );

  pass.primaryFields.splice(0, pass.primaryFields.length);
  pass.secondaryFields.splice(0, pass.secondaryFields.length);
  pass.auxiliaryFields.splice(0, pass.auxiliaryFields.length);
  pass.backFields.splice(0, pass.backFields.length);

  pass.primaryFields.push({
    key: 'name',
    label: 'NAME',
    value: profile.official_name,
  });
  pass.secondaryFields.push({
    key: 'role',
    label: 'ROLE',
    value: roleLine(profile),
  });

  if (profile.email) {
    pass.auxiliaryFields.push({
      key: 'email',
      label: 'EMAIL',
      value: profile.email,
    });
  }
  const phone = phoneLine(profile);
  if (phone) {
    pass.auxiliaryFields.push({
      key: 'phone',
      label: 'PHONE',
      value: phone,
    });
  }

  pass.backFields.push({
    key: 'firm',
    label: 'FIRM',
    value: FIRM_NAME,
  });
  pass.backFields.push({
    key: 'office',
    label: 'OFFICE',
    value: `${OFFICE_LABEL} — ${OFFICE_ADDRESS}`,
  });
  if (profile.linkedin_url) {
    pass.backFields.push({
      key: 'linkedin',
      label: 'LINKEDIN',
      value: profile.linkedin_url,
    });
  }
  pass.backFields.push({
    key: 'cardUrl',
    label: 'DIGITAL CARD',
    value: cardUrl,
  });

  pass.setBarcodes({
    message: cardUrl,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
    altText: 'Scan to open card',
  });

  return {
    buffer: pass.getAsBuffer(),
    fileName: `${(profile.official_name || 'business-card')
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'business-card'}.pkpass`,
    profile,
    cardUrl,
  };
}

function buildGoogleSaveUrl(profile) {
  const cfg = googleConfig();
  if (!cfg.configured) {
    const err = new Error(
      'Google Wallet is not configured. Set GOOGLE_WALLET_ISSUER_ID and a service-account email/private key.',
    );
    err.status = 503;
    err.code = 'GOOGLE_WALLET_NOT_CONFIGURED';
    throw err;
  }

  const cardUrl = buildCardUrl(profile.id);
  const classId = `${cfg.issuerId}.${cfg.classSuffix}`;
  const objectId = `${cfg.issuerId}.business-card-${profile.id}`;
  const { first, last } = splitName(profile.official_name);
  const origins = [getPublicAppOrigin()];

  const genericClass = {
    id: classId,
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['role']" }],
                },
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['dept']" }],
                },
              },
            },
          },
        ],
      },
    },
  };

  const textModulesData = [
    { id: 'role', header: 'Role', body: profile.bonuses_role || 'Employee' },
    { id: 'dept', header: 'Department', body: `${profile.department_name} Department` },
  ];
  if (profile.email) {
    textModulesData.push({ id: 'email', header: 'Email', body: profile.email });
  }
  const phone = phoneLine(profile);
  if (phone) {
    textModulesData.push({ id: 'phone', header: 'Phone', body: phone });
  }
  textModulesData.push({
    id: 'office',
    header: 'Office',
    body: `${OFFICE_LABEL}, ${OFFICE_ADDRESS}`,
  });

  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    hexBackgroundColor: '#0F241F',
    cardTitle: {
      defaultValue: { language: 'en-US', value: FIRM_NAME },
    },
    header: {
      defaultValue: { language: 'en-US', value: profile.official_name },
    },
    subheader: {
      defaultValue: {
        language: 'en-US',
        value: roleLine(profile),
      },
    },
    textModulesData,
    barcode: {
      type: 'QR_CODE',
      value: cardUrl,
      alternateText: 'Open digital card',
    },
    linksModuleData: {
      uris: [
        {
          uri: cardUrl,
          description: 'Open digital business card',
          id: 'card',
        },
      ],
    },
  };

  if (profile.photo_url) {
    genericObject.heroImage = {
      sourceUri: { uri: profile.photo_url },
      contentDescription: {
        defaultValue: { language: 'en-US', value: profile.official_name },
      },
    };
  }

  // Keep first/last available for future contact enrichment
  void first;
  void last;

  const claims = {
    iss: cfg.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    origins,
    payload: {
      genericClasses: [genericClass],
      genericObjects: [genericObject],
    },
  };

  const token = jwt.sign(claims, cfg.privateKey, { algorithm: 'RS256' });
  return {
    saveUrl: `https://pay.google.com/gp/v/save/${token}`,
    profile,
    cardUrl,
  };
}

async function buildGoogleWalletSaveUrl(employeeId) {
  const profile = await fetchPublicBusinessCard(employeeId);
  return buildGoogleSaveUrl(profile);
}

module.exports = {
  getWalletStatus,
  fetchPublicBusinessCard,
  buildApplePkPassBuffer,
  buildGoogleWalletSaveUrl,
  buildCardUrl,
  FIRM_NAME,
};
