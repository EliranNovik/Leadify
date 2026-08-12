import React, { useEffect, useRef, useState } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  getEmployeeDisplayLabel,
  type OrganizationEmployee,
} from '../../lib/organizationEmployees';
import { EMPLOYEE_ROLE_HR_OPTIONS } from '../../lib/employeeRoles';
import HrEmployeeAvatar from './HrEmployeeAvatar';

const PROFILE_PHOTO_BUCKET = 'My-Profile';

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
  const { user, userFullName } = useAuthContext();
  const [form, setForm] = useState<HrEmployeeAboutForm>(() => formFromEmployee(employee));
  const [departments, setDepartments] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(employee.photo_url);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [togglingEmployment, setTogglingEmployment] = useState(false);
  const [fired, setFired] = useState(Boolean(employee.fired));
  const [firedAt, setFiredAt] = useState<string | null>(employee.fired_at);
  const [firedByName, setFiredByName] = useState<string | null>(employee.fired_by_name);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFromEmployee(employee));
    setPhotoUrl(employee.photo_url);
    setFired(Boolean(employee.fired));
    setFiredAt(employee.fired_at);
    setFiredByName(employee.fired_by_name);
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
    const opts = [...EMPLOYEE_ROLE_HR_OPTIONS];
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

  const resolveActingEmployee = async (): Promise<{ id: number | null; name: string }> => {
    const fallbackName =
      (userFullName || '').trim() ||
      (user?.email || '').trim() ||
      'Unknown';

    if (!user?.id && !user?.email) {
      return { id: null, name: fallbackName };
    }

    let query = supabase
      .from('users')
      .select('employee_id, full_name, email, tenants_employee!employee_id(id, display_name, official_name)')
      .limit(1);

    if (user?.id) {
      query = query.eq('auth_id', user.id);
    } else if (user?.email) {
      query = query.eq('email', user.email);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      if (user?.email && user?.id) {
        const { data: byEmail } = await supabase
          .from('users')
          .select('employee_id, full_name, email, tenants_employee!employee_id(id, display_name, official_name)')
          .eq('email', user.email)
          .maybeSingle();
        if (byEmail) {
          const emp = Array.isArray(byEmail.tenants_employee)
            ? byEmail.tenants_employee[0]
            : byEmail.tenants_employee;
          const name =
            String(emp?.official_name || emp?.display_name || byEmail.full_name || fallbackName).trim() ||
            fallbackName;
          return {
            id: byEmail.employee_id != null ? Number(byEmail.employee_id) : null,
            name,
          };
        }
      }
      return { id: null, name: fallbackName };
    }

    const emp = Array.isArray(data.tenants_employee)
      ? data.tenants_employee[0]
      : data.tenants_employee;
    const name =
      String(emp?.official_name || emp?.display_name || data.full_name || fallbackName).trim() ||
      fallbackName;
    return {
      id: data.employee_id != null ? Number(data.employee_id) : null,
      name,
    };
  };

  const handleToggleEmployment = async () => {
    setTogglingEmployment(true);
    try {
      if (fired) {
        const { error } = await supabase
          .from('tenants_employee')
          .update({
            fired: false,
            fired_at: null,
            fired_by_employee_id: null,
            fired_by_name: null,
          })
          .eq('id', employee.id);
        if (error) throw error;
        setFired(false);
        setFiredAt(null);
        setFiredByName(null);
        toast.success('Employment reinstated');
      } else {
        const actor = await resolveActingEmployee();
        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from('tenants_employee')
          .update({
            fired: true,
            fired_at: nowIso,
            fired_by_employee_id: actor.id,
            fired_by_name: actor.name,
          })
          .eq('id', employee.id);
        if (error) throw error;
        setFired(true);
        setFiredAt(nowIso);
        setFiredByName(actor.name);
        toast.success('Employment ended');
      }
      onSaved();
    } catch (err) {
      console.error('HrEmployeeAboutEditModal employment:', err);
      toast.error('Failed to update employment status');
    } finally {
      setTogglingEmployment(false);
    }
  };

  const firedAtLabel = (() => {
    if (!firedAt) return null;
    const d = new Date(firedAt);
    if (Number.isNaN(d.getTime())) return firedAt;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  })();

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-gray-900">Edit employee</h3>
            <p className="text-sm text-gray-500 mt-1">
              Update details shown on the About tab. Hour rate and total cost stay salary-based.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0 text-right max-w-[14rem]">
            <button
              type="button"
              className={`btn btn-sm ${fired ? 'btn-outline btn-success' : 'btn-error btn-outline'}`}
              onClick={() => void handleToggleEmployment()}
              disabled={togglingEmployment || saving || uploadingPhoto}
            >
              {togglingEmployment
                ? 'Updating…'
                : fired
                  ? 'Reinstate Employment'
                  : 'End Employment'}
            </button>
            {fired && (
              <div className="text-xs leading-snug">
                <p className="font-medium text-red-700">
                  Employee terminated by {firedByName || 'Unknown'}
                </p>
                {firedAtLabel && (
                  <p className="text-gray-500 mt-0.5">{firedAtLabel}</p>
                )}
              </div>
            )}
          </div>
        </div>

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
