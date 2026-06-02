import React from 'react';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const OfficeExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({ open, onClose }) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <p className="py-12 text-center text-base text-base-content/60">
      Office expenses are not tracked yet. Add data in Admin when this category is configured.
    </p>
  </ExpenseCategoryDetailModal>
);

export default OfficeExpensesDetailModal;
