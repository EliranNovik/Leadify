import React from 'react';
import OfficeExpensesManager from '../../admin/OfficeExpensesManager';
import FirmManagementCostsManager from '../../admin/FirmManagementCostsManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';
import { EXPENSE_TYPE_CODE_OFFICE } from '../../../lib/expenseTypes';

const OfficeExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <div className="flex w-full flex-col gap-12">
      <OfficeExpensesManager key={`office-${year}-${month}`} initialYear={year} initialMonth={month} />
      <FirmManagementCostsManager
        key={`fm-office-${year}-${month}`}
        initialYear={year}
        initialMonth={month}
        expenseTypeCode={EXPENSE_TYPE_CODE_OFFICE}
      />
    </div>
  </ExpenseCategoryDetailModal>
);

export default OfficeExpensesDetailModal;
