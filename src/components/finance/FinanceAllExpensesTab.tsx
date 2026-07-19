import React from 'react';
import { useAdminRole } from '../../hooks/useAdminRole';
import AllExpensesReport from '../reports/AllExpensesReport';

/** All Expenses report tab inside Finance Management — superuser only. */
const FinanceAllExpensesTab: React.FC = () => {
  const { isSuperUser } = useAdminRole();

  if (!isSuperUser) {
    return (
      <div className="rounded-2xl bg-white border border-gray-200 px-8 py-10 text-center shadow-sm">
        <p className="font-semibold text-gray-800">Superuser access required</p>
        <p className="mt-1 text-sm text-gray-500">All expenses is limited to superusers.</p>
      </div>
    );
  }

  return <AllExpensesReport />;
};

export default FinanceAllExpensesTab;
