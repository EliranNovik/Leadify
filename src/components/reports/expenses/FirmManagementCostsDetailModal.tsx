import React from 'react';
import FirmManagementCostsManager from '../../admin/FirmManagementCostsManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const FirmManagementCostsDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <FirmManagementCostsManager key={`${year}-${month}`} initialYear={year} initialMonth={month} />
  </ExpenseCategoryDetailModal>
);

export default FirmManagementCostsDetailModal;
