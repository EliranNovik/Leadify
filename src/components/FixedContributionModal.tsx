import React, { useState, useEffect, useCallback } from 'react';
import { XMarkIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

const DEPARTMENT_TABS = ['Partners', 'Marketing', 'Finance'] as const;
type DepartmentRole = (typeof DEPARTMENT_TABS)[number];

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
  fixed_contribution_amount: number;
}

export interface FixedContributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  formatCurrency?: (amount: number) => string;
}

const FixedContributionModal: React.FC<FixedContributionModalProps> = ({
  isOpen,
  onClose,
  formatCurrency = (n) => (n == null || Number.isNaN(n) ? '0' : `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
}) => {
  const [activeTab, setActiveTab] = useState<DepartmentRole>('Partners');
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<number, number>>({});

  const fetchEmployeesAndAmounts = useCallback(async (departmentRole: DepartmentRole) => {
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
        .select('id, official_name, display_name, photo_url, photo')
        .in('id', employeeIds);

      if (empErr) throw empErr;

      const { data: fixedRows, error: fixedErr } = await supabase
        .from('employee_fixed_contribution')
        .select('employee_id, fixed_contribution_amount')
        .eq('department_role', departmentRole)
        .in('employee_id', employeeIds);

      if (fixedErr) throw fixedErr;

      const amountByEmployee = new Map<number, number>();
      (fixedRows || []).forEach((r: any) => {
        amountByEmployee.set(Number(r.employee_id), Number(r.fixed_contribution_amount) || 0);
      });

      const empMap = new Map<number, { official_name?: string; display_name?: string; photo_url?: string | null }>();
      (employees || []).forEach((e: any) => {
        empMap.set(Number(e.id), {
          official_name: e.official_name,
          display_name: e.display_name,
          photo_url: e.photo_url || e.photo || null,
        });
      });

      const list: EmployeeRow[] = employeeIds.map((id) => {
        const emp = empMap.get(Number(id));
        const name = emp?.official_name?.trim() || emp?.display_name?.trim() || `Employee ${id}`;
        return {
          employee_id: Number(id),
          employee_name: name,
          photo_url: emp?.photo_url ?? null,
          fixed_contribution_amount: amountByEmployee.get(Number(id)) ?? 0,
        };
      });

      list.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
      setRows(list);
      setDirty({});
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
      fetchEmployeesAndAmounts(activeTab);
    }
  }, [isOpen, activeTab, fetchEmployeesAndAmounts]);

  const handleAmountChange = (employeeId: number, value: string) => {
    const num = parseFloat(value.replace(/,/g, '')) || 0;
    setDirty((prev) => ({ ...prev, [employeeId]: num }));
  };

  const dirtyCount = Object.keys(dirty).length;

  const saveAll = async () => {
    if (dirtyCount === 0) return;
    setIsSaving(true);
    try {
      const payloads = Object.entries(dirty).map(([employeeId, amount]) => ({
        employee_id: Number(employeeId),
        department_role: activeTab,
        fixed_contribution_amount: amount,
      }));
      const { error } = await supabase
        .from('employee_fixed_contribution')
        .upsert(payloads, { onConflict: 'employee_id,department_role' });
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) =>
          dirty[r.employee_id] !== undefined
            ? { ...r, fixed_contribution_amount: dirty[r.employee_id] }
            : r
        )
      );
      setDirty({});
      toast.success('All changes saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl shadow-xl border border-base-300">
        <div className="flex justify-between items-center p-4 border-b border-base-300 flex-shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <CurrencyDollarIcon className="w-6 h-6" />
            Fixed contribution
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="tabs tabs-boxed px-4 pt-3 flex-shrink-0 gap-1 bg-base-200/50">
          {DEPARTMENT_TABS.map((tab) => (
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
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-lg" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-base-content/70 text-center py-8">No employees in this department role.</p>
          ) : (
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="text-right">Contribution fixed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee_id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar name={row.employee_name} photoUrl={row.photo_url} />
                        <span className="font-medium">{row.employee_name}</span>
                      </div>
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input input-bordered input-sm w-32 text-right"
                        value={dirty[row.employee_id] ?? row.fixed_contribution_amount}
                        onChange={(e) => handleAmountChange(row.employee_id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <div className="flex-shrink-0 p-4 border-t border-base-300 flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={dirtyCount === 0 || isSaving}
              onClick={saveAll}
            >
              {isSaving ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Saving...
                </>
              ) : dirtyCount > 0 ? (
                `Save (${dirtyCount})`
              ) : (
                'Save'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FixedContributionModal;
