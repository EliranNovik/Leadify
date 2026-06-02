import React, { useMemo } from 'react';
import EmployeeSalariesManager from '../../admin/EmployeeSalariesManager';
import ExpenseCategoryDetailModal from './ExpenseCategoryDetailModal';
import type { ExpenseDetailModalProps } from './expenseDetailTypes';

const EmployeeSalariesDetailModal: React.FC<ExpenseDetailModalProps> = ({
  open,
  onClose,
  year,
  month,
}) => {
  const initialYear = useMemo(() => Number(year) || new Date().getFullYear(), [year]);
  const initialMonth = useMemo(() => {
    if (month) return Number(month);
    return new Date().getMonth() + 1;
  }, [month]);

  return (
    <ExpenseCategoryDetailModal open={open} onClose={onClose}>
      <EmployeeSalariesManager
        key={`${year}-${month}`}
        initialYear={initialYear}
        initialMonth={initialMonth}
      />
    </ExpenseCategoryDetailModal>
  );
};

export default EmployeeSalariesDetailModal;
