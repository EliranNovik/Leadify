/* Step 1: Count how many rows have due_by_id as NULL, ready_to_pay_by IS NULL, but due_date is NOT NULL (only for id > 176788832) */
SELECT 
    COUNT(*) as rows_to_update,
    COUNT(CASE WHEN due_date IS NOT NULL THEN 1 END) as rows_with_due_date,
    COUNT(CASE WHEN due_date IS NULL THEN 1 END) as rows_with_null_due_date
FROM finances_paymentplanrow
WHERE due_by_id IS NULL
  AND ready_to_pay_by IS NULL
  AND id > 176788832;

/* Step 2: Set due_date to NULL where due_by_id IS NULL, ready_to_pay_by IS NULL (only for id > 176788832) */
UPDATE finances_paymentplanrow
SET due_date = NULL
WHERE due_by_id IS NULL
  AND ready_to_pay_by IS NULL
  AND due_date IS NOT NULL
  AND id > 176788832;

/* Step 3: Verify the update - count remaining rows with due_by_id NULL, ready_to_pay_by NULL, and due_date NOT NULL (only for id > 176788832) */
SELECT 
    COUNT(*) as remaining_rows_with_due_date
FROM finances_paymentplanrow
WHERE due_by_id IS NULL
  AND ready_to_pay_by IS NULL
  AND due_date IS NOT NULL
  AND id > 176788832;
