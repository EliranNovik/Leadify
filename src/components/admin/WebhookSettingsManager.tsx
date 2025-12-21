import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface WebhookSettings {
  id?: number;
  is_active: boolean;
  last_updated: string;
  updated_by?: string;
}

const WebhookSettingsManager: React.FC = () => {
  const [settings, setSettings] = useState<WebhookSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);

  // Fetch current user
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser({ id: user.id, email: user.email || 'Unknown' });
      }
    };
    fetchCurrentUser();
  }, []);

  // Fetch webhook settings
  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      // First, check if the table exists and has data
      const { data, error: fetchError } = await supabase
        .from('webhook_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching webhook settings:', fetchError);
        // If table doesn't exist or there's an error, create default settings
        if (fetchError.code === '42P01' || !data) {
          // Table doesn't exist or no data, create default
          const defaultSettings: WebhookSettings = {
            is_active: true,
            last_updated: new Date().toISOString(),
          };
          setSettings(defaultSettings);
        } else {
          throw fetchError;
        }
      } else if (data) {
        setSettings(data as WebhookSettings);
      } else {
        // No settings found, create default
        const defaultSettings: WebhookSettings = {
          is_active: true,
          last_updated: new Date().toISOString(),
        };
        setSettings(defaultSettings);
      }
    } catch (err) {
      console.error('Error in fetchSettings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch webhook settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const toggleWebhook = async (newStatus: boolean) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updatedSettings: WebhookSettings = {
        is_active: newStatus,
        last_updated: new Date().toISOString(),
        updated_by: currentUser?.email || 'Unknown',
      };

      // Check if settings exist
      const { data: existingData } = await supabase
        .from('webhook_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingData?.id) {
        // Update existing settings
        const { error: updateError } = await supabase
          .from('webhook_settings')
          .update(updatedSettings)
          .eq('id', existingData.id);

        if (updateError) throw updateError;
      } else {
        // Insert new settings
        const { error: insertError } = await supabase
          .from('webhook_settings')
          .insert([updatedSettings]);

        if (insertError) throw insertError;
      }

      setSettings(updatedSettings);
      setSuccess(`Webhook ${newStatus ? 'activated' : 'deactivated'} successfully!`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error toggling webhook:', err);
      setError(err instanceof Error ? err.message : 'Failed to update webhook settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Webhook Settings</h2>
        <p className="text-base-content/70">
          Control the webhook endpoint for receiving new lead data
        </p>
      </div>

      {error && (
        <div className="alert alert-error mb-4">
          <XCircleIcon className="w-6 h-6" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert alert-success mb-4">
          <CheckCircleIcon className="w-6 h-6" />
          <span>{success}</span>
        </div>
      )}

      {/* Main Control Card */}
      <div className="card bg-base-100 shadow-xl border border-base-200">
        <div className="card-body">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                settings?.is_active ? 'bg-success/20' : 'bg-error/20'
              }`}>
                {settings?.is_active ? (
                  <CheckCircleIcon className="w-8 h-8 text-success" />
                ) : (
                  <XCircleIcon className="w-8 h-8 text-error" />
                )}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  Webhook Status: {settings?.is_active ? 'Active' : 'Inactive'}
                </h3>
                <p className="text-sm text-base-content/60 mt-1">
                  Endpoint: <code className="bg-base-200 px-2 py-1 rounded text-xs">/api/hook/catch</code>
                </p>
              </div>
            </div>
            
            {/* Toggle Switch */}
            <div className="form-control">
              <label className="label cursor-pointer flex-col gap-2">
                <span className="label-text font-semibold">
                  {settings?.is_active ? 'Enabled' : 'Disabled'}
                </span>
                <input
                  type="checkbox"
                  className="toggle toggle-success toggle-lg"
                  checked={settings?.is_active || false}
                  onChange={(e) => toggleWebhook(e.target.checked)}
                  disabled={saving}
                />
              </label>
            </div>
          </div>

          <div className="divider"></div>

          {/* Information Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-base-200/50 rounded-lg">
              <ExclamationTriangleIcon className="w-6 h-6 text-warning flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Important Information</h4>
                <ul className="text-sm text-base-content/70 space-y-1 list-disc list-inside">
                  <li>When <strong>active</strong>, the webhook will receive and process new lead data</li>
                  <li>When <strong>inactive</strong>, all incoming webhook requests will be rejected</li>
                  <li>This affects the <code className="bg-base-300 px-1 rounded">/api/hook/catch</code> endpoint</li>
                  <li>Use this to temporarily stop new leads from being created</li>
                </ul>
              </div>
            </div>

            {/* Status Details */}
            {settings && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="p-4 bg-base-200/30 rounded-lg">
                  <p className="text-xs text-base-content/60 mb-1">Last Updated</p>
                  <p className="font-semibold text-gray-900">
                    {settings.last_updated 
                      ? new Date(settings.last_updated).toLocaleString()
                      : 'Never'
                    }
                  </p>
                </div>
                {settings.updated_by && (
                  <div className="p-4 bg-base-200/30 rounded-lg">
                    <p className="text-xs text-base-content/60 mb-1">Updated By</p>
                    <p className="font-semibold text-gray-900">{settings.updated_by}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="card-actions justify-end mt-6">
            <button
              className={`btn ${settings?.is_active ? 'btn-error' : 'btn-success'}`}
              onClick={() => toggleWebhook(!settings?.is_active)}
              disabled={saving}
            >
              {saving && <span className="loading loading-spinner loading-sm"></span>}
              {!saving && (settings?.is_active ? (
                <>
                  <XCircleIcon className="w-5 h-5" />
                  Deactivate Webhook
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-5 h-5" />
                  Activate Webhook
                </>
              ))}
            </button>
          </div>
        </div>
      </div>

      {/* Additional Info Card */}
      <div className="mt-6 p-4 bg-info/10 border border-info/30 rounded-lg">
        <div className="flex items-start gap-3">
          <svg className="w-6 h-6 text-info flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h4 className="font-semibold text-info mb-1">How it works</h4>
            <p className="text-sm text-base-content/70">
              When you deactivate the webhook, any incoming requests to create new leads will be blocked at the API level.
              This is useful during maintenance, data migration, or when you need to temporarily stop accepting new leads.
              You can reactivate it at any time with a single click.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebhookSettingsManager;

