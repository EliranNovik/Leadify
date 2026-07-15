import { supabase } from './supabase';
import { parsePayrollSalaryPdf } from './parsePayrollSalaryPdf';

export type ProcessPayrollUploadResult = {
  matchedCount: number;
  unmatchedCount: number;
  extractedCount: number;
  documentPath: string;
};

/**
 * Parse payroll PDF (דוח תמחיר), upload to storage, match by worker_id, upsert employee_salary.
 * Same pipeline as Employee Salaries report upload.
 */
export async function processPayrollDocumentUpload(params: {
  file: File;
  salaryMonth: number;
  salaryYear: number;
}): Promise<ProcessPayrollUploadResult> {
  const { file, salaryMonth, salaryYear } = params;

  if (!file.type.includes('pdf')) {
    throw new Error('Please upload a PDF file');
  }

  const extractedData = await parsePayrollSalaryPdf(file);
  if (extractedData.length === 0) {
    throw new Error('No salary data found in PDF. Please check the document format.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const fileExt = file.name.split('.').pop() || 'pdf';
  const fileName = `salary_${salaryYear}_${salaryMonth}_${Date.now()}.${fileExt}`;
  const filePath = `${user.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('employee-salary-documents')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload document: ${uploadError.message}`);
  }

  const { data: employees, error: employeesError } = await supabase
    .from('tenants_employee')
    .select('id, worker_id, display_name');

  if (employeesError) {
    throw new Error('Failed to fetch employees for matching');
  }

  const workerIdMap = new Map<string, number>();
  for (const emp of employees || []) {
    if (!emp.worker_id) continue;
    const normalizedWorkerId = String(emp.worker_id).replace(/\s/g, '');
    workerIdMap.set(normalizedWorkerId, emp.id);
    if (normalizedWorkerId.length < 9) {
      const withLeadingZeros = normalizedWorkerId.padStart(9, '0');
      if (!workerIdMap.has(withLeadingZeros)) {
        workerIdMap.set(withLeadingZeros, emp.id);
      }
    }
  }

  const salaryRecordsToInsert = extractedData
    .map((item) => {
      const normalizedExtractedId = item.workerId.toString().replace(/\s/g, '');
      let employeeId = workerIdMap.get(normalizedExtractedId);
      if (!employeeId) {
        employeeId = workerIdMap.get(normalizedExtractedId.padStart(9, '0'));
      }
      if (!employeeId) {
        const withoutLeadingZeros = normalizedExtractedId.replace(/^0+/, '');
        if (withoutLeadingZeros !== normalizedExtractedId) {
          employeeId = workerIdMap.get(withoutLeadingZeros);
        }
      }
      if (!employeeId) return null;

      return {
        employee_id: employeeId,
        worker_id: item.workerId,
        salary_month: salaryMonth,
        salary_year: salaryYear,
        gross_salary: item.grossSalary,
        net_salary: item.netSalary,
        document_url: filePath,
        extracted_data: { raw: extractedData, matched: true },
        approved: false,
        uploaded_by: user.id,
      };
    })
    .filter((record): record is NonNullable<typeof record> => record !== null);

  await Promise.all(
    salaryRecordsToInsert.map(async (record) => {
      const { error } = await supabase.from('employee_salary').upsert(
        {
          ...record,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'employee_id,salary_month,salary_year',
        },
      );
      if (error) throw error;
    }),
  );

  return {
    matchedCount: salaryRecordsToInsert.length,
    unmatchedCount: extractedData.length - salaryRecordsToInsert.length,
    extractedCount: extractedData.length,
    documentPath: filePath,
  };
}
