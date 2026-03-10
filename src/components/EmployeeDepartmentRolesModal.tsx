import React, { useState, useEffect, useCallback } from 'react';
import { XMarkIcon, UserGroupIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

const DEPARTMENT_ROLES = ['Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'] as const;
type DepartmentRole = (typeof DEPARTMENT_ROLES)[number];

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const EmployeeAvatar: React.FC<{ name: string; photoUrl?: string | null }> = ({ name, photoUrl }) => {
  const [imgError, setImgError] = useState(false);
  const showImg = photoUrl && !imgError;
  return (
    <div className="w-9 h-9 rounded-full bg-base-300 flex items-center justify-center text-base-content/70 font-semibold text-sm flex-shrink-0 overflow-hidden">
      {showImg ? (
        <img
          src={photoUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
};

interface EmployeeRow {
  employee_id: number;
  employee_name: string;
  photo_url?: string | null;
  department: string;
}

export interface EmployeeDepartmentRolesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EmployeeDepartmentRolesModal: React.FC<EmployeeDepartmentRolesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<DepartmentRole>('Sales');
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchAssignments = useCallback(async (departmentRole: DepartmentRole) => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const { data: assignments, error: assignErr } = await supabase
        .from('employee_field_assignments')
        .select('employee_id')
        .eq('department_role', departmentRole)
        .eq('is_active', true);

      if (assignErr) throw assignErr;

      let employeeIds = [...new Set((assignments || []).map((a: any) => a.employee_id).filter(Boolean))];
      if (employeeIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const { data: staffUsers, error: staffErr } = await supabase
        .from('users')
        .select('employee_id')
        .in('employee_id', employeeIds)
        .eq('is_staff', true)
        .eq('is_active', true);
      if (!staffErr && staffUsers?.length) {
        const staffIds = new Set((staffUsers as any[]).map((u: any) => u.employee_id).filter(Boolean));
        employeeIds = employeeIds.filter((id) => staffIds.has(id));
      }
      if (employeeIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const { data: employees, error: empErr } = await supabase
        .from('tenants_employee')
        .select(`
          id,
          official_name,
          display_name,
          photo_url,
          photo,
          department_id,
          tenant_departement!department_id(id, name)
        `)
        .in('id', employeeIds);

      if (empErr) throw empErr;

      const empMap = new Map<
        number,
        { official_name?: string; display_name?: string; photo_url?: string | null; department: string }
      >();
      (employees || []).forEach((e: any) => {
        const dept = Array.isArray(e.tenant_departement) ? e.tenant_departement[0] : e.tenant_departement;
        const departmentName = dept?.name?.trim() || '—';
        empMap.set(Number(e.id), {
          official_name: e.official_name,
          display_name: e.display_name,
          photo_url: e.photo_url || e.photo || null,
          department: departmentName,
        });
      });

      const list: EmployeeRow[] = employeeIds.map((id) => {
        const emp = empMap.get(Number(id));
        const name =
          emp?.official_name?.trim() || emp?.display_name?.trim() || `Employee ${id}`;
        return {
          employee_id: Number(id),
          employee_name: name,
          photo_url: emp?.photo_url ?? null,
          department: emp?.department ?? '—',
        };
      });

      list.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
      setRows(list);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchAssignments(activeTab);
    }
  }, [isOpen, activeTab, fetchAssignments]);

  useEffect(() => {
    setSearchTerm('');
  }, [activeTab]);

  const otherRoles = DEPARTMENT_ROLES.filter((r) => r !== activeTab);

  const moveToRole = async (employeeId: number, newRole: DepartmentRole) => {
    setMovingId(employeeId);
    try {
      // 1. Get all matching records (same employee + current department role) so we update every one
      const { data: toUpdate, error: fetchErr } = await supabase
        .from('employee_field_assignments')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('department_role', activeTab);

      if (fetchErr) throw fetchErr;
      const count = toUpdate?.length ?? 0;
      if (count === 0) {
        toast.error('No assignments found to move');
        return;
      }

      // 2. Update ALL those records to the new department role in one go
      const { data: updated, error: updateErr } = await supabase
        .from('employee_field_assignments')
        .update({ department_role: newRole })
        .eq('employee_id', employeeId)
        .eq('department_role', activeTab)
        .select('id');

      if (updateErr) throw updateErr;
      const updatedCount = updated?.length ?? 0;
      if (updatedCount !== count) {
        toast.error(`Only ${updatedCount} of ${count} assignment(s) were updated. Please refresh and try again.`);
        return;
      }

      toast.success(`${updatedCount} assignment(s) moved to ${newRole}`);
      setRows((prev) => prev.filter((r) => r.employee_id !== employeeId));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update role');
    } finally {
      setMovingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl shadow-xl border border-base-300">
        <div className="flex justify-between items-center p-4 border-b border-base-300 flex-shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <UserGroupIcon className="w-6 h-6" />
            Department roles
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="tabs tabs-boxed px-4 pt-3 flex-shrink-0 gap-1 bg-base-200/50">
          {DEPARTMENT_ROLES.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab tab-sm ${activeTab === tab ? 'tab-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!loading && rows.length > 0 && (
            <div className="mb-4">
              <label className="input input-bordered flex items-center gap-2 w-full max-w-xs">
                <MagnifyingGlassIcon className="w-4 h-4 opacity-70" />
                <input
                  type="text"
                  placeholder="Search by employee name..."
                  className="grow"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </label>
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-lg" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-base-content/70 text-center py-8">
              No employees in this department role.
            </p>
          ) : (() => {
            const q = searchTerm.trim().toLowerCase();
            const filtered = q
              ? rows.filter((r) => r.employee_name.toLowerCase().includes(q))
              : rows;
            return filtered.length === 0 ? (
              <p className="text-base-content/70 text-center py-8">
                No employees match &quot;{searchTerm.trim()}&quot;.
              </p>
            ) : (
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th className="text-right">Move to role</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.employee_id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar name={row.employee_name} photoUrl={row.photo_url} />
                        <span className="font-medium">{row.employee_name}</span>
                      </div>
                    </td>
                    <td>{row.department}</td>
                    <td className="text-right">
                      <select
                        className="select select-bordered select-sm w-40"
                        value=""
                        disabled={movingId === row.employee_id}
                        onChange={(e) => {
                          const val = e.target.value as DepartmentRole;
                          if (val) moveToRole(row.employee_id, val);
                          e.target.value = '';
                        }}
                      >
                        <option value="">Move to...</option>
                        {otherRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {movingId === row.employee_id && (
                        <span className="loading loading-spinner loading-xs ml-2 align-middle" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default EmployeeDepartmentRolesModal;
