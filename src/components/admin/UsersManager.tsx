import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import ExternSourcesMultiSelect from './ExternSourcesMultiSelect';
import { supabase } from '../../lib/supabase';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
  type ActiveStaffEmployee,
} from '../../lib/employeeSalaries';
import type { AdminCrudEmbedProps } from './FirmsManager';

const UserTableEmail: React.FC<{
  email: string;
  record: Record<string, unknown>;
  employeeById: Record<string, ActiveStaffEmployee>;
}> = ({ email, record, employeeById }) => {
  const [imgErr, setImgErr] = useState(false);
  const employeeId = record.employee_id != null ? String(record.employee_id) : '';
  const employee = employeeId ? employeeById[employeeId] : undefined;
  const photoUrl = employee?.photo_url?.trim() || '';
  const showPhoto = Boolean(photoUrl) && !imgErr;
  const fallbackName =
    employee?.display_name ||
    [record.first_name, record.last_name].filter(Boolean).join(' ').trim() ||
    email;
  const avatarKey = employee?.id ?? (Number(record.id) || 0);

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-base-200"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-base-200"
          style={salaryAvatarGradientStyle(avatarKey, fallbackName)}
          aria-hidden
        >
          {getSalaryEmployeeInitials(fallbackName)}
        </span>
      )}
      <span className="truncate">{email}</span>
    </div>
  );
};

const HR_ADD_HIDDEN_FIELDS = new Set([
  'role',
  'is_active',
  'is_staff',
  'is_superuser',
  'extern',
  'extern_firm_id',
  'extern_source_id',
  'updated_by',
  'created_at',
  'updated_at',
  'last_login',
  'date_joined',
]);

const UsersManager: React.FC<{ embed?: AdminCrudEmbedProps }> = ({ embed }) => {
  const [employeeById, setEmployeeById] = useState<Record<string, ActiveStaffEmployee>>({});
  const simplifiedHrAdd = Boolean(embed?.simplifiedHrAdd);

  useEffect(() => {
    let cancelled = false;

    const loadEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo');

      if (error) {
        console.error('Error fetching employees for users table:', error);
        return;
      }
      if (cancelled) return;

      const map: Record<string, ActiveStaffEmployee> = {};
      (data || []).forEach(
        (emp: {
          id: number;
          display_name: string | null;
          photo_url: string | null;
          photo: string | null;
        }) => {
          map[String(emp.id)] = {
            id: emp.id,
            display_name: emp.display_name?.trim() || `Employee #${emp.id}`,
            photo_url:
              (typeof emp.photo_url === 'string' && emp.photo_url.trim()) ||
              (typeof emp.photo === 'string' && emp.photo.trim()) ||
              null,
          };
        },
      );
      setEmployeeById(map);
    };

    void loadEmployees();

    return () => {
      cancelled = true;
    };
  }, []);

  const formatEmail = useCallback(
    (value: unknown, record: { [key: string]: unknown }) => {
      const email =
        (typeof value === 'string' && value.trim()) ||
        (typeof record.email === 'string' && record.email.trim()) ||
        '—';
      return <UserTableEmail email={email} record={record} employeeById={employeeById} />;
    },
    [employeeById],
  );

  const fields = useMemo(() => {
    const base = [
      {
        name: 'email',
        label: 'Email',
        type: 'email' as const,
        required: true,
        placeholder: 'e.g., user@example.com',
        formatValue: formatEmail,
      },
      {
        name: 'first_name',
        label: 'First Name',
        type: 'text' as const,
        required: false,
        placeholder: 'e.g., John',
      },
      {
        name: 'last_name',
        label: 'Last Name',
        type: 'text' as const,
        required: false,
        placeholder: 'e.g., Doe',
      },
      {
        name: 'role',
        label: 'Role',
        type: 'select' as const,
        required: false,
        hideInTable: true,
        hideInEdit: true,
        options: [
          { value: 'user', label: 'User' },
          { value: 'admin', label: 'Admin' },
        ],
        placeholder: 'Select a role',
      },
      {
        name: 'is_active',
        label: 'Is Active',
        type: 'boolean' as const,
        required: false,
        hideInEdit: true,
      },
      {
        name: 'is_staff',
        label: 'Is Staff',
        type: 'boolean' as const,
        required: false,
        hideInEdit: true,
      },
      {
        name: 'is_superuser',
        label: 'Is Superuser',
        type: 'boolean' as const,
        required: false,
        hideInEdit: true,
      },
      {
        name: 'extern',
        label: 'Extern',
        type: 'boolean' as const,
        required: false,
        hideInEdit: true,
      },
      {
        name: 'extern_firm_id',
        label: 'Extern firm',
        type: 'select' as const,
        required: false,
        hideInTable: true,
        options: [],
        placeholder: 'Select a firm',
        foreignKey: {
          table: 'firms',
          displayField: 'name',
          valueField: 'id',
        },
      },
      {
        name: 'extern_source_id',
        label: 'Extern sources',
        type: 'custom' as const,
        required: false,
        customComponent: ExternSourcesMultiSelect as React.ComponentType<{
          value: any;
          onChange: (value: any) => void;
          record?: any;
          readOnly?: boolean;
        }>,
        prepareValueForForm: (v: unknown) => {
          if (v == null) return [];
          if (Array.isArray(v)) return v;
          if (typeof v === 'object' && !Array.isArray(v)) return [];
          return [];
        },
        prepareValueForSave: (v: unknown) => {
          if (v == null) return null;
          if (Array.isArray(v) && v.length === 0) return null;
          if (Array.isArray(v)) return v.map((id) => (typeof id === 'number' ? id : Number(id)));
          return null;
        },
        formatValue: (v: unknown) => {
          if (v == null) return '—';
          if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} source(s)`;
          return '—';
        },
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password' as const,
        required: true,
        placeholder: 'Enter password (required for new users)',
        hideInTable: true,
      },
      {
        name: 'new_password',
        label: 'New Password',
        type: 'password' as const,
        required: false,
        placeholder: 'Enter new password (leave blank to keep current)',
        hideInTable: true,
        hideInAdd: true,
      },
      {
        name: 'updated_by',
        label: 'Updated By',
        type: 'text' as const,
        required: false,
        placeholder: 'User ID who last updated',
        hideInTable: true,
        hideInEdit: true,
        readOnly: true,
        foreignKey: {
          table: 'users',
          displayField: 'email',
          valueField: 'id',
        },
      },
      {
        name: 'created_at',
        label: 'Created At',
        type: 'datetime' as const,
        required: false,
        hideInTable: true,
        readOnly: true,
      },
      {
        name: 'updated_at',
        label: 'Updated At',
        type: 'datetime' as const,
        required: false,
        hideInTable: true,
        readOnly: true,
      },
      {
        name: 'last_login',
        label: 'Last Login',
        type: 'datetime' as const,
        required: false,
        hideInTable: true,
        readOnly: true,
      },
      {
        name: 'date_joined',
        label: 'Date Joined',
        type: 'datetime' as const,
        required: false,
        hideInTable: true,
        readOnly: true,
      },
    ];

    if (!simplifiedHrAdd) return base;

    return base.map((field) =>
      HR_ADD_HIDDEN_FIELDS.has(field.name) ? { ...field, hideInAdd: true } : field,
    );
  }, [formatEmail, simplifiedHrAdd]);

  const createDefaults = useMemo(() => {
    const defaults: Record<string, unknown> = { ...(embed?.createDefaults || {}) };
    if (simplifiedHrAdd) {
      defaults.is_active = true;
    }
    return Object.keys(defaults).length > 0 ? defaults : undefined;
  }, [embed?.createDefaults, simplifiedHrAdd]);

  return (
    <GenericCRUDManager
      tableName="users"
      fields={fields}
      title="User"
      description="Manage system users and their permissions"
      pageSize={50}
      sortColumn="created_at"
      auditUserIdSource="crm"
      listHidden={Boolean(embed)}
      hideTitle={Boolean(embed)}
      hideAddButton={Boolean(embed)}
      externalAddOpen={embed?.addDrawerOpen}
      onExternalAddOpenChange={embed?.onAddDrawerOpenChange}
      onRecordCreated={embed?.onRecordCreated}
      onRecordSaved={embed?.onRecordSaved}
      createDefaults={createDefaults}
    />
  );
};

export default UsersManager;
