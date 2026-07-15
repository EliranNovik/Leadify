import React, { useEffect, useRef, useState } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import {
  getEmployeeDisplayLabel,
  type OrganizationEmployee,
} from '../../lib/organizationEmployees';
import HrEmployeeAvatar from './HrEmployeeAvatar';

const PROFILE_PHOTO_BUCKET = 'My-Profile';

const BONUSES_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'c', label: 'Closer' },
  { value: 's', label: 'Scheduler' },
  { value: 'h', label: 'Handler' },
  { value: 'e', label: 'Expert' },
  { value: 'p', label: 'Partner' },
  { value: 'dm', label: 'Department Manager' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'm', label: 'Manager' },
  { value: 'z', label: 'Manager' },
  { value: 'se', label: 'Secretary' },
  { value: 'b', label: 'Book keeper' },
  { value: 'dv', label: 'Developer' },
  { value: 'ma', label: 'Marketing' },
  { value: 'f', label: 'Finance' },
  { value: 'col', label: 'Collection' },
  { value: 'd', label: 'Diverse' },
  { value: 'lawyer', label: 'Helper Closer' },
  { value: 'n', label: 'No role' },
  { value: 'partners', label: 'Partners' },
];

export type HrEmployeeAboutForm = {
  display_name: string;
  official_name: string;
  department_id: string;
  bonuses_role: string;
  linkedin_url: string;
  email: string;
  phone: string;
  mobile: string;
  employee_mobile: string;
  is_superuser: boolean;
  works_from_home: boolean;
  min_hours: string;
  school: string;
  diplom: string;
  date_of_birth: string;
};

function formFromEmployee(emp: OrganizationEmployee): HrEmployeeAboutForm {
  return {
    display_name: emp.display_name || '',
    official_name: emp.official_name || '',
    department_id: emp.department_id != null ? String(emp.department_id) : '',
    bonuses_role: emp.bonuses_role || '',
    linkedin_url: emp.linkedin_url || '',
    email: emp.email || '',
    phone: emp.phone || '',
    mobile: emp.mobile || '',
    employee_mobile: emp.employee_mobile || '',
    is_superuser: Boolean(emp.is_superuser),
    works_from_home: Boolean(emp.works_from_home),
    min_hours: String(emp.min_hours ?? 8),
    school: emp.school || '',
    diplom: emp.diplom || '',
    date_of_birth: emp.date_of_birth || '',
  };
}

type Props = {
  open: boolean;
  employee: OrganizationEmployee;
  onClose: () => void;
  onSaved: () => void;
};

export default function HrEmployeeAboutEditModal({ open, employee, onClose, onSaved }: Props) {
  const [form, setForm] = useState<HrEmployeeAboutForm>(() => formFromEmployee(employee));
  const [departments, setDepartments] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(employee.photo_url);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFromEmployee(employee));
    setPhotoUrl(employee.photo_url);
  }, [open, employee]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('tenant_departement')
        .select('id, name')
        .order('name');
      if (cancelled) return;
      if (error) {
        console.error('HrEmployeeAboutEditModal departments:', error);
        return;
      }
      setDepartments(
        (data || []).map((dept) => ({
          value: String(dept.id),
          label: dept.name,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const displayName = getEmployeeDisplayLabel(employee);

  const setField = <K extends keyof HrEmployeeAboutForm>(key: K, value: HrEmployeeAboutForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const filePath = `${employee.id}_avatar_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from(PROFILE_PHOTO_BUCKET)
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(filePath);

      const { error: dbError } = await supabase
        .from('tenants_employee')
        .update({ photo_url: publicUrl })
        .eq('id', employee.id);
      if (dbError) throw dbError;

      setPhotoUrl(publicUrl);
      toast.success('Profile photo updated');
      onSaved();
    } catch (err: unknown) {
      console.error('HrEmployeeAboutEditModal photo:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to upload photo: ${message}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const roleOptions = (() => {
    const opts = [...BONUSES_ROLE_OPTIONS];
    if (form.bonuses_role && !opts.some((o) => o.value === form.bonuses_role)) {
      opts.unshift({ value: form.bonuses_role, label: form.bonuses_role });
    }
    return opts;
  })();

  const handleSave = async () => {
    const displayName = form.display_name.trim();
    if (!displayName) {
      toast.error('Display name is required');
      return;
    }
    const minHoursNum = Number(form.min_hours);
    if (!Number.isFinite(minHoursNum) || minHoursNum < 0) {
      toast.error('Min hours must be a valid number');
      return;
    }

    setSaving(true);
    try {
      const schoolTrimmed = form.school.trim();
      const schoolValue = schoolTrimmed ? [schoolTrimmed] : null;
      const departmentId = form.department_id ? Number(form.department_id) : null;

      const { error: empError } = await supabase
        .from('tenants_employee')
        .update({
          display_name: displayName,
          official_name: form.official_name.trim() || null,
          department_id: departmentId,
          bonuses_role: form.bonuses_role || null,
          linkedin_url: form.linkedin_url.trim() || null,
          phone: form.phone.trim() || null,
          mobile: form.mobile.trim() || null,
          employee_mobile: form.employee_mobile.trim() || null,
          works_from_home: form.works_from_home,
          min_hours: minHoursNum,
          school: schoolValue,
          diplom: form.diplom.trim() || null,
          date_of_birth: form.date_of_birth.trim() || null,
        })
        .eq('id', employee.id);

      if (empError) throw empError;

      if (employee.chatUserId) {
        const { error: userError } = await supabase
          .from('users')
          .update({
            email: form.email.trim() || employee.email,
            is_superuser: form.is_superuser,
          })
          .eq('id', employee.chatUserId);
        if (userError) throw userError;
      }

      toast.success('Employee updated');
      onSaved();
      onClose();
    } catch (err) {
      console.error('HrEmployeeAboutEditModal save:', err);
      toast.error('Failed to update employee');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-3xl max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg text-gray-900">Edit employee</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">
          Update details shown on the About tab. Hour rate and total cost stay salary-based.
        </p>

        <div className="space-y-6">
          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Profile photo</h4>
            <div className="flex items-center gap-4">
              <div className="relative group shrink-0">
                <HrEmployeeAvatar
                  employeeId={employee.id}
                  name={displayName}
                  photoUrl={photoUrl}
                  size="xl"
                  shape="circle"
                  className="border-2 border-white shadow-md"
                />
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto || saving}
                  aria-label="Change profile photo"
                >
                  <CameraIcon className="h-7 w-7 text-white" />
                </button>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-600">
                  {uploadingPhoto ? 'Uploading…' : 'Click the photo or use Change photo.'}
                </p>
                <button
                  type="button"
                  className="btn btn-sm mt-2 rounded-full"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto || saving}
                >
                  <CameraIcon className="h-4 w-4" />
                  Change photo
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handlePhotoUpload(e)}
                />
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">General</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-gray-500">Display name</span>
                <input
                  className="input input-bordered"
                  value={form.display_name}
                  onChange={(e) => setField('display_name', e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Official name</span>
                <input
                  className="input input-bordered"
                  value={form.official_name}
                  onChange={(e) => setField('official_name', e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Department</span>
                <select
                  className="select select-bordered"
                  value={form.department_id}
                  onChange={(e) => setField('department_id', e.target.value)}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Role</span>
                <select
                  className="select select-bordered"
                  value={form.bonuses_role}
                  onChange={(e) => setField('bonuses_role', e.target.value)}
                >
                  <option value="">—</option>
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Date of birth</span>
                <input
                  type="date"
                  className="input input-bordered"
                  value={form.date_of_birth}
                  onChange={(e) => setField('date_of_birth', e.target.value)}
                />
              </label>
              <label className="form-control sm:col-span-2">
                <span className="label-text text-gray-500">LinkedIn</span>
                <input
                  className="input input-bordered"
                  value={form.linkedin_url}
                  onChange={(e) => setField('linkedin_url', e.target.value)}
                  placeholder="https://linkedin.com/in/…"
                />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Contact</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-gray-500">Email</span>
                <input
                  type="email"
                  className="input input-bordered"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  disabled={!employee.chatUserId}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Phone</span>
                <input
                  className="input input-bordered"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Mobile</span>
                <input
                  className="input input-bordered"
                  value={form.mobile}
                  onChange={(e) => setField('mobile', e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Employee mobile</span>
                <input
                  className="input input-bordered"
                  value={form.employee_mobile}
                  onChange={(e) => setField('employee_mobile', e.target.value)}
                />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Employment</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="label cursor-pointer justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
                <span className="label-text font-medium text-gray-800">Superuser</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={form.is_superuser}
                  onChange={(e) => setField('is_superuser', e.target.checked)}
                  disabled={!employee.chatUserId}
                />
              </label>
              <label className="label cursor-pointer justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
                <span className="label-text font-medium text-gray-800">Works from home</span>
                <input
                  type="checkbox"
                  className="toggle toggle-success"
                  checked={form.works_from_home}
                  onChange={(e) => setField('works_from_home', e.target.checked)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Min hours</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="input input-bordered"
                  value={form.min_hours}
                  onChange={(e) => setField('min_hours', e.target.value)}
                />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Education</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="form-control">
                <span className="label-text text-gray-500">School</span>
                <input
                  className="input input-bordered"
                  value={form.school}
                  onChange={(e) => setField('school', e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-gray-500">Diploma</span>
                <input
                  className="input input-bordered"
                  value={form.diplom}
                  onChange={(e) => setField('diplom', e.target.value)}
                />
              </label>
            </div>
          </section>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving || uploadingPhoto}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || uploadingPhoto}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={saving ? undefined : onClose} />
    </div>
  );
}
