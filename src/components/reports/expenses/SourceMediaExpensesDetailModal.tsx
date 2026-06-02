import React from 'react';
import SourceMediaExpensesManager from '../../admin/SourceMediaExpensesManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const SourceMediaExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <SourceMediaExpensesManager key={`${year}-${month}`} initialYear={year} initialMonth={month} />
  </ExpenseCategoryDetailModal>
);

export default SourceMediaExpensesDetailModal;
