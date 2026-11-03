import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import {
  MonthYearFilterBar,
  MonthYearSelect,
  PAID_EXPENSE_FIELD,
  applyMonthColumnFilter,
  formatAmountNis,
  formatDateLabel,
  formatMonthLabel,
  toMonthStart,
  useCreatedByFormatter,
} from './expenseManagerShared';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';

/**
 * Loans the firm took, in two tables: the loan itself (who lent the money and how much) and one
 * repayment per month, which is the part the expense reports total.
 */
const LoansManager: React.FC<ExpenseManagerEmbedProps> = ({ initialYear, initialMonth }) => {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(
    () => initialMonth ?? String(now.getMonth() + 1).padStart(2, '0'),
  );
  const [filterYear, setFilterYear] = useState(() => initialYear ?? String(now.getFullYear()));

  useEffect(() => {
    if (initialYear != null) setFilterYear(initialYear);
    if (initialMonth !== undefined) setFilterMonth(initialMonth);
  }, [initialYear, initialMonth]);

  const formatCreatedBy = useCreatedByFormatter();

  const queryModifier = useCallback(
    (query: any) => applyMonthColumnFilter(query, 'expense_month', filterMonth, filterYear),
    [filterMonth, filterYear],
  );

  const filterBar = (
    <MonthYearFilterBar
      month={filterMonth}
      year={filterYear}
      onMonthChange={setFilterMonth}
      onYearChange={setFilterYear}
    />
  );

  const paymentFields = useMemo(
    () => [
      {
        name: 'loan_id',
        label: 'Loan',
        type: 'select' as const,
        required: true,
        searchableSelect: true,
        foreignKey: {
          table: 'loans',
          valueField: 'id',
          displayField: 'lender',
        },
      },
      {
        name: 'expense_month',
        label: 'Month & Year',
        type: 'custom' as const,
        required: true,
        customComponent: MonthYearSelect,
        formatValue: (value: unknown) => formatMonthLabel(value),
        prepareValueForForm: (value: unknown) => toMonthStart(value) ?? '',
        prepareValueForSave: (value: unknown) => toMonthStart(value),
      },
      {
        name: 'amount_nis',
        label: 'Repayment (₪)',
        type: 'number' as const,
        required: true,
        placeholder: 'e.g., 8000',
        formatValue: (value: unknown) => formatAmountNis(value),
      },
      {
        name: 'due_date',
        label: 'Due date',
        type: 'date' as const,
        required: false,
        placeholder: 'End of month when empty',
        formatValue: (value: unknown) => (value ? formatDateLabel(value) : 'End of month'),
      },
      PAID_EXPENSE_FIELD,
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea' as const,
        required: false,
      },
      {
        name: 'created_at',
        label: 'Created At',
        type: 'datetime' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
      },
      {
        name: 'created_by',
        label: 'Created By',
        type: 'text' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
        formatValue: formatCreatedBy,
      },
    ],
    [formatCreatedBy],
  );

  const loanFields = useMemo(
    () => [
      {
        name: 'lender',
        label: 'Lender',
        type: 'text' as const,
        required: true,
        placeholder: 'e.g., Bank Leumi',
      },
      {
        name: 'principal_nis',
        label: 'Total borrowed (₪)',
        type: 'number' as const,
        required: false,
        defaultValue: 0,
        formatValue: (value: unknown) => formatAmountNis(value),
      },
      {
        name: 'started_on',
        label: 'Taken on',
        type: 'date' as const,
        required: false,
        formatValue: (value: unknown) => (value ? formatDateLabel(value) : '—'),
      },
      {
        name: 'is_active',
        label: 'Still being repaid',
        type: 'boolean' as const,
        required: false,
        defaultValue: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea' as const,
        required: false,
      },
      {
        name: 'created_at',
        label: 'Created At',
        type: 'datetime' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
      },
      {
        name: 'created_by',
        label: 'Created By',
        type: 'text' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
        formatValue: formatCreatedBy,
      },
    ],
    [formatCreatedBy],
  );

  return (
    <div className="w-full min-w-0 space-y-10">
      <GenericCRUDManager
        tableName="loan_payment_expense"
        fields={paymentFields}
        title="Loan repayment"
        description="What the firm repaid on each loan, per calendar month"
        pageSize={20}
        sortColumn="expense_month"
        sortAscending={false}
        filterBar={filterBar}
        queryModifier={queryModifier}
        queryModifierKey={`${filterYear}-${filterMonth}`}
        booleanStorage="native"
      />

      <div className="border-t border-base-300/60 pt-8">
        <GenericCRUDManager
          tableName="loans"
          fields={loanFields}
          title="Loan"
          description="Who lent the money and how much was borrowed"
          pageSize={20}
          sortColumn="created_at"
          skipIdAssignment
          booleanStorage="native"
        />
      </div>
    </div>
  );
};

export default LoansManager;
