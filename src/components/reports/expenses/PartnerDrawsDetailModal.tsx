import React from 'react';
import PartnerDrawsManager from '../../admin/PartnerDrawsManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const PartnerDrawsDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <PartnerDrawsManager key={`${year}-${month}`} initialYear={year} initialMonth={month} />
  </ExpenseCategoryDetailModal>
);

export default PartnerDrawsDetailModal;
