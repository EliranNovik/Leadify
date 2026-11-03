import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import {
  MonthYearFilterBar,
  PAID_EXPENSE_FIELD,
  applyDateColumnFilter,
  formatDateLabel,
  useCreatedByFormatter,
} from './expenseManagerShared';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';

const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

const formatAmount = (value: unknown, record: Record<string, any>): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = String(record?.currency || 'ILS').toUpperCase();
  const symbol = code === 'ILS' ? '₪' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : `${code} `;
  return `${symbol}${Math.round(n).toLocaleString()}`;
};

/**
 * Case expenses the office had to cover because the client never paid.
 *
 * The client link is filled in when the row is added from Finance → Expenses, where a lead can be
 * searched for; here the case is identified by its number.
 */
const PaidByOfficeExpensesManager: React.FC<ExpenseManagerEmbedProps> = ({
  initialYear,
  initialMonth,
}) => {
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
    (query: any) => applyDateColumnFilter(query, 'expense_date', filterMonth, filterYear),
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

  const fields = useMemo(
    () => [
      {
        name: 'lead_number',
        label: 'Case number',
        type: 'text' as const,
        required: false,
        placeholder: 'e.g., L209994/3',
      },
      {
        name: 'expense_date',
        label: 'Date',
        type: 'date' as const,
        required: true,
        formatValue: (value: unknown) => formatDateLabel(value),
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number' as const,
        required: true,
        placeholder: 'e.g., 1200',
        formatValue: formatAmount,
      },
      {
        name: 'currency',
        label: 'Currency',
        type: 'select' as const,
        required: false,
        defaultValue: 'ILS',
        options: CURRENCIES.map(code => ({ value: code, label: code })),
      },
      {
        name: 'description',
        label: 'What it was for',
        type: 'textarea' as const,
        required: false,
      },
      PAID_EXPENSE_FIELD,
      {
        name: 'reimbursed',
        label: 'Client paid us back',
        type: 'boolean' as const,
        required: false,
        defaultValue: false,
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
    <GenericCRUDManager
      tableName="paid_by_office_expense"
      fields={fields}
      title="Paid by office"
      description="Client expenses the office took over because the client did not pay"
      pageSize={20}
      sortColumn="expense_date"
      sortAscending={false}
      filterBar={filterBar}
      queryModifier={queryModifier}
      queryModifierKey={`${filterYear}-${filterMonth}`}
      booleanStorage="native"
    />
  );
};

export default PaidByOfficeExpensesManager;
