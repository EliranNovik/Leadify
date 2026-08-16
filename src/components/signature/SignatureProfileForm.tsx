import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  buildSignaturePerson,
  fetchSignatureEmployee,
  fetchUserSignatureProfile,
  fetchCompanySignatureSettings,
  updateEmployeeSignatureContact,
  uploadEmployeeSignaturePhoto,
  upsertUserSignatureProfile,
  type CompanySignatureSettings,
  type SignatureEmployeeRow,
  type UserSignatureProfile,
} from '../../lib/companyEmailSignature';
import SignaturePreview from './SignaturePreview';
import { initialsFromDisplayName } from '../../lib/generateEmailSignatureHtml';
import { invalidateCurrentUserEmailSignatureCache } from '../../lib/emailSignature';

type SignatureProfileFormProps = {
  employeeId: number;
  employeeEmail?: string | null;
  /** When true, name/phone/photo write through to tenants_employee (default). */
  allowEmployeeFieldEdits?: boolean;
  compact?: boolean;
  onSaved?: () => void;
};

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-0';

const SignatureProfileForm: React.FC<SignatureProfileFormProps> = ({
  employeeId,
  employeeEmail,
  allowEmployeeFieldEdits = true,
  compact = false,
  onSaved,
}) => {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [settings, setSettings] = useState<CompanySignatureSettings | null>(null);
  const [employee, setEmployee] = useState<SignatureEmployeeRow | null>(null);
  const [profile, setProfile] = useState<UserSignatureProfile | null>(null);
  const [form, setForm] = useState({
    official_name: '',
    job_title: '',
    department: '',
    phone: '',
    email: '',
    signature_enabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [emp, sigProfile, company] = await Promise.all([
          fetchSignatureEmployee(employeeId),
          fetchUserSignatureProfile(employeeId),
          fetchCompanySignatureSettings(),
        ]);
        if (cancelled) return;
        if (!emp) {
          toast.error('Could not load employee profile');
          return;
        }
        const email = employeeEmail || emp.email || '';
        setEmployee({ ...emp, email });
        setProfile(sigProfile);
        setSettings(company);
        setForm({
          official_name: emp.official_name || emp.display_name || '',
          job_title: sigProfile.job_title || '',
          department: sigProfile.department_override || emp.department_name || '',
          phone: emp.mobile || emp.phone || '',
          email,
          signature_enabled: sigProfile.signature_enabled,
        });
      } catch (error) {
        console.error(error);
        toast.error('Failed to load email signature');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, employeeEmail]);

  const previewPerson = useMemo(() => {
    if (!employee) return null;
    const liveEmployee: SignatureEmployeeRow = {
      ...employee,
      official_name: form.official_name,
      mobile: form.phone,
      email: form.email,
    };
    const liveProfile: UserSignatureProfile = {
      ...(profile || {
        id: null,
        employee_id: employeeId,
        job_title: '',
        department_override: '',
        signature_enabled: true,
      }),
      job_title: form.job_title,
      department_override: form.department,
      signature_enabled: form.signature_enabled,
    };
    return buildSignaturePerson(liveEmployee, liveProfile);
  }, [employee, profile, form, employeeId]);

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !employee) return;
    setUploadingPhoto(true);
    try {
      const url = await uploadEmployeeSignaturePhoto(employeeId, file);
      setEmployee((prev) => (prev ? { ...prev, photo_url: url } : prev));
      invalidateCurrentUserEmailSignatureCache();
      toast.success('Profile photo updated');
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      if (allowEmployeeFieldEdits) {
        await updateEmployeeSignatureContact(employeeId, {
          official_name: form.official_name,
          mobile: form.phone,
        });
      }
      const saved = await upsertUserSignatureProfile(employeeId, {
        job_title: form.job_title,
        department_override: form.department,
        signature_enabled: form.signature_enabled,
      });
      setProfile(saved);
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              official_name: form.official_name,
              mobile: form.phone,
              email: form.email,
            }
          : prev,
      );
      toast.success('Email signature saved');
      invalidateCurrentUserEmailSignatureCache();
      onSaved?.();
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (!employee || !previewPerson) {
    return <p className="py-10 text-center text-sm text-gray-500">Employee profile not found.</p>;
  }

  return (
    <div className={`grid grid-cols-1 gap-6 ${compact ? '' : 'xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]'}`}>
      <div className="rounded-[18px] bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Your details</h3>
          <p className="mt-1 text-sm text-gray-500">
            Company branding is shared. Only your personal information is edited here.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Profile photo</p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="relative h-[90px] w-[90px] overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto || !allowEmployeeFieldEdits}
              >
                {employee.photo_url ? (
                  <img src={employee.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-[#EEF1F6] text-2xl font-bold tracking-wide text-[#1B2A4A]">
                    {initialsFromDisplayName(form.official_name || employee.official_name || employee.display_name)}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition hover:opacity-100">
                  <CameraIcon className="h-6 w-6 text-white" />
                </span>
              </button>
              <div>
                <button
                  type="button"
                  className="btn btn-sm rounded-full"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto || !allowEmployeeFieldEdits}
                >
                  {uploadingPhoto ? 'Uploading…' : 'Upload image'}
                </button>
                <p className="mt-1 text-xs text-gray-400">Square photo, shown as a circle in the signature.</p>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhoto}
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Full name</span>
            <input
              className={inputClass}
              value={form.official_name}
              onChange={(e) => setForm((prev) => ({ ...prev, official_name: e.target.value }))}
              disabled={!allowEmployeeFieldEdits}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Position</span>
            <input
              className={inputClass}
              placeholder="e.g. Full Stack Developer"
              value={form.job_title}
              onChange={(e) => setForm((prev) => ({ ...prev, job_title: e.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Department</span>
            <input
              className={inputClass}
              placeholder="e.g. IT & CRM Department"
              value={form.department}
              onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Phone</span>
            <input
              className={inputClass}
              placeholder="+972 50 000 0000"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              disabled={!allowEmployeeFieldEdits}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">Email</span>
            <input className={`${inputClass} bg-gray-50 text-gray-600`} value={form.email} readOnly />
          </label>

          <label className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={form.signature_enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, signature_enabled: e.target.checked }))}
            />
            <span className="text-sm text-gray-800">Enable email signature</span>
          </label>

          <button
            type="button"
            className="btn btn-primary mt-2 w-full rounded-full"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </div>

      <SignaturePreview user={previewPerson} companySettings={settings} />
    </div>
  );
};

export default SignatureProfileForm;
