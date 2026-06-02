import React from 'react';
import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategoryKey,
  formatNis,
} from '../../../lib/allExpensesReport';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

type SummaryRow = {
  key: ExpenseCategoryKey;
  label: string;
  amount: number;
  share: number;
};

type AllExpensesTotalDetailModalProps = ExpenseDetailModalProps & {
  grandTotal: number;
  rows: SummaryRow[];
  chartColors: Record<ExpenseCategoryKey, string>;
};

const AllExpensesTotalDetailModal: React.FC<AllExpensesTotalDetailModalProps> = ({
  open,
  onClose,
  grandTotal,
  rows,
  chartColors,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <div className="overflow-x-auto">
      <table className="table w-full border-0 text-base [&_td]:border-0 [&_th]:border-0">
        <thead>
          <tr>
            <th>Category</th>
            <th className="text-right">Amount (₪)</th>
            <th className="text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td>
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: chartColors[row.key] }}
                />
                {EXPENSE_CATEGORY_LABELS[row.key]}
              </td>
              <td className="text-right">{formatNis(row.amount)}</td>
              <td className="text-right">
                {grandTotal > 0 ? `${row.share.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>Total</td>
            <td className="text-right">{formatNis(grandTotal)}</td>
            <td className="text-right">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </ExpenseCategoryDetailModal>
);

export default AllExpensesTotalDetailModal;
