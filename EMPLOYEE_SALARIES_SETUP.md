# Employee Salaries Report Setup

## Overview
A new "Employee Salaries" report has been added to the Tools category in Reports. This report allows users to upload payroll PDF documents (דוח תמחיר) and automatically extract salary data.

## Database Setup

Run the following SQL files in order:

1. **Add worker_id column to tenants_employee:**
   ```bash
   sql/add_worker_id_to_tenants_employee.sql
   ```

2. **Create employee_salary table:**
   ```bash
   sql/create_employee_salary_table.sql
   ```

3. **Create storage bucket for documents:**
   ```bash
   sql/create_employee_salaries_documents_bucket.sql
   ```

## Package Installation (Optional)

The PDF parsing library will be loaded from CDN automatically. However, for better performance and offline support, you can install it locally:

```bash
npm install pdfjs-dist
```

If not installed, the system will automatically load PDF.js from CDN when needed.

## Features

### 1. PDF Upload & Parsing
- Drag and drop zone for PDF upload
- Automatic extraction of:
  - Employee number (מספר עובד / worker_id)
  - Gross salary (סה״כ משכורת ברוטו)
- Matching employees by `worker_id` column in `tenants_employee` table

### 2. Month/Year Selection
- Dropdowns to select the salary month and year
- Used when uploading new payroll documents

### 3. Date Range Filtering
- From/To date filters to view salaries within a specific period
- Only approved salaries are shown in the main table

### 4. Approval Workflow
- Uploaded salary records require approval
- "Approve" button in the "Uploaded Documents" table
- Only approved salaries appear in the main "Employee Salaries" table

### 5. Employee Salaries Table
Columns:
- Employee
- Department
- Role
- Salary (Gross Salary)
- Salary Budget (currently 0, can be enhanced to fetch from Sales Contribution)

### 6. Uploaded Documents Table
Shows all uploaded salary records with:
- Employee name
- Month/Year
- Gross Salary
- Approval status
- View document button
- Approve button (for pending records)

## How It Works

1. **Upload PDF**: User selects month/year and uploads a payroll PDF
2. **Parse PDF**: The system extracts employee numbers and gross salaries
3. **Match Employees**: Employee numbers are matched to `worker_id` in `tenants_employee` table
4. **Store Records**: Salary records are saved with `approved: false`
5. **Approve**: User reviews and approves salary records
6. **View**: Approved salaries appear in the main table

## Important Notes

### Worker ID Setup
Before using this feature, ensure that all employees in `tenants_employee` have their `worker_id` column populated with the employee number from your payroll system (מספר עובד).

### PDF Parsing
The PDF parser uses `pdfjs-dist` library and attempts to:
- Extract text with positioning information
- Identify table rows
- Match employee numbers (8-10 digits)
- Extract gross salary amounts (5,000 - 200,000 NIS range)

If parsing fails or doesn't extract data correctly, you may need to:
- Verify the PDF format matches the expected structure
- Check that employee numbers are in the correct format
- Review the extracted data in the `extracted_data` JSONB column

### Salary Budget
The "Salary Budget" column is currently set to 0. To populate it:
- Fetch data from Sales Contribution report
- Match by employee_id and date range
- Calculate based on contribution percentage

## Future Enhancements

1. **Net Salary Extraction**: Extract net salary (סה״כ משכורת נטו) from PDF
2. **Salary Budget Integration**: Fetch from Sales Contribution data
3. **Bulk Approval**: Approve multiple records at once
4. **Export to Excel**: Export salary data to Excel
5. **Salary History**: View salary trends over time
6. **Validation Rules**: Add validation for salary amounts
7. **AI Fallback**: Use AI for parsing when standard parsing fails

## Troubleshooting

### "PDF.js library not found" error
- The system will try to load PDF.js from CDN automatically
- If you have internet connection issues, install locally: `npm install pdfjs-dist`
- Restart the development server after installation

### No data extracted from PDF
- Verify PDF format matches the expected structure
- Check that employee numbers are visible in the PDF
- Review browser console for parsing errors

### Employees not matching
- Ensure `worker_id` is populated in `tenants_employee` table
- Verify employee numbers in PDF match `worker_id` format (remove spaces)
- Check for leading zeros in employee numbers
