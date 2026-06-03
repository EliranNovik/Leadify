import React from 'react';
import SourceMediaExpensesManager from '../../admin/SourceMediaExpensesManager';
import FirmManagementCostsManager from '../../admin/FirmManagementCostsManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const MarketingExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <div className="flex w-full flex-col gap-12">
      <SourceMediaExpensesManager key={`sm-${year}-${month}`} initialYear={year} initialMonth={month} />
      <FirmManagementCostsManager key={`fm-${year}-${month}`} initialYear={year} initialMonth={month} />
    </div>
  </ExpenseCategoryDetailModal>
);

export default MarketingExpensesDetailModal;
