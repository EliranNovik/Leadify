/** Period filters from All expenses report (month empty = full year). */
export type ExpenseDetailModalPeriod = {
  year: string;
  month: string;
};

export type ExpenseDetailModalProps = ExpenseDetailModalPeriod & {
  open: boolean;
  onClose: () => void;
};

export type ExpenseManagerEmbedProps = {
  initialYear?: string;
  initialMonth?: string;
  /** Scope firm management costs to a single expense_types.code (e.g. rent, marketing_expense). */
  expenseTypeCode?: string;
};
