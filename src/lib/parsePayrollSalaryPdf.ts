/** Parse דוח תמחיר / payroll PDF into worker salaries (same logic as Employee Salaries report). */

export type PayrollPdfExtractedRow = { workerId: string; grossSalary: number; netSalary: number | null };

export async function parsePayrollSalaryPdf(file: File): Promise<PayrollPdfExtractedRow[]> {
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
                        // Use a more flexible grouping - items within 3 pixels of Y are in the same row
                        // This is more lenient to catch rows that might be slightly misaligned
                        const rows = new Map<number, Array<{ text: string; x: number }>>();
                        textItems.forEach(item => {
                            const y = Math.round(item.y / 3) * 3; // Round to nearest 3 pixels for row grouping (more lenient)
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
                                    if (pageNum === 1 || extractedData.length < 5) {
                                        console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number at end: "${workerId}"`);
                                    }
                                }
                            }

                            // Strategy 4: Look for employee numbers in the last few text items (more flexible)
                            if (!workerId && texts.length > 5) {
                                // Check last 5 text items for 1-4 digit numbers
                                for (let i = texts.length - 1; i >= Math.max(0, texts.length - 5); i--) {
                                    const item = texts[i].trim();
                                    // Look for 1-4 digit numbers that aren't part of a larger number
                                    if (/^\d{1,4}$/.test(item) && parseInt(item) > 0 && parseInt(item) < 10000) {
                                        workerId = item;
                                        if (pageNum === 1 || extractedData.length < 5) {
                                            console.log(`🔍 Page ${pageNum} Row ${yPos} - Found employee number in last items (position ${i}): "${workerId}"`);
                                        }
                                        break;
                                    }
                                }
                            }

                            // Validate: Make sure it's not a 9-digit Israeli ID number or "0"
                            if (workerId) {
                                if (workerId.length >= 8) {
                                    // Too long to be an employee number, probably an ID number
                                    if (pageNum === 1 || extractedData.length < 5) {
                                        console.log(`⚠️ Page ${pageNum} Row ${yPos} - Rejecting "${workerId}" (too long, likely ID number)`);
                                    }
                                    workerId = null;
                                } else if (workerId === '0' || workerId === '00' || workerId === '000') {
                                    // Reject "0" as it's likely not a valid employee number
                                    if (pageNum === 1 || extractedData.length < 5) {
                                        console.log(`⚠️ Page ${pageNum} Row ${yPos} - Rejecting "${workerId}" (likely not a valid employee number)`);
                                    }
                                    workerId = null;
                                }
                                // Note: We now allow single digits (1-4 digits) as employee numbers can be like "4", "134", etc.
                            }

                            // Debug: Log if we found a worker ID (for all pages, but more detailed for page 1)
                            if (workerId) {
                                if (pageNum === 1 || extractedData.length < 5) {
                                    console.log(`✅ Page ${pageNum} Row ${yPos} - Extracted employee number: "${workerId}"`);
                                    console.log(`   Full row text: "${rowText.substring(0, 300)}"`);
                                }
                            } else {
                                // Log when we don't find an employee number (for all pages, but more detailed for first few rows)
                                const isFirstFewRows = yPos >= sortedRows[0][0] && yPos <= sortedRows[Math.min(5, sortedRows.length - 1)][0];
                                if (pageNum === 1 || (isFirstFewRows && pageNum <= 2)) {
                                    console.log(`❌ Page ${pageNum} Row ${yPos} - No employee number found`);
                                    console.log(`   Row text: "${rowText.substring(0, 300)}"`);
                                    console.log(`   All numbers in row:`, rowText.match(/\d+/g) || []);
                                    console.log(`   First 10 text items:`, texts.slice(0, 10));
                                    console.log(`   First 5 items with X positions:`, items.slice(0, 5).map(i => ({ text: i.text, x: Math.round(i.x) })));
                                }
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

                                // Gross salary: Extract from second column from left (index 1 in sortedByXLeft)
                                // Second column from left = index 1 (0-based, where 0 is first column)
                                if (sortedByXLeft.length > 1) {
                                    const grossSalaryItem = sortedByXLeft[1]; // Second column from left
                                    const grossSalaryText = grossSalaryItem.text.trim().replace(/,/g, '');
                                    const grossSalaryValue = parseFloat(grossSalaryText);
                                    // Gross salary range: 1,000 to 200,000 NIS (reasonable range)
                                    if (!isNaN(grossSalaryValue) && grossSalaryValue >= 1000 && grossSalaryValue <= 200000) {
                                        grossSalary = grossSalaryValue;
                                        if (pageNum === 1 || extractedData.length < 5) {
                                            console.log(`   ✅ Found gross salary (2nd column from left) at index 1: "${grossSalaryItem.text}" = ${grossSalary}`);
                                        }
                                    } else {
                                        if (pageNum === 1 || extractedData.length < 5) {
                                            console.log(`   ⚠️ Gross salary at 2nd column from left: "${grossSalaryItem.text}" (parsed: ${grossSalaryValue}, valid: ${!isNaN(grossSalaryValue) && grossSalaryValue >= 1000 && grossSalaryValue <= 200000})`);
                                        }
                                    }
                                }

                                // Fallback: Use pattern matching if column method didn't work
                                if (grossSalary === 0) {
                                    const salaryPatterns = [
                                        /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g, // With commas
                                        /(\d{3,7})/g // 3-7 digits
                                    ];

                                    for (const pattern of salaryPatterns) {
                                        const matches = rowText.matchAll(pattern);
                                        for (const match of matches) {
                                            const candidate = parseFloat(match[1].replace(/,/g, ''));
                                            // Gross salary range: 1,000 to 200,000 NIS (reasonable range, not too high)
                                            if (candidate >= 1000 && candidate <= 200000) {
                                                // Take the largest valid number in the row (gross salary is usually the largest)
                                                if (candidate > grossSalary) {
                                                    grossSalary = candidate;
                                                }
                                            }
                                        }
                                    }
                                    if (grossSalary > 0 && (pageNum === 1 || extractedData.length < 5)) {
                                        console.log(`   ✅ Found gross salary via pattern matching (fallback): ${grossSalary}`);
                                    }
                                }

                                if (grossSalary > 0) {
                                    seenWorkerIds.add(workerId);
                                    extractedData.push({
                                        workerId,
                                        grossSalary,
                                        netSalary: netSalary > 0 ? netSalary : null
                                    });
                                    console.log(`✅ Page ${pageNum} Row ${yPos} - Extracted: workerId="${workerId}", grossSalary=${grossSalary}, netSalary=${netSalary || 'N/A'}`);
                                } else {
                                    // Log for ALL pages, not just page 1
                                    console.log(`⚠️ Page ${pageNum} Row ${yPos} - Found workerId "${workerId}" but no valid salary in range 1000-200000`);
                                    console.log(`   Row text: "${rowText.substring(0, 300)}"`);
                                    console.log(`   All numbers found:`, rowText.match(/\d+/g) || []);
                                    console.log(`   Column positions:`, sortedByXRight.slice(0, 15).map((i, idx) => ({
                                        position: idx,
                                        text: i.text,
                                        x: Math.round(i.x),
                                        isNumber: /^\d+([.,]\d+)?$/.test(i.text.replace(/,/g, '')),
                                        parsedValue: (() => {
                                            const val = parseFloat(i.text.replace(/,/g, ''));
                                            return isNaN(val) ? null : val;
                                        })()
                                    })));
                                }
                            } else if (workerId && seenWorkerIds.has(workerId)) {
                                // Log duplicate detection for debugging (but less verbose)
                                if (extractedData.length < 10 || pageNum === 1) {
                                    console.log(`ℹ️ Page ${pageNum} Row ${yPos} - workerId "${workerId}" already seen, skipping`);
                                }
                            } else if (!workerId) {
                                // Log rows that look like data rows but don't have a workerId
                                // Check if row has salary-like numbers (to identify data rows)
                                const hasSalaryLikeNumbers = /(\d{3,7})/.test(rowText);
                                if (hasSalaryLikeNumbers && yPos < sortedRows[Math.min(10, sortedRows.length - 1)][0]) {
                                    // Only log first 10 rows per page to avoid spam
                                    console.log(`⚠️ Page ${pageNum} Row ${yPos} - Potential data row but no workerId found`);
                                    console.log(`   Row text: "${rowText.substring(0, 200)}"`);
                                    console.log(`   All numbers:`, rowText.match(/\d+/g) || []);
                                }
                            }
                        }

                        // Debug: Log extracted data after each page
                        console.log(`📄 PDF Parsing - Page ${pageNum} complete. Extracted so far: ${extractedData.length} records`);
                        if (pageNum === 1 || extractedData.length < 10) {
                            console.log('📄 PDF Parsing - Extracted data so far:', extractedData);
                        }
                    }

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
                    console.log(`✅ PDF Parsing Complete - Total pages processed: ${pdf.numPages}`);

                    // Summary: Show all unique employee numbers extracted
                    const uniqueWorkerIds = [...new Set(extractedData.map(d => d.workerId))].sort((a, b) => parseInt(a) - parseInt(b));
                    console.log('📊 PDF Parsing Summary:');
                    console.log(`   - Total pages in PDF: ${pdf.numPages}`);
                    console.log(`   - Unique employee numbers extracted: ${uniqueWorkerIds.length}`);
                    console.log(`   - Employee numbers: [${uniqueWorkerIds.join(', ')}]`);
                    console.log(`   - Contains "134": ${uniqueWorkerIds.includes('134') ? '✅ YES' : '❌ NO'}`);

                    // Count total rows processed across all pages
                    let totalRowsProcessed = 0;
                    for (let p = 1; p <= pdf.numPages; p++) {
                        const page = await pdf.getPage(p);
                        const textContent = await page.getTextContent();
                        const textItems = textContent.items.map((item: any) => ({
                            text: item.str,
                            y: item.transform[5]
                        }));
                        const uniqueYPositions = new Set(textItems.map((item: any) => Math.round(item.y / 3) * 3));
                        totalRowsProcessed += uniqueYPositions.size;
                    }
                    console.log(`   - Estimated total rows processed: ${totalRowsProcessed}`);
                    console.log(`   - Extraction rate: ${((extractedData.length / totalRowsProcessed) * 100).toFixed(1)}%`);

                    if (!uniqueWorkerIds.includes('134')) {
                        console.log('⚠️ WARNING: Employee number "134" was NOT found in the extracted data!');
                        console.log('   This means either:');
                        console.log('   1. "134" is not in the PDF');
                        console.log('   2. "134" is in the PDF but not being extracted correctly');
                        console.log('   3. "134" appears in a different format in the PDF');
                    }

                    if (extractedData.length < 30) {
                        console.log(`⚠️ WARNING: Only ${extractedData.length} employees extracted. Expected more based on document.`);
                        console.log('   Possible issues:');
                        console.log('   1. Some rows might not have valid workerId extracted');
                        console.log('   2. Some rows might have salaries outside the 1000-500000 range');
                        console.log('   3. Row grouping might be splitting rows incorrectly');
                        console.log('   4. Some pages might not be processed correctly');
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
}
