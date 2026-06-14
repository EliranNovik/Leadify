import React from 'react';
import OfficeRentExpensesManager from '../../admin/OfficeRentExpensesManager';
import FirmManagementCostsManager from '../../admin/FirmManagementCostsManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';
import { EXPENSE_TYPE_CODE_RENT } from '../../../lib/expenseTypes';

const OfficeRentExpensesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => (
  <ExpenseCategoryDetailModal open={open} onClose={onClose}>
    <div className="flex w-full flex-col gap-12">
      <OfficeRentExpensesManager key={`rent-${year}-${month}`} initialYear={year} initialMonth={month} />
      <FirmManagementCostsManager
        key={`fm-rent-${year}-${month}`}
        initialYear={year}
        initialMonth={month}
        expenseTypeCode={EXPENSE_TYPE_CODE_RENT}
      />
    </div>
  </ExpenseCategoryDetailModal>
);

export default OfficeRentExpensesDetailModal;
