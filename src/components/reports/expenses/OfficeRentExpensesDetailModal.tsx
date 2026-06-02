import React from 'react';
import OfficeRentExpensesManager from '../../admin/OfficeRentExpensesManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const OfficeRentExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <OfficeRentExpensesManager key={`${year}-${month}`} initialYear={year} initialMonth={month} />
  </ExpenseCategoryDetailModal>
);

export default OfficeRentExpensesDetailModal;
