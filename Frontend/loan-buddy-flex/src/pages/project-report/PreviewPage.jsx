import React, { useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppContext } from './ProjectReportApp.jsx';
import { FullScreenLoader } from '@/components/common.jsx';
import { apiClient } from '@/services/apiClient.js';


// --- Helper: Currency Formatter ---
const formatCurrency = (value) => {
   if (value === undefined || value === null) return '₹0';
   const numVal = parseFloat(value);
   if (isNaN(numVal)) return '₹0';

   const isNegative = numVal < 0;
   const absVal = Math.abs(numVal).toLocaleString('en-IN', { maximumFractionDigits: 0 });

   return isNegative ? `-₹${absVal}` : `₹${absVal}`;
};

// --- Helper: Number Formatter for Ratios ---
const formatRatio = (value) => {
   const numVal = parseFloat(value);
   return isNaN(numVal) ? '0.00' : numVal.toFixed(2);
};

import { calculateAll, calculateTax } from '@/services/financialCalculations';

export function PreviewPage() {
   const { currentReport, yearSettings, operatingGroups, assetGroups, liabilityGroups } = useContext(AppContext);
   const [taxRegime, setTaxRegime] = React.useState(currentReport?.tax_regime || 'domestic_22');
   const [loanScheduleData, setLoanScheduleData] = React.useState(null);
   const [existingLoans, setExistingLoans] = React.useState([]); // New State
   const [existingWCLoans, setExistingWCLoans] = React.useState([]); // New State
   const [projectCosts, setProjectCosts] = React.useState([]); // New State
   const [loadingLoanSchedule, setLoadingLoanSchedule] = React.useState(true);
   const [downloadingPDF, setDownloadingPDF] = React.useState(false);
   const [downloadError, setDownloadError] = React.useState(null);

   const allGroups = useMemo(() => {
      return [...operatingGroups, ...assetGroups, ...liabilityGroups];
   }, [operatingGroups, assetGroups, liabilityGroups]);

   // Fetch loan schedule data
   React.useEffect(() => {
      const fetchLoanData = async () => {
         if (!currentReport?.id) return;
         try {
            setLoadingLoanSchedule(true);

            // 1. Fetch New Loan Schedule
            const schedules = await apiClient.getLoanSchedules(currentReport.id);
            if (schedules && schedules.length > 0) {
               setLoanScheduleData(schedules[0]);
            } else {
               setLoanScheduleData(null);
            }

            // 2. Fetch Existing Term Loans
            const loans = await apiClient.getTermLoans(currentReport.id);
            setExistingLoans(loans || []);

            // 3. Fetch Existing WC Loans
            const wcLoans = await apiClient.getExistingWCLoans(currentReport.id);
            setExistingWCLoans(wcLoans || []);

            // 4. Fetch Project Costs (for Asset calculations)
            const costs = await apiClient.getProjectCosts(currentReport.id);
            setProjectCosts(costs || []);

         } catch (error) {
            console.error('Error fetching loan data:', error);
            setLoanScheduleData(null);
            setExistingLoans([]);
            setExistingWCLoans([]);
            setProjectCosts([]);
         } finally {
            setLoadingLoanSchedule(false);
         }
      };
      fetchLoanData();
   }, [currentReport?.id]);

   const allLoanSummaries = useMemo(() => {
      let summaries = [];
      if (loanScheduleData?.year_summaries) {
         summaries = [...summaries, ...loanScheduleData.year_summaries];
      }
      if (existingLoans.length > 0) {
         existingLoans.forEach(loan => {
            if (loan.year_summaries) {
               summaries = [...summaries, ...loan.year_summaries];
            }
         });
      }
      return summaries;
   }, [loanScheduleData, existingLoans]);

   const aggregatedLoanSchedule = useMemo(() => {
      // We want to display ALL years, not just the report years.
      const summaryMap = new Map();

      // Helper to extract start year from any label format
      const getStartYear = (lbl) => {
         if (!lbl) return 0;
         const match = lbl.match(/(\d{4})/);
         return match ? parseInt(match[1]) : 0;
      };

      // Helper to ensure we have a map entry using START YEAR as key
      const ensureEntry = (label, yearId = null) => {
         const startYear = getStartYear(label);
         if (!startYear) return null; // Skip invalid labels

         if (!summaryMap.has(startYear)) {
            summaryMap.set(startYear, {
               year_id: yearId,
               year_display: label, // Keep the first label we see (usually from yearSettings)
               start_year: startYear,
               opening_balance: 0,
               annual_interest: 0,
               annual_principal: 0,
               closing_balance: 0
            });
         }
         return summaryMap.get(startYear);
      };

      // 1. Initialize with report years to ensure correct order for the main period
      yearSettings.forEach(year => {
         ensureEntry(year.year_display, year.id);
      });

      // 2. Aggregate all summaries
      allLoanSummaries.forEach(s => {
         // Use year_label if available, otherwise try to find it from year_setting
         let label = s.year_label;
         let yearId = s.year_setting?.id || s.year_setting || s.year_setting_id;

         if (!label && yearId) {
            // Try to find label from yearSettings
            const setting = yearSettings.find(y => y.id === yearId);
            if (setting) label = setting.year_display;
         }

         if (label) {
            const entry = ensureEntry(label, yearId);
            if (entry) {
               entry.opening_balance += (parseFloat(s.opening_balance) || 0);
               entry.annual_interest += (parseFloat(s.annual_interest) || 0);
               entry.annual_principal += (parseFloat(s.annual_principal) || 0);
               entry.closing_balance += (parseFloat(s.closing_balance) || 0);
            }
         }
      });

      // Convert map to array and sort by start_year
      return Array.from(summaryMap.values()).sort((a, b) => a.start_year - b.start_year);

   }, [yearSettings, allLoanSummaries]);

   // Helper to get value for a specific loan and year
   const getLoanValue = (loan, yearId, field) => {
      if (!loan || !loan.year_summaries) return 0;
      // year_summaries might have year_setting (id) or year_setting_id or just be linked by year_label logic if we were advanced,
      // but here we rely on the ID matching which we ensured in aggregation.
      // Actually, existing loans might have year_id.
      const summary = loan.year_summaries.find(s =>
         (s.year_setting?.id === yearId) || (s.year_setting === yearId) || (s.year_setting_id === yearId)
      );
      return summary ? (parseFloat(summary[field]) || 0) : 0;
   };

   const getNewLoanValue = (yearId, field) => {
      if (!loanScheduleData || !loanScheduleData.year_summaries) return 0;
      const summary = loanScheduleData.year_summaries.find(s =>
         (s.year_setting?.id === yearId) || (s.year_setting === yearId) || (s.year_setting_id === yearId)
      );
      return summary ? (parseFloat(summary[field]) || 0) : 0;
   };

   const calculations = useMemo(() => {
      if (!yearSettings.length) return {};
      // Pass currentReport as the 7th argument (wcSettings) to enable Working Capital calculations
      return calculateAll(allGroups, yearSettings, currentReport?.sector, taxRegime, allLoanSummaries, undefined, currentReport, projectCosts, existingWCLoans);
   }, [allGroups, yearSettings, currentReport, taxRegime, allLoanSummaries, projectCosts, existingWCLoans]);

   if (!currentReport || !yearSettings.length || loadingLoanSchedule) {
      return <FullScreenLoader text="Generating Preview..." />;
   }

   // ========================================
   // P&L WATERFALL TABLE COMPONENT
   // ========================================
   const PLWaterfallTable = () => {
      // Helper function to get input value from actual row data
      const getInputValue = (yearId, key) => {
         // First check if it's in calculations (for values like opening stock calculated from previous year)
         if (calculations[yearId]?.[key] !== undefined) {
            return calculations[yearId][key];
         }

         // Search for the input value in the actual row data
         for (const group of allGroups) {
            for (const row of group.rows) {
               const rowNameClean = row.name.toLowerCase().trim();
               const keyClean = key.toLowerCase().trim();

               if (rowNameClean === keyClean) {
                  const dataPoint = row.data.find(d => d.year_setting === yearId);
                  if (dataPoint && dataPoint.value !== null && dataPoint.value !== undefined) {
                     return parseFloat(dataPoint.value) || 0;
                  }
               }
            }
         }
         return 0;
      };

      // Define the explicit waterfall structure
      const waterfallRows = [
         // Revenue Section
         { type: 'header', label: 'A. REVENUE' },
         ...(() => {
            // Dynamically get ALL revenue rows
            const revenueGroup = allGroups.find(g => g.name.toLowerCase().includes("revenue"));
            const revRows = [];
            if (revenueGroup) {
               revenueGroup.rows.forEach(row => {
                  // CRITICAL: Skip hidden rows
                  if (row.is_hidden) return;

                  if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                     revRows.push({ type: 'input', label: row.name, key: row.name });
                  }
               });
            }
            return revRows;
         })(),
         { type: 'calculated', label: 'Total Revenue', key: 'Total Revenue', isBold: true },

         // B-E. COST OF GOODS SOLD (Sector-Aware Rendering)
         // Manufacturing: Full structure (Raw Materials, Manufacturing Expenses, WIP, Finished Goods)
         // Trading/Wholesale/Retail/Service: Simplified (Opening Inventory, Purchases, Closing Inventory)
         ...(() => {
            const sector = currentReport?.sector;
            const isManufacturing = sector === 'industry' || !sector;
            const cogsGroup = allGroups.find(g => g.name.toLowerCase().includes("cost of goods sold") || g.name.toLowerCase().includes("cogs"));
            const cogsRows = [];

            if (cogsGroup) {
               if (isManufacturing) {
                  // === MANUFACTURING: Full COGS Structure ===
                  // B. Raw Materials
                  cogsRows.push({ type: 'header', label: 'B. RAW MATERIAL CONSUMED' });
                  cogsGroup.rows.forEach(row => {
                     if (row.is_hidden) return;
                     const name = row.name.toLowerCase();
                     if ((name.includes('stock') && name.includes('raw')) || name.includes('purchase') || name.includes('freight')) {
                        if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                           cogsRows.push({ type: 'input', label: row.name, key: row.name });
                        }
                     }
                  });
                  cogsRows.push({ type: 'calculated', label: 'Raw Material Consumed', key: 'Raw Material Consumed', isBold: true });

                  // C. Manufacturing
                  cogsRows.push({ type: 'header', label: 'C. MANUFACTURING EXPENSES' });
                  cogsGroup.rows.forEach(row => {
                     if (row.is_hidden) return;
                     const name = row.name.toLowerCase();
                     const isStock = name.includes('stock') || name.includes('opening') || name.includes('closing');
                     const isRM = name.includes('raw') || name.includes('purchase') || name.includes('freight');
                     const isWIP = name.includes('work') && name.includes('process');
                     const isFG = name.includes('finished');
                     if (!isStock && !isRM && !isWIP && !isFG && !row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                        cogsRows.push({ type: 'input', label: row.name, key: row.name });
                     }
                  });
                  cogsRows.push({ type: 'calculated', label: 'Total Manufacturing Expenses', key: 'Total Manufacturing Expenses', isBold: true });
                  cogsRows.push({ type: 'calculated', label: 'Gross Factory Cost', key: 'Gross Factory Cost', isBold: true });

                  // D. WIP
                  cogsRows.push({ type: 'header', label: 'D. WORK-IN-PROCESS (WIP)' });
                  cogsGroup.rows.forEach(row => {
                     if (row.is_hidden) return;
                     const name = row.name.toLowerCase();
                     if (name.includes('work') && name.includes('process')) {
                        if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                           cogsRows.push({ type: 'input', label: row.name, key: row.name });
                        }
                     }
                  });
                  cogsRows.push({ type: 'calculated', label: 'Factory Cost of Goods Produced', key: 'Factory Cost of Goods Produced', isBold: true });

                  // E. Finished Goods / COGS
                  cogsRows.push({ type: 'header', label: 'E. COST OF GOODS SOLD (COGS)' });
                  cogsGroup.rows.forEach(row => {
                     if (row.is_hidden) return;
                     const name = row.name.toLowerCase();
                     if (name.includes('finished')) {
                        if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                           cogsRows.push({ type: 'input', label: row.name, key: row.name });
                        }
                     }
                  });
                  cogsRows.push({ type: 'calculated', label: 'Cost of Goods Sold (COGS)', key: 'Cost of Goods Sold (COGS)', isBold: true });
               } else {
                  // === TRADING/WHOLESALE/RETAIL/SERVICE: Simplified COGS ===
                  cogsRows.push({ type: 'header', label: 'B. COST OF GOODS SOLD' });
                  cogsGroup.rows.forEach(row => {
                     if (row.is_hidden) return;
                     // Include all non-calculated, non-total rows (Opening, Purchases, Freight, Closing)
                     if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                        cogsRows.push({ type: 'input', label: row.name, key: row.name });
                     }
                  });
                  cogsRows.push({ type: 'calculated', label: 'Cost of Goods Sold (COGS)', key: 'Cost of Goods Sold (COGS)', isBold: true });
               }
            }

            return cogsRows;
         })(),

         // Gross Profit
         { type: 'calculated', label: 'Gross Profit', key: 'Gross Profit', isBold: true, highlight: true },
         { type: 'calculated', label: 'Gross Profit Ratio', key: 'Gross Profit Ratio', isRatio: true },

         // SG&A Section
         { type: 'header', label: 'F. SELLING, GENERAL & ADMINISTRATIVE EXPENSES' },
         ...(() => {
            // Dynamically get SG&A input rows
            const sellingGroup = allGroups.find(g => g.name.toLowerCase().includes("selling"));
            const sgaRows = [];
            if (sellingGroup) {
               sellingGroup.rows.forEach(row => {
                  // CRITICAL: Skip hidden rows
                  if (row.is_hidden) return;

                  const name = row.name.toLowerCase();
                  const isDepreciation = name.includes('depreciation');
                  const isInterest = name.includes('interest');
                  // STRICT FILTER: Exclude any row that mentions "Interest"
                  if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=') && !isDepreciation && !isInterest) {
                     sgaRows.push({ type: 'input', label: row.name, key: row.name });
                  }
               });
            }
            return sgaRows;
         })(),
         { type: 'calculated', label: 'Total Selling, General & Administrative Expenses', key: 'Total Selling, General & Administrative Expenses', isBold: true },

         // EBITDA
         { type: 'calculated', label: 'EBITDA / Profit before Depreciation, Interest and Tax', key: 'Profit before Depreciation, Interest and Tax', isBold: true, highlight: true },

         // Depreciation
         { type: 'header', label: 'G. DEPRECIATION' },
         { type: 'calculated', label: 'Depreciation', key: 'Depreciation', isBold: true },

         // EBIT
         { type: 'calculated', label: 'Profit After Depreciation', key: 'Profit After Depreciation', isBold: true, highlight: true },

         // Interest
         { type: 'header', label: 'H. INTEREST EXPENSES' },
         ...(() => {
            // Dynamically get Interest input rows (excluding known calculated ones)
            const interestGroup = allGroups.find(g => g.name.toLowerCase().includes("interest"));
            const interestRows = [];
            if (interestGroup) {
               interestGroup.rows.forEach(row => {
                  // CRITICAL: Skip hidden rows
                  if (row.is_hidden) return;

                  const name = row.name.toLowerCase();
                  // Skip Term Loan Interest and Working Capital Interest as they are shown explicitly
                  if (!name.includes('term loan') && !name.includes('working capital') && !row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                     interestRows.push({ type: 'input', label: row.name, key: row.name });
                  }
               });
            }
            return interestRows;
         })(),

         // Individual Loan Interests
         ...existingLoans.map(loan => ({
            type: 'calculated',
            label: `Interest on ${loan.loan_name}`,
            getValue: (yearId) => getLoanValue(loan, yearId, 'annual_interest')
         })),
         ...(loanScheduleData ? [{
            type: 'calculated',
            label: `Interest on ${currentReport.new_loan_type === 'wc' ? 'New Working Capital' : 'New Term Loan'}`,
            getValue: (yearId) => getNewLoanValue(yearId, 'annual_interest')
         }] : []),

         // { type: 'calculated', label: 'Term Loan Interest', key: 'Term Loan Interest' }, // REMOVED generic row

         // Dynamic Existing WC Interest
         ...(existingWCLoans && existingWCLoans.length > 0
            ? existingWCLoans.map(loan => ({
               type: 'calculated',
               label: `Interest on ${loan.bank_name} WC`,
               key: `Interest on ${loan.bank_name} WC`
            }))
            : [{ type: 'calculated', label: 'Interest on Existing Working Capital', key: 'Interest on Existing Working Capital' }]
         ),

         { type: 'calculated', label: 'Interest on Proposed Working Capital', key: 'Interest on Proposed Working Capital' },
         { type: 'calculated', label: 'Total Interest', key: 'Total Interest', isBold: true },

         // PBT
         { type: 'calculated', label: 'Profit Before Tax (PBT)', key: 'Profit Before Tax', isBold: true, highlight: true },

         // Tax
         { type: 'header', label: 'I. TAX' },
         { type: 'calculated', label: 'Tax', key: 'Tax' },
         { type: 'calculated', label: 'Surcharge', key: 'Surcharge' },
         { type: 'calculated', label: 'Cess', key: 'Cess' },
         { type: 'calculated', label: 'Total Tax', key: 'Total Tax', isBold: true },

         // PAT
         { type: 'calculated', label: 'Profit After Tax (PAT)', key: 'Profit After Tax (PAT)', isBold: true, highlight: true },

         // Retained Profit
         { type: 'calculated', label: 'Retained Profit', key: 'Retained Profit', isBold: true },
      ].flat(); // Use .flat() to merge the arrays returned by the IIFEs

      return (
         <div className="mb-8 break-inside-avoid">
            <h3 className="text-lg font-bold mb-2 text-gray-800">1. Operating Statement (P&L Waterfall)</h3>
            <div className="overflow-x-auto border border-gray-300 rounded bg-white">
               <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-100">
                     <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                        {yearSettings.map(year => (
                           <th key={year.id} className="px-3 py-2 text-right font-semibold text-gray-700">
                              {year.year_display}
                           </th>
                        ))}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                     {waterfallRows.map((row, idx) => {
                        // Header rows
                        if (row.type === 'header') {
                           return (
                              <tr key={idx} className="bg-gray-200">
                                 <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                                    {row.label}
                                 </td>
                              </tr>
                           );
                        }

                        // Input rows - always display
                        if (row.type === 'input') {
                           return (
                              <tr key={idx} className="hover:bg-gray-50">
                                 <td className="px-3 py-2 text-gray-700 pl-6">{row.label}</td>
                                 {yearSettings.map(year => {
                                    // Use getInputValue helper to fetch from actual row data
                                    const val = getInputValue(year.id, row.key);
                                    return (
                                       <td key={year.id} className="px-3 py-2 text-right text-gray-600">
                                          {formatCurrency(val)}
                                       </td>
                                    );
                                 })}
                              </tr>
                           );
                        }

                        // Calculated rows
                        if (row.type === 'calculated') {
                           const bgClass = row.highlight
                              ? 'bg-blue-100'
                              : row.isBold
                                 ? 'bg-blue-50'
                                 : 'bg-white';
                           const fontClass = row.isBold ? 'font-bold' : 'font-semibold';

                           return (
                              <tr key={idx} className={`${bgClass}`}>
                                 <td className={`px-3 py-2 text-gray-900 ${fontClass} ${row.highlight ? 'pl-4' : 'pl-6'}`}>
                                    {row.label}
                                 </td>
                                 {yearSettings.map(year => {
                                    const val = row.getValue ? row.getValue(year.id) : (calculations[year.id]?.[row.key] || 0);
                                    let displayVal;
                                    if (row.isRatio) {
                                       displayVal = formatRatio(val) + '%';
                                    } else {
                                       displayVal = formatCurrency(val);
                                    }
                                    return (
                                       <td key={year.id} className={`px-3 py-2 text-right text-gray-900 ${fontClass}`}>
                                          {displayVal}
                                       </td>
                                    );
                                 })}
                              </tr>
                           );
                        }

                        return null;
                     })}
                  </tbody>
               </table>
            </div>
         </div>
      );
   };

   // ========================================
   // BALANCE SHEET TABLE COMPONENT
   // ========================================
   const BalanceSheetTable = () => {
      // Helper function to get input or calculated value
      const getRowValue = (yearId, key) => {
         // First check if it's in calculations
         if (calculations[yearId]?.[key] !== undefined) {
            return calculations[yearId][key];
         }

         // Special handling for Cash & Bank Balance - check multiple keys
         const keyLower = key.toLowerCase().trim();
         if (keyLower.includes('cash') && keyLower.includes('bank')) {
            // Try all possible cash keys
            const cashValue = calculations[yearId]?.["Cash & Bank Balance"] ||
               calculations[yearId]?.["Cash & bank balance"] ||
               calculations[yearId]?.["Closing Cash Balance (as per CFS)"] ||
               calculations[yearId]?.["Total Cash & Bank"] ||
               calculations[yearId]?.["Closing Cash Balance (CFS)"] ||
               calculations[yearId]?.["Cash in Hand"];
            if (cashValue !== undefined) return cashValue;
         }

         // Search for the input value in the actual row data
         for (const group of allGroups) {
            for (const row of group.rows) {
               const rowNameClean = row.name.toLowerCase().trim();
               const keyClean = key.toLowerCase().trim();

               if (rowNameClean === keyClean) {
                  const dataPoint = row.data.find(d => d.year_setting === yearId);
                  if (dataPoint && dataPoint.value !== null && dataPoint.value !== undefined) {
                     return parseFloat(dataPoint.value) || 0;
                  }
               }
            }
         }
         return 0;
      };

      // Helper to check if a row has any non-zero value
      const hasNonZeroValue = (row) => {
         // Always show rows with custom getValue (critical rows like Cash, Total Assets)
         if (row.getValue) {
            return true;
         }

         // Always show critical rows regardless of value
         const keyLower = (row.key || '').toLowerCase();
         if (keyLower.includes('cash') || keyLower.includes('total assets') || keyLower.includes('total liabilities') ||
            keyLower.includes('net worth') || keyLower.includes('balance sheet check') || keyLower.includes('net block') ||
            keyLower.includes('total asset')) {
            return true;
         }

         return yearSettings.some(year => {
            const val = row.getValue ? row.getValue(year.id) : getRowValue(year.id, row.key);
            return val && parseFloat(val) !== 0;
         });
      };

      // Define the Balance Sheet structure - DYNAMICALLY fetch all rows
      const balanceSheetRows = [
         // ASSETS SECTION
         { type: 'section_header', label: 'ASSETS', colSpan: true },

         // DYNAMICALLY RENDER ALL ASSET GROUPS (Cash, Operating CA, Fixed Assets, Non-Current)
         ...(() => {
            const rows = [];
            // Filter out total groups and sort by order
            const displayGroups = assetGroups
               .filter(g => !g.system_tag?.includes('total'))
               .sort((a, b) => (a.order || 0) - (b.order || 0));

            displayGroups.forEach(group => {
               // Add group header
               rows.push({ type: 'group_header', label: group.name.toUpperCase() });

               // Special handling for Cash & Bank Balance group - inject calculated row from CFS
               const groupNameLower = group.name.toLowerCase();
               if (groupNameLower.includes('cash') && groupNameLower.includes('bank')) {
                  // Always show the Cash & Bank Balance from calculations (CFS closing cash)
                  // Add custom getValue to directly access the calculated value
                  rows.push({
                     type: 'calculated',
                     label: 'Cash & Bank Balance',
                     key: 'Cash & Bank Balance',
                     isBold: true,
                     getValue: (yearId) => {
                        return calculations[yearId]?.["Cash & Bank Balance"] ||
                           calculations[yearId]?.["Closing Cash Balance (as per CFS)"] ||
                           calculations[yearId]?.["Total Cash & Bank"] ||
                           calculations[yearId]?.["Cash in Hand"] || 0;
                     }
                  });
                  return; // Skip processing individual rows as we use calculated value
               }

               // Add each row from the group
               group.rows.forEach(row => {
                  if (row.is_hidden) return; // Skip hidden rows

                  // Filter out Accumulated Depreciation (user request)
                  const rowNameLower = row.name.toLowerCase();
                  if (rowNameLower.includes('accumulated') && rowNameLower.includes('depreciation')) {
                     return; // Skip this row
                  }
                  if (rowNameLower.includes('accum') && rowNameLower.includes('depr')) {
                     return; // Skip this row
                  }

                  // Special handling for inventory rows - these flow from Operating Statement closing stock
                  if (rowNameLower.includes('raw material') && rowNameLower.includes('domestic')) {
                     rows.push({
                        type: 'calculated',
                        label: row.name,
                        key: 'Raw materials Domestic',
                        getValue: (yearId) => calculations[yearId]?.["Raw materials Domestic"] || calculations[yearId]?.["Closing Stock (Raw Materials)"] || 0
                     });
                     return;
                  }
                  if (rowNameLower.includes('stock in process') || (rowNameLower.includes('wip') && !rowNameLower.includes('capital'))) {
                     rows.push({
                        type: 'calculated',
                        label: row.name,
                        key: 'Stock in process',
                        getValue: (yearId) => calculations[yearId]?.["Stock in process"] || calculations[yearId]?.["Closing Stock (Work-in-Process)"] || 0
                     });
                     return;
                  }
                  if (rowNameLower.includes('finished good')) {
                     rows.push({
                        type: 'calculated',
                        label: row.name,
                        key: 'Finished goods',
                        getValue: (yearId) => calculations[yearId]?.["Finished goods"] || calculations[yearId]?.["Closing Stock (Finished Goods)"] || 0
                     });
                     return;
                  }

                  if (row.is_total_row) {
                     // Total rows are calculated
                     rows.push({ type: 'calculated', label: row.name, key: row.name, isBold: true });
                  } else if (row.is_calculated) {
                     // Calculated rows (like Gross Block, Net Block)
                     rows.push({ type: 'calculated', label: row.name, key: row.name });
                  } else if (!row.name.startsWith('=')) {
                     // Input rows
                     rows.push({ type: 'input', label: row.name, key: row.name });
                  }
               });
            });

            return rows;
         })(),

         // Total Assets - with custom getValue for direct access
         {
            type: 'calculated',
            label: 'TOTAL ASSETS',
            key: 'Total Assets',
            isBold: true,
            highlight: true,
            getValue: (yearId) => {
               return calculations[yearId]?.["Total Assets"] ||
                  calculations[yearId]?.["Total Asset"] ||
                  calculations[yearId]?.["Total assets"] || 0;
            }
         },



         // LIABILITIES & NET WORTH SECTION
         { type: 'section_header', label: 'LIABILITIES AND NET WORTH', colSpan: true },

         // DYNAMICALLY RENDER ALL LIABILITY GROUPS (matching Financial Grid exactly)
         ...(() => {
            const rows = [];
            const isLlpOrProprietorship = taxRegime === 'llp' || taxRegime === 'proprietorship';
            const addedSpecialRows = new Set(); // Track special rows to avoid duplicates

            // Sort groups by order
            const sortedGroups = [...liabilityGroups].sort((a, b) => (a.order || 0) - (b.order || 0));

            sortedGroups.forEach(group => {
               // Skip total groups (they'll be shown as calculated rows)
               if (group.system_tag?.includes('total')) return;

               const groupNameLower = group.name.toLowerCase();
               const isNetWorthGroup = groupNameLower.includes('capital') ||
                  groupNameLower.includes('net worth') ||
                  groupNameLower.includes('shareholders');

               // FOR LLP/PROPRIETORSHIP: Build Capital & Net Worth section from CALCULATED values ONLY
               // This bypasses grid row iteration to ensure waterfall values are used
               if (isLlpOrProprietorship && isNetWorthGroup && !addedSpecialRows.has('llp_net_worth_group')) {
                  addedSpecialRows.add('llp_net_worth_group');

                  // Add group header
                  rows.push({ type: 'group_header', label: 'CAPITAL & NET WORTH' });

                  // 1. Capital (Opening) - from waterfall calculation
                  rows.push({
                     type: 'calculated',
                     label: 'Share Capital',
                     key: 'Share Capital',
                     getValue: (yearId) => {
                        // Must use Capital key which has the waterfall value
                        return calculations[yearId]?.["Capital"] ||
                           calculations[yearId]?.["Share Capital"] ||
                           calculations[yearId]?.["Ordinary share capital"] || 0;
                     }
                  });

                  // 2. Less: Drawings - show as negative
                  rows.push({
                     type: 'calculated',
                     label: 'Less: Drawings',
                     key: 'Drawings',
                     getValue: (yearId) => {
                        const val = calculations[yearId]?.["Drawings"] || 0;
                        return val !== 0 ? -val : 0;
                     }
                  });

                  // 3. Total Capital = Capital - Drawings (computed inline for display)
                  rows.push({
                     type: 'calculated',
                     label: 'Total Capital',
                     key: 'Total Capital',
                     isBold: true,
                     getValue: (yearId) => {
                        const capital = calculations[yearId]?.["Capital"] || 0;
                        const drawings = calculations[yearId]?.["Drawings"] || 0;
                        return capital - drawings;
                     }
                  });

                  // Add RESERVES & SURPLUS group header
                  rows.push({ type: 'group_header', label: 'RESERVES & SURPLUS' });

                  // 4. Add: General Reserve (PAT) - current year PAT
                  rows.push({
                     type: 'calculated',
                     label: 'Add: General Reserve (PAT)',
                     key: 'General Reserve (PAT)',
                     getValue: (yearId) => {
                        return calculations[yearId]?.["General Reserve (PAT)"] ||
                           calculations[yearId]?.["Profit After Tax (PAT)"] || 0;
                     }
                  });

                  // 5. Retained Earnings (cumulative - for display, usually 0 for LLP)
                  rows.push({
                     type: 'calculated',
                     label: 'Retained Earnings',
                     key: 'Retained Earnings',
                     getValue: (yearId) => {
                        return calculations[yearId]?.["Retained Earnings"] || 0;
                     }
                  });

                  // 6. Total Reserves = General Reserve (PAT) for LLP
                  rows.push({
                     type: 'calculated',
                     label: 'Total Reserves',
                     key: 'Total Reserves',
                     isBold: true,
                     getValue: (yearId) => {
                        return calculations[yearId]?.["Total Reserves"] ||
                           calculations[yearId]?.["General Reserve (PAT)"] || 0;
                     }
                  });

                  // 7. Total Net Worth = Total Capital + Total Reserves (final total)
                  rows.push({
                     type: 'calculated',
                     label: 'Total Net Worth',
                     key: 'Total Net Worth',
                     isBold: true,
                     highlight: true,
                     getValue: (yearId) => {
                        return calculations[yearId]?.["Total Net Worth"] ||
                           calculations[yearId]?.["Net Worth"] || 0;
                     }
                  });

                  return; // Skip processing individual rows in this group
               }

               // FOR OTHER GROUPS (Current Liabilities, Term Liabilities, etc.) 
               // or FOR DOMESTIC COMPANY - process normally
               if (isNetWorthGroup && isLlpOrProprietorship) {
                  return; // Already handled above
               }

               // Add group header
               rows.push({ type: 'group_header', label: group.name.toUpperCase() });

               // Process each row in the group
               group.rows.forEach(row => {
                  if (row.is_hidden) return; // Skip hidden rows
                  if (row.name.startsWith('=')) return; // Skip formula rows

                  const rowNameLower = row.name.toLowerCase().trim();

                  // Special handling for calculated rows (totals, General Reserve, etc.)
                  if (row.is_calculated || row.is_total_row) {
                     // These are calculated values - get from calculations object OR sum group rows
                     rows.push({
                        type: 'calculated',
                        label: row.name,
                        key: row.name,
                        isBold: row.is_total_row,
                        getValue: (yearId) => {
                           const rowNameLower = row.name.toLowerCase().trim();

                           // Check multiple possible key formats in calculations
                           const possibleKeys = [
                              row.name,
                              row.name.toLowerCase(),
                              row.name.replace(/\s+/g, ' ').trim(),
                           ];
                           for (const key of possibleKeys) {
                              if (calculations[yearId]?.[key] !== undefined && calculations[yearId][key] !== 0) {
                                 return calculations[yearId][key];
                              }
                           }

                           // If not in calculations, sum the group's non-total rows dynamically
                           if (row.is_total_row) {
                              let sum = 0;
                              group.rows.forEach(r => {
                                 if (r.is_hidden || r.is_total_row || r.name.startsWith('=')) return;
                                 const calcVal = calculations[yearId]?.[r.name];
                                 if (calcVal !== undefined) {
                                    sum += parseFloat(calcVal) || 0;
                                 } else {
                                    const dp = r.data?.find(d => d.year_setting === yearId);
                                    sum += parseFloat(dp?.value || 0);
                                 }
                              });
                              return sum;
                           }

                           return 0;
                        }
                     });
                     return;
                  }

                  // For Domestic Company: Special handling for Share Capital, Reserves, etc.
                  if (!isLlpOrProprietorship) {
                     // General Reserve for Domestic Company
                     if (rowNameLower.includes('general reserve') && !addedSpecialRows.has('general_reserve')) {
                        addedSpecialRows.add('general_reserve');
                        rows.push({
                           type: 'calculated',
                           label: row.name,
                           key: row.name,
                           getValue: (yearId) => {
                              return calculations[yearId]?.["General reserve"] ||
                                 calculations[yearId]?.["Reserves"] ||
                                 calculations[yearId]?.["Retained Earnings"] || 0;
                           }
                        });
                        return;
                     } else if (rowNameLower.includes('general reserve')) {
                        return; // Skip duplicate
                     }
                  }

                  // Regular input row - get from grid data
                  rows.push({ type: 'input', label: row.name, key: row.name });
               });
            });

            return rows;
         })(),

         // TOTAL LIABILITIES AND NET WORTH - calculated
         {
            type: 'calculated',
            label: 'TOTAL LIABILITIES AND NET WORTH',
            key: 'Total Liabilities',
            isBold: true,
            highlight: true,
            getValue: (yearId) => {
               return calculations[yearId]?.["Total Liabilities"] ||
                  calculations[yearId]?.["Total liabilities"] ||
                  calculations[yearId]?.["Total Liabilities and Net Worth"] || 0;
            }
         },

         // Balance Sheet Check
         { type: 'validation', label: 'BALANCE SHEET CHECK (Assets - Liabilities)', key: 'Balance Sheet Check', isBold: true, highlight: true },
      ];

      return (
         <div className="mb-8 break-inside-avoid">
            <h3 className="text-lg font-bold mb-2 text-gray-800">2. Balance Sheet</h3>
            <div className="overflow-x-auto border border-gray-300 rounded bg-white">
               <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-100">
                     <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                        {yearSettings.map(year => (
                           <th key={year.id} className="px-3 py-2 text-right font-semibold text-gray-700">
                              {year.year_display}
                           </th>
                        ))}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                     {balanceSheetRows.map((row, idx) => {
                        // Section headers (ASSETS, LIABILITIES)
                        if (row.type === 'section_header') {
                           return (
                              <tr key={idx} className="bg-blue-600">
                                 <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-white uppercase text-sm text-center">
                                    {row.label}
                                 </td>
                              </tr>
                           );
                        }

                        // Group headers (Current Assets, Term Liabilities, etc.)
                        if (row.type === 'group_header') {
                           return (
                              <tr key={idx} className="bg-gray-200">
                                 <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                                    {row.label}
                                 </td>
                              </tr>
                           );
                        }

                        // Zero-value filtering for input and calculated rows
                        if (row.type === 'input' || row.type === 'calculated') {
                           // Skip rows with all zero values
                           if (!hasNonZeroValue(row)) {
                              return null;
                           }

                           const bgClass = row.highlight
                              ? 'bg-blue-100'
                              : row.isBold
                                 ? 'bg-blue-50'
                                 : 'bg-white';
                           const fontClass = row.isBold ? 'font-bold' : '';
                           const indent = row.type === 'input' ? 'pl-6' : row.isBold ? 'pl-4' : 'pl-6';

                           return (
                              <tr key={idx} className={`${bgClass} hover:bg-gray-50`}>
                                 <td className={`px-3 py-2 text-gray-900 ${fontClass} ${indent}`}>
                                    {row.label}
                                 </td>
                                 {yearSettings.map(year => {
                                    const val = row.getValue ? row.getValue(year.id) : getRowValue(year.id, row.key);
                                    return (
                                       <td key={year.id} className={`px-3 py-2 text-right text-gray-900 ${fontClass}`}>
                                          {formatCurrency(val)}
                                       </td>
                                    );
                                 })}
                              </tr>
                           );
                        }

                        // Validation row (Balance Sheet Check)
                        if (row.type === 'validation') {
                           return (
                              <tr key={idx} className="bg-yellow-100 border-t-2 border-yellow-400">
                                 <td className="px-3 py-2 font-bold text-gray-900 pl-4">
                                    {row.label}
                                 </td>
                                 {yearSettings.map(year => {
                                    const val = getRowValue(year.id, row.key);
                                    const isBalanced = Math.abs(val) < 0.01; // Allow for floating point errors
                                    const textColor = isBalanced ? 'text-green-700' : 'text-red-700';
                                    return (
                                       <td key={year.id} className={`px-3 py-2 text-right font-bold ${textColor}`}>
                                          {formatCurrency(val)}
                                          {isBalanced ? ' ✓' : ' ⚠'}
                                       </td>
                                    );
                                 })}
                              </tr>
                           );
                        }

                        return null;
                     })}
                  </tbody>
               </table>
            </div>
         </div>
      );
   };

   const Table = ({ title, rows, isRatio = false }) => (
      <div className="mb-8 break-inside-avoid">
         <h3 className="text-lg font-bold mb-2 text-gray-800">{title}</h3>
         <div className="overflow-x-auto border border-gray-300 rounded bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
               <thead className="bg-gray-100">
                  <tr>
                     <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                     {yearSettings.map(year => (
                        <th key={year.id} className="px-3 py-2 text-right font-semibold text-gray-700">
                           {year.year_display}
                        </th>
                     ))}
                  </tr>
               </thead>
               <tbody className="divide-y divide-gray-200">
                  {rows.map((rowName, idx) => {
                     // Check if row has any non-zero value across all years
                     const hasValue = yearSettings.some(year => {
                        const val = calculations[year.id]?.[rowName];
                        return val && parseFloat(val) !== 0;
                     });

                     // If all values are zero, don't render the row
                     if (!hasValue) return null;

                     const isBold = rowName.toLowerCase().includes("total") ||
                        rowName.toLowerCase().includes("net") ||
                        rowName.toLowerCase().includes("closing") ||
                        rowName.toLowerCase().includes("profit") ||
                        rowName.toLowerCase().includes("ratio"); // Bold ratios too

                     const isRowRatio = rowName.toLowerCase().includes("ratio") || rowName.includes("%");

                     return (
                        <tr key={idx} className={isBold ? "bg-blue-50 font-bold" : "hover:bg-gray-50"}>
                           <td className="px-3 py-2 text-gray-800">{rowName}</td>
                           {yearSettings.map(year => {
                              const val = calculations[year.id]?.[rowName] || 0;
                              let displayVal;
                              if (isRowRatio) {
                                 displayVal = formatRatio(val) + '%';
                              } else {
                                 displayVal = isRatio ? formatRatio(val) : formatCurrency(val);
                              }
                              return (
                                 <td key={year.id} className="px-3 py-2 text-right text-gray-700">
                                    {displayVal}
                                 </td>
                              )
                           })}
                        </tr>
                     )
                  })}
               </tbody>
            </table>
         </div>
      </div>
   );

   // DiagnosticPanel component - shows detailed breakdown when balance sheet doesn't balance
   const DiagnosticPanel = () => {
      // Only show if there's animbalance
      const hasImbalance = yearSettings.some(year => {
         const check = calculations[year.id]?.["Balance Sheet Check"] || 0;
         return Math.abs(check) > 0.01;
      });

      if (!hasImbalance) return null;

      return (
         <div className="mb-8 p-6 bg-red-50 border-2 border-red-300 rounded-lg print:hidden">
            <h3 className="text-lg font-bold mb-4 text-red-800">⚠️ Balance Sheet Diagnostic</h3>
            <p className="text-sm text-red-700 mb-4">
               The balance sheet is not balancing. Here's the detailed breakdown:
            </p>
            {yearSettings.map(year => {
               const diagnostic = calculations[year.id]?._diagnostic;
               const difference = calculations[year.id]?.["Balance Sheet Check"] || 0;

               if (!diagnostic || Math.abs(difference) < 0.01) return null;

               return (
                  <div key={year.id} className="mb-4 bg-white p-4 rounded border">
                     <h4 className="font-bold mb-2">{year.year_display}</h4>
                     <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                           <div className="font-semibold text-blue-700">Assets: {formatCurrency(diagnostic.assets.total)}</div>
                        </div>
                        <div>
                           <div className="font-semibold text-green-700">Liabilities: {formatCurrency(diagnostic.liabilities.total)}</div>
                        </div>
                     </div>
                     <div className="mt-2 p-2 bg-red-100 rounded text-center font-bold text-red-800">
                        Difference: {formatCurrency(difference)}
                     </div>
                  </div>
               );
            })}
         </div>
      );
   };

   // Helper to sort summaries by year
   const sortSummaries = (summaries) => {
      if (!summaries) return [];
      return [...summaries].sort((a, b) => {
         const getStartYear = (lbl) => {
            if (!lbl) return 0;
            const match = lbl.match(/(\d{4})/);
            return match ? parseInt(match[1]) : 0;
         };
         // Fallback to year_setting.year_display if label is missing
         const labelA = a.year_label || a.year_setting?.year_display || "";
         const labelB = b.year_label || b.year_setting?.year_display || "";
         return getStartYear(labelA) - getStartYear(labelB);
      });
   };

   return (
      <div className="p-6 max-w-7xl mx-auto">
         {/* Tax Regime Selector */}
         <div className="mb-6 flex items-center justify-end space-x-4 print:hidden">
            <label className="text-sm font-medium text-gray-700">Tax Regime:</label>
            <select
               value={taxRegime}
               onChange={(e) => setTaxRegime(e.target.value)}
               className="border border-gray-300 rounded px-3 py-1 text-sm focus:ring-blue-500 focus:border-blue-500"
            >
               <option value="domestic_22">Domestic Company (Sec 115BAA) - ~25.17%</option>
               <option value="llp">LLP - 30% + Surcharge</option>
               <option value="proprietorship">Proprietorship / Individual (New Regime Slabs)</option>
               <option value="old_regime">Domestic Company (Old Regime) - 25%</option>
            </select>
         </div>

         {/* Diagnostic Panel - shows if balance sheet doesn't balance */}
         <DiagnosticPanel />

         <PLWaterfallTable />

         <BalanceSheetTable />


         {/* === DYNAMIC CASH FLOW STATEMENT === */}
         <div className="mb-8 break-inside-avoid">
            <h3 className="text-lg font-bold mb-2 text-gray-800">3. Cash Flow Statement</h3>
            <div className="overflow-x-auto border border-gray-300 rounded bg-white">
               <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-100">
                     <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                        {yearSettings.map(year => (
                           <th key={year.id} className="px-3 py-2 text-right font-semibold text-gray-700">
                              {year.year_display}
                           </th>
                        ))}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                     {/* A. OPERATING ACTIVITIES */}
                     <tr className="bg-gray-200">
                        <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                           A. Cash Flow from Operating Activities
                        </td>
                     </tr>
                     {["Net profit/Profit/Loss after tax", "Add: Depreciation", "Add: Term Loan Interest", "Add: Working Capital Interest"].map(key => (
                        <tr key={key} className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-700 pl-6">{key}</td>
                           {yearSettings.map(year => (
                              <td key={year.id} className="px-3 py-2 text-right text-gray-600">
                                 {formatCurrency(calculations[year.id]?.[key] || 0)}
                              </td>
                           ))}
                        </tr>
                     ))}

                     {/* Working Capital Changes - Individual Deltas */}
                     <tr className="bg-gray-100">
                        <td colSpan={yearSettings.length + 1} className="px-3 py-1 font-semibold text-gray-700 text-xs pl-6">
                           Working Capital Changes
                        </td>
                     </tr>
                     {(() => {
                        // Get all unique delta keys from all years
                        const deltaKeys = new Set();
                        yearSettings.forEach(year => {
                           const deltas = calculations[year.id]?._operatingDeltas || [];
                           deltas.forEach(d => deltaKeys.add(d.name));
                        });

                        return Array.from(deltaKeys).map(name => (
                           <tr key={name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-600 pl-10 text-sm">Δ {name}</td>
                              {yearSettings.map(year => {
                                 const val = calculations[year.id]?.[`Δ ${name}`] || 0;
                                 return (
                                    <td key={year.id} className={`px-3 py-2 text-right text-sm ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                       {formatCurrency(val)}
                                    </td>
                                 );
                              })}
                           </tr>
                        ));
                     })()}

                     <tr className="bg-blue-50 font-bold">
                        <td className="px-3 py-2 text-gray-900 pl-4">Net Cash from Operating Activities</td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="px-3 py-2 text-right text-gray-900">
                              {formatCurrency(calculations[year.id]?.["Net Cash from Operating Activities"] || 0)}
                           </td>
                        ))}
                     </tr>

                     {/* B. INVESTING ACTIVITIES */}
                     <tr className="bg-gray-200">
                        <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                           B. Cash Flow from Investing Activities
                        </td>
                     </tr>
                     {["Less: Purchase/Addition of Fixed Assets"].map(key => (
                        <tr key={key} className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-700 pl-6">{key}</td>
                           {yearSettings.map(year => (
                              <td key={year.id} className="px-3 py-2 text-right text-gray-600">
                                 {formatCurrency(calculations[year.id]?.[key] || 0)}
                              </td>
                           ))}
                        </tr>
                     ))}

                     {/* Other Investing Deltas - Individual heads like Investment in Subsidy */}
                     {(() => {
                        const deltaKeys = new Set();
                        yearSettings.forEach(year => {
                           const deltas = calculations[year.id]?._investingDeltas || [];
                           deltas.forEach(d => deltaKeys.add(d.name));
                        });

                        return Array.from(deltaKeys).map(name => (
                           <tr key={name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-600 pl-10 text-sm">Δ {name}</td>
                              {yearSettings.map(year => {
                                 const val = calculations[year.id]?.[`Δ ${name}`] || 0;
                                 return (
                                    <td key={year.id} className={`px-3 py-2 text-right text-sm ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                       {formatCurrency(val)}
                                    </td>
                                 );
                              })}
                           </tr>
                        ));
                     })()}

                     <tr className="bg-blue-50 font-bold">
                        <td className="px-3 py-2 text-gray-900 pl-4">Net Cash from Investing Activities</td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="px-3 py-2 text-right text-gray-900">
                              {formatCurrency(calculations[year.id]?.["Net Cash from Investment Activities"] || 0)}
                           </td>
                        ))}
                     </tr>

                     {/* C. FINANCING ACTIVITIES */}
                     <tr className="bg-gray-200">
                        <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                           C. Cash Flow from Financing Activities
                        </td>
                     </tr>
                     {[
                        "Add: Proceeds from Term Loans",
                        "Less: Repayment of Term Loans",
                        "Add/Less: Change in Other Term Liabilities",
                        "Add/Less: Change in WC Borrowings",
                        "Add/Less: Change in Share Capital",
                        "Less: Drawings",
                        "Less: Interest Paid",
                        "Less: Dividend Paid"
                     ].map(key => {
                        // Skip rows with all zero values
                        const hasValue = yearSettings.some(year =>
                           Math.abs(calculations[year.id]?.[key] || 0) > 0.01
                        );
                        if (!hasValue) return null;

                        return (
                           <tr key={key} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-700 pl-6">{key}</td>
                              {yearSettings.map(year => (
                                 <td key={year.id} className="px-3 py-2 text-right text-gray-600">
                                    {formatCurrency(calculations[year.id]?.[key] || 0)}
                                 </td>
                              ))}
                           </tr>
                        );
                     })}

                     {/* Other Financing Deltas - WC Borrowings, Unsecured Loans etc. */}
                     {(() => {
                        const deltaKeys = new Set();
                        yearSettings.forEach(year => {
                           const deltas = calculations[year.id]?._financingDeltas || [];
                           deltas.forEach(d => {
                              // Filter out redundant deltas that are already explicitly handled
                              const nameLower = d.name.toLowerCase();
                              const isRedundant = nameLower.includes('share capital') ||
                                 nameLower.includes('ordinary share capital') ||
                                 nameLower.includes('drawings') ||
                                 nameLower.includes('term loan') ||
                                 nameLower.includes('wc limit') ||
                                 nameLower.includes('working capital');

                              if (!isRedundant) {
                                 deltaKeys.add(d.name);
                              }
                           });
                        });

                        return Array.from(deltaKeys).map(name => (
                           <tr key={name} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-600 pl-10 text-sm">Δ {name}</td>
                              {yearSettings.map(year => {
                                 const val = calculations[year.id]?.[`Δ ${name}`] || 0;
                                 return (
                                    <td key={year.id} className={`px-3 py-2 text-right text-sm ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                       {formatCurrency(val)}
                                    </td>
                                 );
                              })}
                           </tr>
                        ));
                     })()}

                     <tr className="bg-blue-50 font-bold">
                        <td className="px-3 py-2 text-gray-900 pl-4">Net Cash from Financing Activities</td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="px-3 py-2 text-right text-gray-900">
                              {formatCurrency(calculations[year.id]?.["Net Cash from Financing Activities"] || 0)}
                           </td>
                        ))}
                     </tr>


                     {/* D. RECONCILIATION */}
                     <tr className="bg-gray-200">
                        <td colSpan={yearSettings.length + 1} className="px-3 py-2 font-bold text-gray-900 uppercase text-xs">
                           D. Reconciliation
                        </td>
                     </tr>
                     {["Net Cash Flow During the Year", "Add: Opening Cash Balance"].map(key => (
                        <tr key={key} className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-700 pl-6">{key}</td>
                           {yearSettings.map(year => (
                              <td key={year.id} className="px-3 py-2 text-right text-gray-600">
                                 {formatCurrency(calculations[year.id]?.[key] || 0)}
                              </td>
                           ))}
                        </tr>
                     ))}
                     <tr className="bg-blue-100 font-bold">
                        <td className="px-3 py-2 text-gray-900 pl-4">Closing Cash Balance (as per CFS)</td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="px-3 py-2 text-right text-gray-900">
                              {formatCurrency(calculations[year.id]?.["Closing Cash Balance (as per CFS)"] || 0)}
                           </td>
                        ))}
                     </tr>

                     {/* Verification */}
                     <tr className="bg-yellow-100 border-t-2 border-yellow-400">
                        <td className="px-3 py-2 font-bold text-gray-900 pl-4">Balance Sheet Check (Assets - Liabilities)</td>
                        {yearSettings.map(year => {
                           const check = calculations[year.id]?.["Balance Sheet Check"] || 0;
                           const isBalanced = Math.abs(check) < 0.01;
                           return (
                              <td key={year.id} className={`px-3 py-2 text-right font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
                                 {formatCurrency(check)} {isBalanced ? '✓' : '⚠'}
                              </td>
                           );
                        })}
                     </tr>
                  </tbody>
               </table>
            </div>
         </div>


         {/* Custom Loan Schedule Table - Shows all years including those beyond projection */}
         <div className="mb-8 break-inside-avoid">
            <h3 className="text-lg font-bold mb-2 text-gray-800">4. Loan Schedules</h3>

            {/* Individual Schedules */}
            {existingLoans.map((loan, idx) => {
               const sortedSummaries = sortSummaries(loan.year_summaries);
               return (
                  <div key={`loan-${idx}`} className="mb-6">
                     <h4 className="font-semibold text-gray-700 mb-2">{loan.loan_name}</h4>
                     <div className="overflow-x-auto border border-gray-300 rounded bg-white">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                           <thead className="bg-gray-100">
                              <tr>
                                 <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                                 {sortedSummaries.map((s, i) => (
                                    <th key={i} className="px-3 py-2 text-right font-semibold text-gray-700">
                                       {s.year_label || s.year_setting?.year_display || `Year ${i + 1}`}
                                    </th>
                                 ))}
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-200">
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Opening</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.opening_balance)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Interest</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.annual_interest)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Principal</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.annual_principal)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Closing</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.closing_balance)}</td>
                                 ))}
                              </tr>
                           </tbody>
                        </table>
                     </div>
                  </div>
               );
            })}

            {/* New Loan Schedule */}
            {loanScheduleData && loanScheduleData.year_summaries && (() => {
               const sortedSummaries = sortSummaries(loanScheduleData.year_summaries);
               return (
                  <div className="mb-6">
                     <h4 className="font-semibold text-gray-700 mb-2">{currentReport.new_loan_type === 'wc' ? 'New Working Capital' : 'New Term Loan'}</h4>
                     <div className="overflow-x-auto border border-gray-300 rounded bg-white">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                           <thead className="bg-gray-100">
                              <tr>
                                 <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                                 {sortedSummaries.map((s, i) => (
                                    <th key={i} className="px-3 py-2 text-right font-semibold text-gray-700">
                                       {s.year_label || s.year_setting?.year_display || `Year ${i + 1}`}
                                    </th>
                                 ))}
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-200">
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Opening</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.opening_balance)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Interest</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.annual_interest)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Principal</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.annual_principal)}</td>
                                 ))}
                              </tr>
                              <tr>
                                 <td className="px-3 py-2 text-gray-900">Closing</td>
                                 {sortedSummaries.map((s, i) => (
                                    <td key={i} className="px-3 py-2 text-right text-gray-900">{formatCurrency(s.closing_balance)}</td>
                                 ))}
                              </tr>
                           </tbody>
                        </table>
                     </div>
                  </div>
               );
            })()}

            <h3 className="text-lg font-bold mb-2 text-gray-800">Consolidated Schedule</h3>
            {aggregatedLoanSchedule.length > 0 ? (
               <div className="overflow-x-auto border border-gray-300 rounded bg-white">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                     <thead className="bg-gray-100">
                        <tr>
                           <th className="px-3 py-2 text-left font-semibold text-gray-700 w-64">Particulars</th>
                           {aggregatedLoanSchedule.map((summary, idx) => (
                              <th key={idx} className="px-3 py-2 text-right font-semibold text-gray-700">
                                 {summary.year_display}
                              </th>
                           ))}
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-200">
                        {/* Opening Balance */}
                        <tr className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-900">Loan Opening Balance</td>
                           {aggregatedLoanSchedule.map((summary, idx) => (
                              <td key={idx} className="px-3 py-2 text-right text-gray-900">
                                 {formatCurrency(summary.opening_balance)}
                              </td>
                           ))}
                        </tr>
                        {/* Interest */}
                        <tr className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-900">Term Loan Interest</td>
                           {aggregatedLoanSchedule.map((summary, idx) => (
                              <td key={idx} className="px-3 py-2 text-right text-gray-900">
                                 {formatCurrency(summary.annual_interest)}
                              </td>
                           ))}
                        </tr>
                        {/* Principal Repayment */}
                        <tr className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-900">Loan Principal Repayment</td>
                           {aggregatedLoanSchedule.map((summary, idx) => (
                              <td key={idx} className="px-3 py-2 text-right text-gray-900">
                                 {formatCurrency(summary.annual_principal)}
                              </td>
                           ))}
                        </tr>
                        {/* Closing Balance */}
                        <tr className="hover:bg-gray-50">
                           <td className="px-3 py-2 text-gray-900">Loan Closing Balance</td>
                           {aggregatedLoanSchedule.map((summary, idx) => (
                              <td key={idx} className="px-3 py-2 text-right text-gray-900">
                                 {formatCurrency(summary.closing_balance)}
                              </td>
                           ))}
                        </tr>
                     </tbody>
                  </table>
               </div>
            ) : (
               <div className="p-4 bg-gray-50 text-gray-500 italic border rounded">
                  <p>No loan schedule data available.</p>
                  <p className="mt-2">To generate the schedule:</p>
                  <ol className="list-decimal ml-5 mt-1 space-y-1">
                     <li>Go to the <Link to={`/project-report/${currentReport.id}/liabilities`} className="text-blue-600 hover:underline">Liabilities</Link> page.</li>
                     <li>Click on the <strong>"Setup Loan Schedule"</strong> button at the bottom.</li>
                     <li>Review the settings and click <strong>"Create/Update Schedule"</strong>.</li>
                  </ol>
               </div>
            )}
         </div>

         <Table title="5. Key Ratios" isRatio={true} rows={[
            "Debt Equity Ratio", "Current ratio", "Quick ratio",
            "Fixed Assets Coverage Ratio",
            "Interest coverage ratio", "Debt Service Coverage Ratio (DSCR)",
            "Return on Capital Employed (ROCE)", "Net profit margin", "Return on Net worth",
            "Inventory turnover ratio", "Fixed asset turnover ratio", "Asset turnover ratio"
         ]} />

         {/* CASH FLOW VERIFICATION SECTION */}
         <div className="mt-8 p-6 bg-gray-50 border border-gray-300 rounded-lg break-inside-avoid print:break-before-page">
            <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Cash Flow Verification Rule</h3>
            <div className="overflow-x-auto">
               <table className="w-full text-sm text-left border-collapse">
                  <thead>
                     <tr className="bg-gray-100 border-b border-gray-300">
                        <th className="p-2 font-semibold text-gray-700">Particulars</th>
                        {yearSettings.map(year => (
                           <th key={year.id} className="p-2 font-semibold text-right text-gray-700 w-32">
                              {year.year_display}
                           </th>
                        ))}
                     </tr>
                  </thead>
                  <tbody>
                     {/* Row 1: Cash (CFS) */}
                     <tr className="border-b border-gray-200">
                        <td className="p-2 font-medium text-gray-800">
                           <div>Cash (CFS)</div>
                           <div className="text-xs text-gray-500 font-normal">Net Cash Flow + Opening Cash</div>
                        </td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="p-2 text-right font-mono">
                              {formatCurrency(calculations[year.id]?.["Closing Cash Balance (CFS)"])}
                           </td>
                        ))}
                     </tr>

                     {/* Row 2: Cash (BS) */}
                     <tr className="border-b border-gray-200">
                        <td className="p-2 font-medium text-gray-800">
                           <div>Cash (BS)</div>
                           <div className="text-xs text-gray-500 font-normal">Cash & Bank Balance (Balancing Figure)</div>
                        </td>
                        {yearSettings.map(year => (
                           <td key={year.id} className="p-2 text-right font-mono">
                              {formatCurrency(calculations[year.id]?.["Cash & Bank Balance"])}
                           </td>
                        ))}
                     </tr>

                     {/* Row 3: Difference */}
                     <tr className="border-b border-gray-200 bg-gray-50">
                        <td className="p-2 font-bold text-gray-800">Difference</td>
                        {yearSettings.map(year => {
                           const diff = calculations[year.id]?.["CFS Check Diff"] || 0;
                           const isZero = Math.abs(diff) < 1;
                           return (
                              <td key={year.id} className={`p-2 text-right font-mono font-bold ${isZero ? 'text-green-600' : 'text-red-600'}`}>
                                 {formatCurrency(diff)}
                              </td>
                           );
                        })}
                     </tr>

                     {/* Row 4: Final Sanity Check */}
                     <tr className="border-b border-gray-200">
                        <td className="p-2 font-medium text-gray-800">
                           <div>Final Sanity Check</div>
                           <div className="text-xs text-gray-500 font-normal">Total Assets - Total Liabilities</div>
                        </td>
                        {yearSettings.map(year => {
                           const assets = calculations[year.id]?.["Total Asset"] || 0;
                           const liabilities = calculations[year.id]?.["Total liabilities"] || 0;
                           const diff = assets - liabilities;
                           const isZero = Math.abs(diff) < 1;
                           return (
                              <td key={year.id} className={`p-2 text-right font-mono ${isZero ? 'text-green-600' : 'text-red-600'}`}>
                                 {formatCurrency(diff)}
                              </td>
                           );
                        })}
                     </tr>
                  </tbody>
               </table>
            </div>
            <div className="mt-2 text-xs text-gray-500 italic">
               * The Difference row must be zero for the Cash Flow Statement to be mathematically consistent with the Balance Sheet.
            </div>
         </div>

         <div className="mt-8 text-center print:hidden">
            <div className="flex justify-center gap-4">
               <button
                  onClick={async () => {
                     setDownloadingPDF(true);
                     setDownloadError(null);
                     try {
                        const blob = await apiClient.downloadReportPDF(currentReport.id);
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `CMA_Report_${currentReport.company_name.replace(/\s+/g, '_')}.pdf`;
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                        window.URL.revokeObjectURL(url);
                     } catch (error) {
                        console.error('PDF download failed:', error);
                        setDownloadError('Failed to download PDF. Please try again.');
                     } finally {
                        setDownloadingPDF(false);
                     }
                  }}
                  disabled={downloadingPDF}
                  className="bg-green-600 text-white px-6 py-2 rounded shadow hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2">
                  {downloadingPDF ? (
                     <>
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                           <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                           <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating PDF...
                     </>
                  ) : (
                     <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download PDF
                     </>
                  )}
               </button>

               <button
                  onClick={() => window.print()}
                  className="bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Report
               </button>
            </div>

            {downloadError && (
               <div className="mt-4 text-red-600 text-sm">
                  {downloadError}
               </div>
            )}
         </div>
      </div>
   );
}

export function DownloadPage() {
   return (
      <div className="p-8 text-center">
         <h2 className="text-2xl font-bold">Download Report</h2>
         <p className="mb-6 text-gray-600">To download the PDF, please go to the <b>Preview</b> page and click the "Print / Save as PDF" button.</p>
         <button
            onClick={() => window.history.back()}
            className="text-blue-600 underline"
         >
            Go Back
         </button>
      </div>
   );
}