import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardDocumentIcon, MagnifyingGlassIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  buildSignaturePerson,
  DEFAULT_COMPANY_SIGNATURE_SETTINGS,
  fetchCompanySignatureSettings,
  fetchSignatureEmployeeDirectory,
  fetchUserSignatureProfile,
  saveCompanySignatureSettings,
  uploadSignatureAsset,
  type CompanySignatureSettings,
  type SignatureEmployeeRow,
  type UserSignatureProfile,
} from '../../lib/companyEmailSignature';
import {
  buildOutlookSignatureHtml,
  copyOutlookSignatureToClipboard,
} from '../../lib/copyOutlookSignature';
import SignaturePreview from '../signature/SignaturePreview';
import SignatureProfileForm from '../signature/SignatureProfileForm';
import { initialsFromDisplayName } from '../../lib/generateEmailSignatureHtml';
import { invalidateCurrentUserEmailSignatureCache } from '../../lib/emailSignature';

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-0';

type AdminSection = 'company' | 'employees';

type VisibilityKey =
  | 'show_logo'
  | 'show_secondary_logo'
  | 'show_facebook'
  | 'show_linkedin'
  | 'show_youtube'
  | 'show_instagram'
  | 'show_website'
  | 'show_office_address'
  | 'show_office_phone';

const VISIBILITY_TOGGLES: { key: VisibilityKey; label: string }[] = [
  { key: 'show_logo', label: 'Primary logo' },
  { key: 'show_secondary_logo', label: 'Secondary image' },
  { key: 'show_facebook', label: 'Facebook' },
  { key: 'show_linkedin', label: 'LinkedIn' },
  { key: 'show_youtube', label: 'YouTube' },
  { key: 'show_instagram', label: 'Instagram' },
  { key: 'show_website', label: 'Website' },
  { key: 'show_office_address', label: 'Office address' },
  { key: 'show_office_phone', label: 'Office phone' },
];

const ImageUploadField: React.FC<{
  label: string;
  hint: string;
  url: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
}> = ({ label, hint, url, uploading, onUpload, onClear }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex items-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 p-4">
        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-gray-100">
          {url ? (
            <img src={url} alt="" className="max-h-14 max-w-full object-contain" />
          ) : (
            <PhotoIcon className="h-7 w-7 text-gray-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{hint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm rounded-full"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
            </button>
            {url ? (
              <button type="button" className="btn btn-sm btn-ghost rounded-full" onClick={onClear}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </div>
    </div>
  );
};

const EmailSignatureManager: React.FC = () => {
  const [section, setSection] = useState<AdminSection>('company');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [settings, setSettings] = useState<CompanySignatureSettings>(DEFAULT_COMPANY_SIGNATURE_SETTINGS);
  const [employees, setEmployees] = useState<SignatureEmployeeRow[]>([]);
  const [profilesByEmployee, setProfilesByEmployee] = useState<Record<number, UserSignatureProfile>>({});
  const [query, setQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copyingEmployeeId, setCopyingEmployeeId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [company, directory] = await Promise.all([
          fetchCompanySignatureSettings(),
          fetchSignatureEmployeeDirectory(),
        ]);
        if (cancelled) return;
        setSettings(company);
        setEmployees(directory);
        if (directory[0]?.id) setSelectedEmployeeId(directory[0].id);
      } catch (error: unknown) {
        console.error(error);
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Could not load signature settings. Run sql/2026-08-16_company_email_signature.sql in Supabase.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      const hay = `${emp.official_name} ${emp.display_name} ${emp.email || ''} ${emp.department_name}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, query]);

  const selectedEmployee = employees.find((emp) => emp.id === selectedEmployeeId) || null;

  useEffect(() => {
    if (!selectedEmployeeId || profilesByEmployee[selectedEmployeeId]) return;
    let cancelled = false;
    void fetchUserSignatureProfile(selectedEmployeeId).then((profile) => {
      if (cancelled) return;
      setProfilesByEmployee((prev) => ({ ...prev, [selectedEmployeeId]: profile }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEmployeeId, profilesByEmployee]);

  const previewPerson = useMemo(() => {
    if (!selectedEmployee) {
      return buildSignaturePerson(
        {
          id: 0,
          display_name: 'Eliran Novik',
          official_name: 'Eliran Novik',
          photo_url: null,
          photo: null,
          mobile: '+972 50 311 6471',
          phone: null,
          department_name: 'IT & CRM Department',
          email: 'eliran@deckerlaw.co.il',
        },
        {
          id: null,
          employee_id: 0,
          job_title: 'Full Stack Developer',
          department_override: 'IT & CRM Department',
          signature_enabled: true,
        },
      );
    }
    return buildSignaturePerson(
      selectedEmployee,
      profilesByEmployee[selectedEmployee.id] || {
        id: null,
        employee_id: selectedEmployee.id,
        job_title: '',
        department_override: '',
        signature_enabled: true,
      },
    );
  }, [selectedEmployee, profilesByEmployee]);

  const patchSettings = (partial: Partial<CompanySignatureSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const handleUpload = async (
    field: 'logo_url' | 'secondary_logo_url' | 'facebook_icon_url' | 'linkedin_icon_url' | 'youtube_icon_url' | 'website_icon_url',
    file: File,
  ) => {
    setUploadingField(field);
    try {
      const url = await uploadSignatureAsset(file, field.replace(/_url$/, ''));
      patchSettings({ [field]: url });
      toast.success('Image uploaded');
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveCompany = async () => {
    setSaving(true);
    try {
      const saved = await saveCompanySignatureSettings(settings);
      setSettings(saved);
      invalidateCurrentUserEmailSignatureCache();
      toast.success('Company signature settings saved');
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Save failed. Confirm sql/2026-08-16_company_email_signature.sql has been applied.',
      );
    } finally {
      setSaving(false);
    }
  };

  const copyEmployeeSignature = async (emp: SignatureEmployeeRow) => {
    setCopyingEmployeeId(emp.id);
    try {
      let profile = profilesByEmployee[emp.id];
      if (!profile) {
        profile = await fetchUserSignatureProfile(emp.id);
        setProfilesByEmployee((prev) => ({ ...prev, [emp.id]: profile }));
      }
      const person = buildSignaturePerson(emp, profile);
      const html = buildOutlookSignatureHtml(person, settings);
      await copyOutlookSignatureToClipboard(html);
      toast.success(
        `Copied ${emp.official_name || emp.display_name}. Paste in Outlook: File → Options → Mail → Signatures.`,
      );
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Could not copy signature');
    } finally {
      setCopyingEmployeeId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Email Signature</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          One shared company design for every Leadify user. Employees only change personal details.
          Outgoing mail always uses the latest branding at send time.
        </p>
        {loadError ? <p className="mt-2 text-sm text-error">{loadError}</p> : null}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            section === 'company' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 shadow-sm'
          }`}
          onClick={() => setSection('company')}
        >
          Company branding
        </button>
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            section === 'employees' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 shadow-sm'
          }`}
          onClick={() => setSection('employees')}
        >
          Employees
        </button>
      </div>

      {section === 'company' ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <div className="space-y-5 rounded-[18px] bg-white p-6 shadow-sm">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={settings.signature_enabled}
                onChange={(e) => patchSettings({ signature_enabled: e.target.checked })}
              />
              <span className="text-sm font-medium text-gray-900">Enable company email signatures</span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Company name
              </span>
              <input
                className={inputClass}
                value={settings.company_name}
                onChange={(e) => patchSettings({ company_name: e.target.value })}
              />
            </label>

            <ImageUploadField
              label="Primary logo"
              hint="Decker Pex Levi logo · about 200px wide"
              url={settings.logo_url}
              uploading={uploadingField === 'logo_url'}
              onUpload={(file) => void handleUpload('logo_url', file)}
              onClear={() => patchSettings({ logo_url: null })}
            />

            <ImageUploadField
              label="Secondary image"
              hint="Duns 100 · about 100px wide"
              url={settings.secondary_logo_url}
              uploading={uploadingField === 'secondary_logo_url'}
              onUpload={(file) => void handleUpload('secondary_logo_url', file)}
              onClear={() => patchSettings({ secondary_logo_url: null })}
            />

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Website</span>
              <input
                className={inputClass}
                value={settings.website_url || ''}
                onChange={(e) => patchSettings({ website_url: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Facebook</span>
              <input
                className={inputClass}
                value={settings.facebook_url || ''}
                onChange={(e) => patchSettings({ facebook_url: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">LinkedIn</span>
              <input
                className={inputClass}
                value={settings.linkedin_url || ''}
                onChange={(e) => patchSettings({ linkedin_url: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">YouTube</span>
              <input
                className={inputClass}
                value={settings.youtube_url || ''}
                onChange={(e) => patchSettings({ youtube_url: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Office address
              </span>
              <textarea
                className={`${inputClass} min-h-[72px]`}
                value={settings.office_address || ''}
                onChange={(e) => patchSettings({ office_address: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Office phone
              </span>
              <input
                className={inputClass}
                value={settings.office_phone || ''}
                onChange={(e) => patchSettings({ office_phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Disclaimer (optional)
              </span>
              <textarea
                className={`${inputClass} min-h-[72px]`}
                value={settings.signature_disclaimer || ''}
                onChange={(e) => patchSettings({ signature_disclaimer: e.target.value })}
              />
            </label>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Show in signature</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {VISIBILITY_TOGGLES.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={Boolean(settings[item.key])}
                      onChange={(e) => patchSettings({ [item.key]: e.target.checked })}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary w-full rounded-full"
              onClick={handleSaveCompany}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save company branding'}
            </button>
          </div>

          <div className="min-w-0 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Preview
              {selectedEmployee
                ? ` · ${selectedEmployee.official_name || selectedEmployee.display_name}`
                : ' · sample employee'}
            </p>
            <SignaturePreview user={previewPerson} companySettings={settings} showCopyActions={false} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-[18px] bg-white p-4 shadow-sm">
            <div className="relative mb-3">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                className={`${inputClass} pl-9`}
                placeholder="Search employees"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="mb-3 text-xs leading-5 text-gray-500">
              Copy a signature, then paste it in Outlook under File → Options → Mail → Signatures.
            </p>
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {filteredEmployees.map((emp) => {
                const active = emp.id === selectedEmployeeId;
                const copying = copyingEmployeeId === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-1 rounded-xl ${
                      active ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedEmployeeId(emp.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
                    >
                      {emp.photo_url ? (
                        <img src={emp.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold tracking-wide ${
                            active ? 'bg-white text-[#1B2A4A]' : 'bg-[#EEF1F6] text-[#1B2A4A]'
                          }`}
                        >
                          {initialsFromDisplayName(emp.official_name || emp.display_name)}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {emp.official_name || emp.display_name}
                        </span>
                        <span className={`block truncate text-xs ${active ? 'text-white/70' : 'text-gray-400'}`}>
                          {emp.email || emp.department_name || 'No email'}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Copy signature for Outlook"
                      aria-label={`Copy ${emp.official_name || emp.display_name} signature for Outlook`}
                      disabled={copying}
                      onClick={() => void copyEmployeeSignature(emp)}
                      className={`mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        active
                          ? 'text-white/80 hover:bg-white/10 hover:text-white'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                      }`}
                    >
                      {copying ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <ClipboardDocumentIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            {selectedEmployeeId ? (
              <SignatureProfileForm
                key={selectedEmployeeId}
                employeeId={selectedEmployeeId}
                employeeEmail={selectedEmployee?.email}
                onSaved={() => {
                  void fetchSignatureEmployeeDirectory().then(setEmployees);
                  void fetchUserSignatureProfile(selectedEmployeeId).then((profile) => {
                    setProfilesByEmployee((prev) => ({ ...prev, [selectedEmployeeId]: profile }));
                  });
                }}
              />
            ) : (
              <p className="py-16 text-center text-sm text-gray-500">Select an employee to edit their signature.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailSignatureManager;
