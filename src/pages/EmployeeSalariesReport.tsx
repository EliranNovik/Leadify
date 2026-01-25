import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { DocumentArrowUpIcon, XMarkIcon, XCircleIcon, EyeIcon } from '@heroicons/react/24/outline';
import DocumentViewerModal from '../components/DocumentViewerModal';

interface EmployeeSalaryData {
    employeeId: number;
    employeeName: string;
    department: string;
    role: string;
    salary: number; // gross_salary (Total Cost)
    netSalary: number | null; // net_salary (Salary)
    salaryBudget: number;
    workerId?: string;
}

interface SalaryRecord {
    id: number;
    employee_id: number;
    worker_id: string | null;
    salary_month: number;
    salary_year: number;
    gross_salary: number;
    net_salary: number | null;
    document_url: string | null;
    approved: boolean;
    created_at: string;
    tenants_employee?: {
        display_name: string;
        worker_id: string | null;
        bonuses_role?: string;
        photo_url?: string | null;
        tenant_departement?: {
            name: string;
        } | Array<{
            name: string;
        }>;
    };
}

// Helper function to get initials from name
const getInitials = (name: string): string => {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
};

// Helper function to map role codes to display names
const getRoleDisplayName = (roleCode: string): string => {
    const roleMap: { [key: string]: string } = {
        'c': 'Closer',
        's': 'Scheduler',
        'h': 'Handler',
        'n': 'No role',
        'e': 'Expert',
        'z': 'Manager',
        'Z': 'Manager',
        'p': 'Partner',
        'm': 'Manager',
        'dm': 'Department Manager',
        'pm': 'Project Manager',
        'se': 'Secretary',
        'b': 'Book keeper',
        'partners': 'Partners',
        'dv': 'Developer',
        'ma': 'Marketing',
        'P': 'Partner',
        'M': 'Manager',
        'DM': 'Department Manager',
        'PM': 'Project Manager',
        'SE': 'Secretary',
        'B': 'Book keeper',
        'Partners': 'Partners',
        'd': 'Diverse',
        'f': 'Finance'
    };

    return roleMap[roleCode] || roleCode || 'No role';
};

const EmployeeSalariesReport = () => {
    const navigate = useNavigate();
    const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
    const [checkingSuperUser, setCheckingSuperUser] = useState<boolean>(true);
    const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [parsing, setParsing] = useState(false);
    const [salaryData, setSalaryData] = useState<EmployeeSalaryData[]>([]);
    const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<{ url: string; name: string } | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Generate month options (1-12)
    const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1).map(month => ({
        value: month,
        label: new Date(2000, month - 1, 1).toLocaleString('en-US', { month: 'long' })
    }));

    // Generate year options (last 5 years to next 2 years)
    const currentYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 8 }, (_, i) => currentYear - 5 + i);

    // Check superuser status
    useEffect(() => {
        const fetchSuperUserStatus = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .select('is_superuser')
                        .eq('auth_id', user.id)
                        .single();

                    // If not found by auth_id, try by email
                    if ((userError || !userData) && user.email) {
                        const { data: userByEmail } = await supabase
                            .from('users')
                            .select('is_superuser')
                            .eq('email', user.email)
                            .maybeSingle();

                        if (userByEmail) {
                            const isSuper = userByEmail.is_superuser === true || userByEmail.is_superuser === 'true' || userByEmail.is_superuser === 1;
                            setIsSuperUser(isSuper);
                            if (!isSuper) {
                                toast.error('Access denied. This report is only available to superusers.');
                                navigate('/reports');
                            }
                        } else {
                            setIsSuperUser(false);
                            toast.error('Access denied. This report is only available to superusers.');
                            navigate('/reports');
                        }
                    } else if (userData) {
                        const isSuper = userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1;
                        setIsSuperUser(isSuper);
                        if (!isSuper) {
                            toast.error('Access denied. This report is only available to superusers.');
                            navigate('/reports');
                        }
                    } else {
                        setIsSuperUser(false);
                        toast.error('Access denied. This report is only available to superusers.');
                        navigate('/reports');
                    }
                } else {
                    setIsSuperUser(false);
                    toast.error('Access denied. This report is only available to superusers.');
                    navigate('/reports');
                }
            } catch (error) {
                console.error('Error fetching superuser status:', error);
                setIsSuperUser(false);
                toast.error('Access denied. This report is only available to superusers.');
                navigate('/reports');
            } finally {
                setCheckingSuperUser(false);
            }
        };

        fetchSuperUserStatus();
    }, [navigate]);

    // Fetch salary data
    const fetchSalaryData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch salary records for the selected month and year
            const { data: records, error } = await supabase
                .from('employee_salary')
                .select(`
            id,
            employee_id,
            worker_id,
            salary_month,
            salary_year,
            gross_salary,
            net_salary,
            document_url,
            approved,
            created_at,
            tenants_employee!employee_id (
              display_name,
              worker_id,
              bonuses_role,
              photo_url,
              tenant_departement!department_id (
                name
              )
            )
          `)
                .eq('salary_month', selectedMonth)
                .eq('salary_year', selectedYear);
            // Show all records (approved and pending) for the uploaded documents table

            const allRecords: SalaryRecord[] = [];
            if (error) {
                console.error('Error fetching salary records:', error);
            } else if (records) {
                // Transform records to match SalaryRecord interface
                const transformedRecords: SalaryRecord[] = records.map((record: any) => ({
                    ...record,
                    tenants_employee: Array.isArray(record.tenants_employee)
                        ? record.tenants_employee[0]
                        : record.tenants_employee
                }));
                allRecords.push(...transformedRecords);
            }

            setSalaryRecords(allRecords);

            // Fetch employees with their roles and salary budget from sales contribution
            const { data: employees, error: employeesError } = await supabase
                .from('tenants_employee')
                .select(`
          id,
          display_name,
          worker_id,
          bonuses_role,
          tenant_departement!department_id (
            name
          )
        `)
                .not('worker_id', 'is', null);

            if (employeesError) {
                console.error('Error fetching employees:', employeesError);
                toast.error('Failed to fetch employees');
                return;
            }

            // Map salary records to employees
            const employeeMap = new Map<number, EmployeeSalaryData>();

            // Initialize all employees
            employees?.forEach((emp: any) => {
                const dept = Array.isArray(emp.tenant_departement)
                    ? emp.tenant_departement[0]
                    : emp.tenant_departement;

                employeeMap.set(emp.id, {
                    employeeId: emp.id,
                    employeeName: emp.display_name,
                    department: dept?.name || 'Unknown',
                    role: emp.bonuses_role || '',
                    salary: 0,
                    netSalary: null,
                    salaryBudget: 0,
                    workerId: emp.worker_id
                });
            });

            // Add salary data from approved records only (for main table)
            allRecords
                .filter(record => record.approved) // Only approved salaries in main table
                .forEach(record => {
                    const employee = employeeMap.get(record.employee_id);
                    if (employee) {
                        employee.salary = record.gross_salary;
                        employee.netSalary = record.net_salary;
                        // Salary budget will be fetched from sales contribution
                        employee.salaryBudget = 0; // Will be calculated from sales contribution
                    }
                });

            // Fetch salary budget from sales contribution
            // Match employees by employee_id and get their salary budget for the date range
            // This would require fetching from sales_contribution_settings or calculating
            // For now, we'll leave it as 0 and can enhance later with actual sales contribution data

            const finalSalaryData = Array.from(employeeMap.values()).filter(emp => emp.salary > 0);
            setSalaryData(finalSalaryData);
        } catch (error) {
            console.error('Error fetching salary data:', error);
            toast.error('Failed to fetch salary data');
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, selectedYear]);

    // Parse PDF and extract salary data
    const parsePDF = useCallback(async (file: File): Promise<Array<{ workerId: string; grossSalary: number; netSalary: number | null }>> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target?.result as ArrayBuffer;

                    // Use PDF.js from CDN for PDF parsing
                    // Load PDF.js from CDN (no npm dependency required to avoid Vite build issues)
                    let pdfjsLib: any = (window as any).pdfjsLib || (window as any).pdfjs;

                    if (!pdfjsLib) {
                        // Load from CDN using UMD build
                        await new Promise<void>((resolve, reject) => {
                            // Check if script already exists
                            const existingScript = document.querySelector('script[data-pdfjs]');
                            if (existingScript) {
                                pdfjsLib = (window as any).pdfjsLib || (window as any).pdfjs;
                                if (pdfjsLib) {
                                    resolve();
                                    return;
                                }
                            }

                            const script = document.createElement('script');
                            // Use jsDelivr CDN which has better UMD support
                            script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
                            script.setAttribute('data-pdfjs', 'true');
                            script.onload = () => {
                                // Try multiple possible global names
                                pdfjsLib = (window as any).pdfjsLib ||
                                    (window as any).pdfjs ||
                                    (window as any).pdfjsDist ||
                                    (window as any).pdfjsDist?.default;
                                if (pdfjsLib) {
                                    resolve();
                                } else {
                                    reject(new Error('PDF.js loaded but not accessible. Please check browser console for errors.'));
                                }
                            };
                            script.onerror = () => reject(new Error('Failed to load PDF.js from CDN. Please check your internet connection.'));
                            document.head.appendChild(script);
                        });
                    }

                    if (!pdfjsLib) {
                        throw new Error('PDF.js library not available. Please install pdfjs-dist: npm install pdfjs-dist');
                    }

                    // Set worker source
                    if (pdfjsLib.GlobalWorkerOptions) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsLib.version
                            ? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`
                            : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
                    } else {
                        // Initialize GlobalWorkerOptions if it doesn't exist
                        pdfjsLib.GlobalWorkerOptions = {
                            workerSrc: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
                        };
                    }

                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const extractedData: Array<{ workerId: string; grossSalary: number; netSalary: number | null }> = [];
                    const seenWorkerIds = new Set<string>();

                    // Process all pages
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        const page = await pdf.getPage(pageNum);
                        const textContent = await page.getTextContent();

                        // Extract text items with their positions to understand table structure
                        const textItems: Array<{ text: string; x: number; y: number }> = textContent.items.map((item: any) => ({
                            text: item.str,
                            x: item.transform[4], // X position
                            y: item.transform[5]  // Y position
                        }));

                        // Group text items by Y position (rows) and X position (columns)
                        // Use a more flexible grouping - items within 5 pixels of Y are in the same row
                        const rows = new Map<number, Array<{ text: string; x: number }>>();
                        textItems.forEach(item => {
                            const y = Math.round(item.y / 5) * 5; // Round to nearest 5 pixels for row grouping
                            if (!rows.has(y)) {
                                rows.set(y, []);
                            }
                            rows.get(y)!.push({ text: item.text, x: item.x });
                        });

                        // Sort items in each row by X position (left to right, which is right to left in Hebrew)
                        rows.forEach((items, y) => {
                            items.sort((a, b) => a.x - b.x); // Sort by X position
                        });

                        // Process each row
                        const sortedRows = Array.from(rows.entries()).sort((a, b) => b[0] - a[0]); // Sort by Y position (top to bottom)

                        // Debug: Log first few rows for page 1 with detailed structure
                        if (pageNum === 1) {
                            console.log(`📄 PDF Page ${pageNum} - Processing ${sortedRows.length} rows`);
                            console.log(`📄 PDF Page ${pageNum} - First 10 rows with structure:`, sortedRows.slice(0, 10).map(([y, items]) => ({
                                y,
                                text: items.map(i => i.text).join(' '),
                                firstItems: items.slice(0, 10).map(i => i.text),
                                itemsWithX: items.slice(0, 5).map(i => ({ text: i.text, x: Math.round(i.x) })),
                                itemCount: items.length
                            })));
                        }

                        for (const [yPos, items] of sortedRows) {
                            const texts = items.map(i => i.text);
                            const rowText = texts.join(' ');

                            // Check for "134" on ALL pages, not just page 1
                            if (rowText.includes('134') || texts.some(t => t.includes('134'))) {
                                console.log(`🎯 FOUND "134" in Page ${pageNum}, Row ${yPos}!`);
                                console.log(`   Full row text: "${rowText}"`);
                                console.log(`   All text items:`, texts);
                                console.log(`   Items with positions:`, items.map(i => ({ text: i.text, x: Math.round(i.x) })));
                                console.log(`   Items containing "134":`, items.filter(i => i.text.includes('134')).map(i => ({ text: i.text, x: Math.round(i.x) })));
                            }

                            // Debug: Log full row structure for first few rows
                            if (pageNum === 1 && yPos >= sortedRows[0][0] && yPos <= sortedRows[Math.min(5, sortedRows.length - 1)][0]) {
                                // Find all numbers in the row for debugging
                                const allNumbers = rowText.match(/\b\d{1,4}\b/g) || [];
                                const all2to4DigitNumbers = rowText.match(/\b\d{2,4}\b/g) || [];

                                console.log(`\n📋 Row ${yPos} - Full structure:`, {
                                    textItems: texts,
                                    textItemsCount: texts.length,
                                    itemsWithX: items.slice(0, 10).map(i => ({ text: i.text, x: Math.round(i.x) })),
                                    fullText: rowText.substring(0, 300),
                                    first10Items: texts.slice(0, 10),
                                    allNumbersFound: allNumbers,
                                    all2to4DigitNumbers: all2to4DigitNumbers,
                                    contains134: rowText.includes('134') || texts.some(t => t.includes('134'))
                                });
                            }


                            // Look for employee number (מספר עובד) - this is typically a short number (1-4 digits)
                            // Based on the PDF structure, the employee number is at the END of the row (last column)
                            // Employee numbers are like: 4, 134, 182, 183, etc. (not 9-digit Israeli ID numbers)

                            let workerId: string | null = null;

                            // Strategy 1: Extract from the LAST column (leftmost X position for Hebrew RTL, or rightmost for LTR)
                            // The employee number is typically the last item in the row
                            if (items.length > 0) {
                                // Try leftmost X (smallest X) - this is the last column in Hebrew RTL
                                const sortedByXLeft = [...items].sort((a, b) => a.x - b.x);
                                const lastColumnItem = sortedByXLeft[0];

                                if (lastColumnItem && /^\d{1,4}$/.test(lastColumnItem.text.trim())) {
                                    workerId = lastColumnItem.text.trim();
                                    if (pageNum === 1) {
                                        console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number in last column (leftmost X=${Math.round(lastColumnItem.x)}): "${workerId}"`);
                                        console.log(`   Last 5 columns (by X position):`, sortedByXLeft.slice(0, 5).map(i => ({ text: i.text, x: Math.round(i.x) })));
                                    }
                                } else {
                                    // Try rightmost X (largest X) in case PDF is LTR
                                    const sortedByXRight = [...items].sort((a, b) => b.x - a.x);
                                    const rightmostItem = sortedByXRight[0];
                                    if (rightmostItem && /^\d{1,4}$/.test(rightmostItem.text.trim())) {
                                        workerId = rightmostItem.text.trim();
                                        if (pageNum === 1) {
                                            console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number in last column (rightmost X=${Math.round(rightmostItem.x)}): "${workerId}"`);
                                        }
                                    }
                                }

                                // Also try the last text item in the array (often the employee number)
                                if (!workerId && texts.length > 0) {
                                    const lastTextItem = texts[texts.length - 1].trim();
                                    if (/^\d{1,4}$/.test(lastTextItem)) {
                                        workerId = lastTextItem;
                                        if (pageNum === 1) {
                                            console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number in last text item: "${workerId}"`);
                                        }
                                    }
                                }
                            }

                            // Strategy 2: Look through text items from the END to find employee number (1-4 digits)
                            // Employee numbers are typically at the end of the row
                            if (!workerId) {
                                // Start from the end and work backwards
                                for (let i = texts.length - 1; i >= Math.max(0, texts.length - 10); i--) {
                                    const item = texts[i].trim();
                                    // Look for 1-4 digit numbers (employee numbers can be single digits like "4")
                                    if (/^\d{1,4}$/.test(item)) {
                                        workerId = item;
                                        if (pageNum === 1) {
                                            console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number at text position ${i} (from end): "${workerId}"`);
                                            console.log(`   Text items around position ${i}:`, texts.slice(Math.max(0, i - 2), i + 3));
                                        }
                                        break;
                                    }
                                }
                            }

                            // Strategy 3: Look for 1-4 digit numbers at the end of the row text
                            if (!workerId) {
                                const employeeNumberPattern = /(\d{1,4})\s*$/; // 1-4 digits at end of row
                                const endMatch = rowText.match(employeeNumberPattern);

                                if (endMatch) {
                                    workerId = endMatch[1];
                                    if (pageNum === 1) {
                                        console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number at end: "${workerId}"`);
                                    }
                                }
                            }

                            // Validate: Make sure it's not a 9-digit Israeli ID number
                            if (workerId) {
                                if (workerId.length >= 8) {
                                    // Too long to be an employee number, probably an ID number
                                    if (pageNum === 1) {
                                        console.log(`⚠️ Page ${pageNum} Row ${yPos} - Rejecting "${workerId}" (too long, likely ID number)`);
                                    }
                                    workerId = null;
                                }
                                // Note: We now allow single digits (1-4 digits) as employee numbers can be like "4", "134", etc.
                            }

                            // Debug: Log if we found a worker ID
                            if (workerId && pageNum === 1) {
                                console.log(`✅ Page ${pageNum} Row ${yPos} - Extracted employee number: "${workerId}"`);
                                console.log(`   Full row text: "${rowText.substring(0, 300)}"`);
                            } else if (!workerId && pageNum === 1 && yPos >= sortedRows[0][0] && yPos <= sortedRows[Math.min(3, sortedRows.length - 1)][0]) {
                                // Log when we don't find an employee number for first few rows
                                console.log(`❌ Page ${pageNum} Row ${yPos} - No employee number found`);
                                console.log(`   Row text: "${rowText.substring(0, 200)}"`);
                                console.log(`   First 10 text items:`, texts.slice(0, 10));
                                console.log(`   First 5 items with X positions:`, items.slice(0, 5).map(i => ({ text: i.text, x: Math.round(i.x) })));
                            }

                            if (workerId && !seenWorkerIds.has(workerId)) {
                                // Extract salaries from specific column positions
                                // In Hebrew RTL layout, columns are ordered from right to left
                                // Net salary (סה״כ משכורת נטו) is the 6th column from the right (index 5)
                                // Gross salary (סה״כ משכורת ברוטו) is typically the 5th column from the right (index 4)

                                let netSalary = 0;
                                let grossSalary = 0;

                                // Sort items by X position (leftmost first, which is rightmost in RTL)
                                const sortedByX = [...items].sort((a, b) => a.x - b.x);

                                // Net salary: 6th column from right = index 5 (0-based from right)
                                // Since sortedByX is left-to-right, we need to count from the end
                                // Actually, if it's RTL, the rightmost column has the largest X, so we need to reverse
                                // Let me try: if items are sorted left-to-right, then rightmost is at the end
                                // But Hebrew RTL means rightmost column is first visually

                                // Try both directions to find the correct column
                                // Option 1: Count from left (smallest X = first column in LTR)
                                // Option 2: Count from right (largest X = first column in RTL)

                                // Try both sorting directions to handle different PDF coordinate systems
                                // Option 1: Rightmost first (largest X = rightmost in RTL)
                                const sortedByXRight = [...items].sort((a, b) => b.x - a.x);
                                // Option 2: Leftmost first (smallest X = leftmost, count from end for RTL)
                                const sortedByXLeft = [...items].sort((a, b) => a.x - b.x);

                                // Debug: Show all columns for first few rows
                                if (pageNum === 1 && yPos >= sortedRows[0][0] && yPos <= sortedRows[Math.min(3, sortedRows.length - 1)][0]) {
                                    console.log(`\n💰 Salary Extraction - Row ${yPos}:`);
                                    console.log(`   All columns (sorted right-to-left, largest X first):`, sortedByXRight.map((i, idx) => ({
                                        columnFromRight: idx + 1,
                                        index: idx,
                                        text: i.text,
                                        x: Math.round(i.x),
                                        isNumber: /^\d+([.,]\d+)?$/.test(i.text.replace(/,/g, ''))
                                    })));
                                    console.log(`   All columns (sorted left-to-right, smallest X first):`, sortedByXLeft.map((i, idx) => ({
                                        columnFromLeft: idx + 1,
                                        index: idx,
                                        text: i.text,
                                        x: Math.round(i.x),
                                        isNumber: /^\d+([.,]\d+)?$/.test(i.text.replace(/,/g, ''))
                                    })));
                                    // For RTL, if sorted left-to-right, we count from the end
                                    const rtlFromLeft = sortedByXLeft.length - 1;
                                    console.log(`   If RTL (count from end of left-to-right): Net salary would be at index ${rtlFromLeft - 5} (6th from right)`);
                                }

                                // Net salary: Move one more index to the left (from index 6 to index 7, which is 8th column from right)
                                // Try both sorting directions

                                // Method 1: Right-to-left sorted (largest X first)
                                // Try index 7 first (8th column from right), then nearby indices
                                const netSalaryIndicesRight = [7, 6, 8, 5, 9]; // Try index 7 first (moved one more to the left from 6)
                                for (const idx of netSalaryIndicesRight) {
                                    if (sortedByXRight.length > idx) {
                                        const netSalaryItem = sortedByXRight[idx];
                                        const netSalaryText = netSalaryItem.text.trim().replace(/,/g, '');
                                        const netSalaryValue = parseFloat(netSalaryText);
                                        // Net salary is typically smaller than gross salary and in range 1,000 - 50,000
                                        if (!isNaN(netSalaryValue) && netSalaryValue > 0 && netSalaryValue < 50000) {
                                            netSalary = netSalaryValue;
                                            if (pageNum === 1) {
                                                console.log(`   ✅ Found net salary (RTL method) at index ${idx} (${idx + 1}th column from right): "${netSalaryItem.text}" = ${netSalary}`);
                                            }
                                            break; // Found it, stop searching
                                        } else if (pageNum === 1 && idx === 7) {
                                            console.log(`   ⚠️ Net salary (RTL) at index 7: "${netSalaryItem.text}" (parsed: ${netSalaryValue}, valid: ${!isNaN(netSalaryValue) && netSalaryValue > 0 && netSalaryValue < 50000})`);
                                        }
                                    }
                                }

                                // Method 2: Left-to-right sorted, count from end (if PDF uses LTR coordinates)
                                if (netSalary === 0 && sortedByXLeft.length > 7) {
                                    // 8th from right = (total - 7) from left (moved one more to the left from 7th)
                                    const netSalaryIndexFromLeft = sortedByXLeft.length - 8; // 8th from right
                                    if (netSalaryIndexFromLeft >= 0) {
                                        const netSalaryItem = sortedByXLeft[netSalaryIndexFromLeft];
                                        const netSalaryText = netSalaryItem.text.trim().replace(/,/g, '');
                                        const netSalaryValue = parseFloat(netSalaryText);
                                        if (!isNaN(netSalaryValue) && netSalaryValue > 0 && netSalaryValue < 50000) {
                                            netSalary = netSalaryValue;
                                            if (pageNum === 1) {
                                                console.log(`   ✅ Found net salary (LTR method) at index ${netSalaryIndexFromLeft} from left (8th from right): "${netSalaryItem.text}" = ${netSalary}`);
                                            }
                                        }
                                    }
                                }

                                // Gross salary: Use pattern matching to find the largest number in salary range
                                // This was working before, so we'll revert to this approach
                                const salaryPatterns = [
                                    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g, // With commas
                                    /(\d{4,6})/g // 4-6 digits
                                ];

                                for (const pattern of salaryPatterns) {
                                    const matches = rowText.matchAll(pattern);
                                    for (const match of matches) {
                                        const candidate = parseFloat(match[1].replace(/,/g, ''));
                                        // Gross salary range: 5,000 to 200,000 NIS
                                        if (candidate >= 5000 && candidate <= 200000) {
                                            // Take the largest valid number in the row (gross salary is usually the largest)
                                            if (candidate > grossSalary) {
                                                grossSalary = candidate;
                                            }
                                        }
                                    }
                                }

                                if (pageNum === 1 && grossSalary > 0) {
                                    console.log(`   ✅ Found gross salary via pattern matching: ${grossSalary}`);
                                } else if (pageNum === 1 && grossSalary === 0) {
                                    console.log(`   ⚠️ No gross salary found in row (range 5000-200000)`);
                                }

                                if (grossSalary > 0) {
                                    seenWorkerIds.add(workerId);
                                    extractedData.push({
                                        workerId,
                                        grossSalary,
                                        netSalary: netSalary > 0 ? netSalary : null
                                    });
                                    console.log(`✅ Page ${pageNum} Row ${yPos} - Extracted: workerId="${workerId}", grossSalary=${grossSalary}, netSalary=${netSalary || 'N/A'}`);
                                    if (pageNum === 1) {
                                        console.log(`   Column positions:`, sortedByXRight.slice(0, 10).map((i, idx) => ({
                                            position: idx,
                                            text: i.text,
                                            x: Math.round(i.x)
                                        })));
                                    }
                                } else {
                                    if (pageNum === 1) {
                                        console.log(`⚠️ Page ${pageNum} Row ${yPos} - Found workerId "${workerId}" but no valid salary in range 5000-200000`);
                                        console.log(`   Row text: "${rowText.substring(0, 200)}"`);
                                    }
                                }
                            } else if (workerId && seenWorkerIds.has(workerId)) {
                                if (pageNum === 1) {
                                    console.log(`ℹ️ Page ${pageNum} Row ${yPos} - workerId "${workerId}" already seen, skipping`);
                                }
                            }
                        }
                    }

                    // Debug: Log extracted data
                    console.log('📄 PDF Parsing - Extracted data so far:', extractedData);
                    console.log('📄 PDF Parsing - Total extracted records:', extractedData.length);

                    if (extractedData.length === 0) {
                        // Fallback: try simpler pattern matching
                        console.warn('⚠️ No data extracted with table parsing, trying fallback method...');

                        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                            const page = await pdf.getPage(pageNum);
                            const textContent = await page.getTextContent();
                            const fullText = textContent.items.map((item: any) => item.str).join(' ');

                            // Debug: Log full text for first page
                            if (pageNum === 1) {
                                console.log('📄 PDF Page 1 - Full text (first 500 chars):', fullText.substring(0, 500));
                            }

                            // Look for patterns: number followed by large number (worker ID + salary)
                            const pattern = /(\d{8,10})\s+[\d\s,]+(\d{4,6})/g;
                            let match;

                            while ((match = pattern.exec(fullText)) !== null) {
                                const workerId = match[1].replace(/\s/g, '');
                                const salary = parseFloat(match[2].replace(/,/g, ''));

                                console.log('🔍 Fallback pattern match - workerId:', workerId, 'salary:', salary);

                                if (salary >= 5000 && salary <= 200000 && !seenWorkerIds.has(workerId)) {
                                    seenWorkerIds.add(workerId);
                                    extractedData.push({ workerId, grossSalary: salary, netSalary: null });
                                }
                            }
                        }
                    }

                    // Final debug log
                    console.log('✅ PDF Parsing Complete - Final extracted data:', extractedData);
                    console.log('✅ PDF Parsing Complete - Total records:', extractedData.length);

                    // Summary: Show all unique employee numbers extracted
                    const uniqueWorkerIds = [...new Set(extractedData.map(d => d.workerId))].sort((a, b) => parseInt(a) - parseInt(b));
                    console.log('📊 PDF Parsing Summary:');
                    console.log(`   - Unique employee numbers extracted: ${uniqueWorkerIds.length}`);
                    console.log(`   - Employee numbers: [${uniqueWorkerIds.join(', ')}]`);
                    console.log(`   - Contains "134": ${uniqueWorkerIds.includes('134') ? '✅ YES' : '❌ NO'}`);

                    if (!uniqueWorkerIds.includes('134')) {
                        console.log('⚠️ WARNING: Employee number "134" was NOT found in the extracted data!');
                        console.log('   This means either:');
                        console.log('   1. "134" is not in the PDF');
                        console.log('   2. "134" is in the PDF but not being extracted correctly');
                        console.log('   3. "134" appears in a different format in the PDF');
                    }

                    resolve(extractedData);
                } catch (error) {
                    console.error('Error parsing PDF:', error);
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }, []);

    // Handle file upload
    const handleFileUpload = useCallback(async (file: File) => {
        if (!file.type.includes('pdf')) {
            toast.error('Please upload a PDF file');
            return;
        }

        setUploading(true);
        setParsing(true);

        try {
            // Parse PDF first
            const extractedData = await parsePDF(file);

            if (extractedData.length === 0) {
                toast.error('No salary data found in PDF. Please check the document format.');
                setUploading(false);
                setParsing(false);
                return;
            }

            // Upload PDF to storage
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                toast.error('User not authenticated');
                setUploading(false);
                setParsing(false);
                return;
            }

            const fileExt = file.name.split('.').pop();
            const fileName = `salary_${selectedYear}_${selectedMonth}_${Date.now()}.${fileExt}`;
            const filePath = `${user.id}/${fileName}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('employee-salary-documents')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                toast.error(`Failed to upload document: ${uploadError.message}`);
                setUploading(false);
                setParsing(false);
                return;
            }

            // Store file path (not public URL, since bucket is private)
            // We'll generate signed URLs when viewing documents

            // Match extracted data with employees by worker_id
            console.log('🔍 Matching Process - Starting...');
            console.log('🔍 Matching Process - Extracted data from PDF:', extractedData);

            const { data: employees, error: employeesError } = await supabase
                .from('tenants_employee')
                .select('id, worker_id, display_name');

            if (employeesError) {
                console.error('❌ Error fetching employees:', employeesError);
                toast.error('Failed to fetch employees for matching');
                setUploading(false);
                setParsing(false);
                return;
            }

            console.log('👥 Database Employees - Total fetched:', employees?.length || 0);
            console.log('👥 Database Employees - Full list:', employees);

            // Create a map of worker_id to employee_id
            const workerIdMap = new Map<string, number>();
            employees?.forEach((emp: any) => {
                if (emp.worker_id) {
                    // Debug: Show raw value and type
                    console.log(`🔍 Raw DB value - employee_id: ${emp.id}, worker_id: "${emp.worker_id}" (type: ${typeof emp.worker_id}, valueOf: ${emp.worker_id?.valueOf?.()})`);

                    const normalizedWorkerId = emp.worker_id.toString().replace(/\s/g, '');
                    workerIdMap.set(normalizedWorkerId, emp.id);
                    console.log(`📝 Mapping - worker_id: "${emp.worker_id}" (normalized: "${normalizedWorkerId}") -> employee_id: ${emp.id}, name: ${emp.display_name}`);

                    // Also try adding variations (with/without leading zeros) for matching
                    if (normalizedWorkerId.length < 9) {
                        const withLeadingZeros = normalizedWorkerId.padStart(9, '0');
                        if (!workerIdMap.has(withLeadingZeros)) {
                            workerIdMap.set(withLeadingZeros, emp.id);
                            console.log(`📝 Mapping (padded) - worker_id: "${withLeadingZeros}" -> employee_id: ${emp.id}`);
                        }
                    }
                } else {
                    console.log(`⚠️ Employee ${emp.id} (${emp.display_name}) has no worker_id`);
                }
            });

            console.log('🗺️ Worker ID Map - Total entries:', workerIdMap.size);
            console.log('🗺️ Worker ID Map - Keys:', Array.from(workerIdMap.keys()));

            // Prepare salary records to insert
            console.log('🔄 Starting matching process for', extractedData.length, 'extracted records...');

            const salaryRecordsToInsert = extractedData
                .map((item, index) => {
                    console.log(`\n🔍 Matching Record ${index + 1}/${extractedData.length}:`);
                    console.log(`   - Extracted workerId: "${item.workerId}" (type: ${typeof item.workerId})`);
                    console.log(`   - Extracted grossSalary: ${item.grossSalary}`);
                    console.log(`   - Extracted netSalary: ${item.netSalary || 'N/A'}`);

                    // Normalize the extracted workerId (remove spaces, convert to string)
                    const normalizedExtractedId = item.workerId.toString().replace(/\s/g, '');
                    console.log(`   - Normalized extracted workerId: "${normalizedExtractedId}"`);

                    // Try exact match first
                    let employeeId = workerIdMap.get(normalizedExtractedId);
                    console.log(`   - Direct lookup result: ${employeeId || 'NOT FOUND'}`);

                    // If not found, try with leading zeros
                    if (!employeeId) {
                        // Try with leading zero
                        const withLeadingZero = normalizedExtractedId.padStart(9, '0');
                        console.log(`   - Trying with leading zero: "${withLeadingZero}"`);
                        employeeId = workerIdMap.get(withLeadingZero);
                        console.log(`   - With leading zero result: ${employeeId || 'NOT FOUND'}`);
                    }

                    // If still not found, try without leading zeros
                    if (!employeeId) {
                        const withoutLeadingZeros = normalizedExtractedId.replace(/^0+/, '');
                        if (withoutLeadingZeros !== normalizedExtractedId) {
                            console.log(`   - Trying without leading zeros: "${withoutLeadingZeros}"`);
                            employeeId = workerIdMap.get(withoutLeadingZeros);
                            console.log(`   - Without leading zeros result: ${employeeId || 'NOT FOUND'}`);
                        }
                    }

                    // Debug: Show all map keys for comparison
                    if (!employeeId) {
                        console.log(`   ⚠️ NO MATCH FOUND for workerId: "${normalizedExtractedId}"`);
                        console.log(`   📋 Available worker_ids in database:`, Array.from(workerIdMap.keys()));
                        console.log(`   🔍 Checking similarity...`);
                        Array.from(workerIdMap.keys()).forEach(key => {
                            const similarity = normalizedExtractedId === key ? 'EXACT' :
                                normalizedExtractedId.includes(key) ? 'CONTAINS' :
                                    key.includes(normalizedExtractedId) ? 'IS_CONTAINED' : 'NO_MATCH';
                            console.log(`      - "${key}" vs "${normalizedExtractedId}": ${similarity}`);
                        });
                        return null; // No match found
                    }

                    console.log(`   ✅ MATCH FOUND! employee_id: ${employeeId}`);

                    return {
                        employee_id: employeeId,
                        worker_id: item.workerId,
                        salary_month: selectedMonth,
                        salary_year: selectedYear,
                        gross_salary: item.grossSalary,
                        net_salary: item.netSalary, // Extracted from 6th column from right
                        document_url: filePath, // Store file path for private bucket
                        extracted_data: { raw: extractedData, matched: true },
                        approved: false, // Require approval
                        uploaded_by: user.id
                    };
                })
                .filter((record): record is NonNullable<typeof record> => record !== null);

            console.log('\n📊 Matching Results:');
            console.log(`   - Total extracted: ${extractedData.length}`);
            console.log(`   - Successfully matched: ${salaryRecordsToInsert.length}`);
            console.log(`   - Unmatched: ${extractedData.length - salaryRecordsToInsert.length}`);

            // Check for existing records and update or insert
            const upsertPromises = salaryRecordsToInsert.map(async (record) => {
                const { error } = await supabase
                    .from('employee_salary')
                    .upsert({
                        ...record,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'employee_id,salary_month,salary_year'
                    });

                if (error) {
                    console.error('Error upserting salary record:', error);
                    throw error;
                }
            });

            await Promise.all(upsertPromises);

            const matchedCount = salaryRecordsToInsert.length;
            const unmatchedCount = extractedData.length - matchedCount;

            toast.success(
                `Successfully processed ${matchedCount} salary records. ${unmatchedCount > 0 ? `${unmatchedCount} records could not be matched.` : ''}`
            );

            // Refresh data
            await fetchSalaryData();
        } catch (error: any) {
            console.error('Error processing file:', error);
            toast.error(`Failed to process file: ${error.message || 'Unknown error'}`);
        } finally {
            setUploading(false);
            setParsing(false);
        }
    }, [selectedMonth, selectedYear, parsePDF, fetchSalaryData]);

    // Handle drag and drop
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    }, [handleFileUpload]);

    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFileUpload(files[0]);
        }
    }, [handleFileUpload]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('he-IL', {
            style: 'currency',
            currency: 'ILS',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const handleViewDocument = (documentUrl: string, documentName: string) => {
        setSelectedDocument({ url: documentUrl, name: documentName });
        setIsViewerOpen(true);
    };

    // Show loading while checking superuser status
    if (checkingSuperUser) {
        return (
            <div className="w-full px-4 py-6">
                <div className="flex items-center justify-center py-12">
                    <div className="loading loading-spinner loading-lg text-primary"></div>
                    <span className="ml-4 text-lg">Checking access...</span>
                </div>
            </div>
        );
    }

    // Redirect if not superuser (handled in useEffect, but add safety check)
    if (!isSuperUser) {
        return null;
    }

    return (
        <div className="w-full px-4 py-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-4">Employee Salaries Report</h1>

                {/* Filters */}
                <div className="card bg-base-100 shadow-lg mb-6">
                    <div className="card-body">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="label">
                                    <span className="label-text">Salary Month</span>
                                </label>
                                <select
                                    className="select select-bordered w-full"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                >
                                    {monthOptions.map(month => (
                                        <option key={month.value} value={month.value}>
                                            {month.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">
                                    <span className="label-text">Salary Year</span>
                                </label>
                                <select
                                    className="select select-bordered w-full"
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                                >
                                    {yearOptions.map(year => (
                                        <option key={year} value={year}>
                                            {year}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-4">
                            <button
                                className="btn btn-primary"
                                onClick={fetchSalaryData}
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <span className="loading loading-spinner loading-sm"></span>
                                        Loading...
                                    </>
                                ) : (
                                    'Load Salaries'
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Drag and Drop Zone */}
                <div className="card bg-base-100 shadow-lg mb-6">
                    <div className="card-body">
                        <h2 className="text-xl font-bold mb-4">Upload Payroll Document</h2>
                        <div
                            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragOver
                                ? 'border-primary bg-primary/10'
                                : 'border-gray-300 hover:border-gray-400'
                                } ${uploading || parsing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => !uploading && !parsing && fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={handleFileInputChange}
                                disabled={uploading || parsing}
                            />
                            <DocumentArrowUpIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            {uploading || parsing ? (
                                <div>
                                    <span className="loading loading-spinner loading-md"></span>
                                    <p className="mt-2 text-gray-600">
                                        {parsing ? 'Parsing PDF...' : 'Uploading document...'}
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-lg font-semibold mb-2">
                                        Drag and drop a PDF file here, or click to browse
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        Upload payroll document (דוח תמחיר) to extract salary data
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Salary Data Table */}
                {salaryData.length > 0 && (
                    <div className="mb-6">
                        <h2 className="text-xl font-bold mb-4">Employee Salaries</h2>
                        <div className="overflow-x-auto">
                            <table className="table w-full">
                                <thead>
                                    <tr>
                                        <th>Employee</th>
                                        <th>Department</th>
                                        <th>Role</th>
                                        <th className="text-right">Salary</th>
                                        <th className="text-right">Total Cost</th>
                                        <th className="text-right">Salary Budget</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {salaryData.map((emp) => (
                                        <tr key={emp.employeeId}>
                                            <td>{emp.employeeName}</td>
                                            <td>{emp.department}</td>
                                            <td>{getRoleDisplayName(emp.role)}</td>
                                            <td className="text-right">
                                                {emp.netSalary ? formatCurrency(emp.netSalary) : 'N/A'}
                                            </td>
                                            <td className="text-right">{formatCurrency(emp.salary)}</td>
                                            <td className="text-right">{formatCurrency(emp.salaryBudget)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="font-bold">
                                        <td colSpan={3}>Total</td>
                                        <td className="text-right">
                                            {formatCurrency(salaryData.reduce((sum, emp) => sum + (emp.netSalary || 0), 0))}
                                        </td>
                                        <td className="text-right">
                                            {formatCurrency(salaryData.reduce((sum, emp) => sum + emp.salary, 0))}
                                        </td>
                                        <td className="text-right">
                                            {formatCurrency(salaryData.reduce((sum, emp) => sum + emp.salaryBudget, 0))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {/* Uploaded Documents */}
                {salaryRecords.length > 0 && (
                    <div>
                        <h2 className="text-xl font-bold mb-4">Uploaded Documents</h2>
                        <div className="overflow-x-auto">
                            <table className="table w-full">
                                <thead>
                                    <tr>
                                        <th>Employee</th>
                                        <th>Department</th>
                                        <th>Role</th>
                                        <th>Month/Year</th>
                                        <th className="text-right">Salary</th>
                                        <th className="text-right">Total Cost</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {salaryRecords.map((record) => {
                                        const employee = record.tenants_employee;
                                        const department = Array.isArray(employee?.tenant_departement)
                                            ? employee.tenant_departement[0]?.name
                                            : employee?.tenant_departement?.name;
                                        const photoUrl = employee?.photo_url;
                                        const displayName = employee?.display_name || 'Unknown';
                                        const initials = getInitials(displayName);

                                        return (
                                            <tr key={record.id}>
                                                <td>
                                                    <div className="flex items-center gap-3">
                                                        {photoUrl ? (
                                                            <div className="avatar">
                                                                <div className="w-10 h-10 rounded-full">
                                                                    <img
                                                                        src={photoUrl}
                                                                        alt={displayName}
                                                                        className="w-full h-full object-cover rounded-full"
                                                                        onError={(e) => {
                                                                            const target = e.target as HTMLImageElement;
                                                                            target.style.display = 'none';
                                                                            const parent = target.parentElement;
                                                                            if (parent) {
                                                                                parent.innerHTML = `
                                                                                    <div class="w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm">
                                                                                        ${initials}
                                                                                    </div>
                                                                                `;
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="avatar">
                                                                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm">
                                                                    {initials}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <span>{displayName}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    {department || 'Unknown'}
                                                </td>
                                                <td>
                                                    {employee?.bonuses_role ? getRoleDisplayName(employee.bonuses_role) : 'N/A'}
                                                </td>
                                                <td>
                                                    {record.salary_month}/{record.salary_year}
                                                </td>
                                                <td className="text-right">
                                                    {record.net_salary ? formatCurrency(record.net_salary) : 'N/A'}
                                                </td>
                                                <td className="text-right">
                                                    {formatCurrency(record.gross_salary)}
                                                </td>
                                                <td>
                                                    {record.document_url && (
                                                        <button
                                                            className="btn btn-ghost btn-xs"
                                                            onClick={() => handleViewDocument(record.document_url!, 'Payroll Document')}
                                                        >
                                                            <EyeIcon className="w-4 h-4" />
                                                            View
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Document Viewer Modal */}
            {selectedDocument && (
                <DocumentViewerModal
                    documentUrl={selectedDocument.url}
                    documentName={selectedDocument.name}
                    employeeName=""
                    uploadedAt={new Date().toISOString()}
                    sickDaysReason=""
                    isOpen={isViewerOpen}
                    bucketName="employee-salary-documents"
                    onClose={() => {
                        setIsViewerOpen(false);
                        setSelectedDocument(null);
                    }}
                />
            )}
        </div>
    );
};

export default EmployeeSalariesReport;
