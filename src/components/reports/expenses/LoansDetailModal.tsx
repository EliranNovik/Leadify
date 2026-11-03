import React from 'react';
import LoansManager from '../../admin/LoansManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const LoansDetailModal: React.FC<ExpenseDetailModalProps> = ({ open, onClose, year, month }) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <LoansManager key={`${year}-${month}`} initialYear={year} initialMonth={month} />
  </ExpenseCategoryDetailModal>
);

export default LoansDetailModal;
