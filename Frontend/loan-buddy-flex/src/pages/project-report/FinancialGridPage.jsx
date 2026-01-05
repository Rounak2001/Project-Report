import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { FullScreenLoader } from '@/components/common.jsx';
import { useNavigate } from 'react-router-dom';
import { AssetBreakdownModal } from '@/components/AssetBreakdownModal.jsx';
import { LoanScheduleModal } from '@/components/LoanScheduleModal.jsx';
import { ExistingWCModal } from '@/components/ExistingWCModal.jsx';
import { calculateAll } from '@/services/financialCalculations';
import { generateLoanSchedule, aggregateAllYears } from '@/services/loanCalculations.js';

// --- Helper Components ---

function getNextPage(current, id) {
    if (current === 'operating') return `/project-report/${id}/assets`;
    if (current === 'asset') return `/project-report/${id}/liabilities`;
    return `/project-report/${id}/preview`;
}

function DataCell({ rowId, yearId, initialValue, onSave, row, yearSettings, onAutoProject, formulaState, onStartFormula, onAppendToFormula }) {
    const [val, setVal] = useState(initialValue);

    useEffect(() => { setVal(initialValue); }, [initialValue]);

    const handleBlur = async () => {
        const newValue = parseFloat(val) || 0;
        const oldValue = parseFloat(initialValue) || 0;

        // Only save if value actually changed
        if (Math.abs(newValue - oldValue) < 0.001) return;

        await onSave(rowId, yearId, newValue);

        // Auto-project ONLY from the FIRST year (index 0) to avoid cascading projections
        // AND skip for stock rows and general reserve
        const isStockRow = row.name.toLowerCase().includes('opening stock') || row.name.toLowerCase().includes('closing stock');
        const isGeneralReserve = row.name === 'General reserve';
        const currentYearIndex = yearSettings.findIndex(y => y.id === yearId);

        if (!isStockRow && !isGeneralReserve && currentYearIndex === 0 && newValue > 0) {
            onAutoProject(row, currentYearIndex, newValue);
        }
    };

    return (
        <td className={`p-0 border-r h-full relative group ${formulaState.active ? 'cursor-pointer hover:bg-yellow-50' : ''}`}>
            {/* Formula Button (Only visible on hover and not in formula mode) */}
            {!formulaState.active && (
                <button
                    onClick={(e) => {
                        e.stopPropagation(); // Prevent focusing input
                        onStartFormula(rowId, yearId, val, setVal);
                    }}
                    className="absolute left-0 top-0 bottom-0 w-6 bg-gray-100 text-gray-500 hover:text-blue-600 hover:bg-blue-50 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center border-r"
                    title="Formula"
                    tabIndex={-1}
                >
                    fx
                </button>
            )}

            {formulaState.active ? (
                // In formula mode, this cell acts as a button to select its value
                <div
                    className="w-full h-full p-2 text-right text-sm flex items-center justify-end cursor-pointer hover:bg-yellow-100"
                    onClick={() => onAppendToFormula(val)}
                >
                    {val}
                </div>
            ) : (
                // Normal Edit Mode
                <input
                    type="number"
                    className="w-full h-full p-2 text-right text-sm focus:ring-2 focus:ring-inset focus:ring-blue-500 border-0 bg-transparent outline-none pl-8" // Added pl-8 for space for fx button
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                />
            )}
        </td>
    );
}

function ProjectionTool({ row, years, onRun }) {
    const [pct, setPct] = useState(10);
    const [baseYearIndex, setBaseYearIndex] = useState(0);

    const handleProjection = () => {
        const baseYear = years[baseYearIndex];
        const baseValue = row.data.find(d => d.year_setting === baseYear.id)?.value || 0;
        onRun(row.id, baseYear.year, baseValue, pct);
    };

    return (
        <div className="flex flex-col items-center justify-center space-y-1 opacity-50 group-hover:opacity-100 transition-opacity">
            <div className="flex items-center space-x-1">
                <select
                    className="w-20 h-6 text-xs border border-gray-300 rounded"
                    value={baseYearIndex}
                    onChange={e => setBaseYearIndex(parseInt(e.target.value))}
                >
                    {years.map((year, index) => (
                        <option key={year.id} value={index}>{year.year_display}</option>
                    ))}
                </select>
                <input
                    type="number"
                    className="w-12 h-6 text-xs border border-gray-300 rounded text-center"
                    value={pct}
                    onChange={e => setPct(e.target.value)}
                />
                <span className="text-xs">%</span>
            </div>
            <button
                onClick={handleProjection}
                className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-200"
                title="Apply Projection from Selected Year"
            >
                Project
            </button>
        </div>
    );
}

function SmartProjectionTool({ row, onRun, label }) {
    const [pct, setPct] = useState(0);

    const handleRun = () => {
        onRun(row.id, pct);
    };

    return (
        <div className="flex flex-col items-center justify-center space-y-1 opacity-50 group-hover:opacity-100 transition-opacity">
            <div className="flex items-center space-x-1">
                <input
                    type="number"
                    className="w-12 h-6 text-xs border border-gray-300 rounded text-center"
                    value={pct}
                    onChange={e => setPct(e.target.value)}
                    placeholder="%"
                />
                <span className="text-xs">% of {label}</span>
            </div>
            <button
                onClick={handleRun}
                className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded hover:bg-purple-200"
                title={`Set as % of ${label}`}
            >
                Apply
            </button>
        </div>
    );
}

// --- 6. Financial Grid Page (Smart Grid) ---
export function FinancialGridPage({ pageType, title }) {
    const { currentReport, yearSettings, operatingGroups, assetGroups, liabilityGroups, projectCosts, reloadFinancialData } = useContext(AppContext);
    const navigate = useNavigate();

    // --- Formula Feature State ---
    const [formulaState, setFormulaState] = useState({
        active: false,
        targetRowId: null,
        targetYearId: null,
        expression: '',
        targetSetVal: null // Function to update the local state of the target cell immediately
    });

    // --- Asset Modal State ---
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
    const [isWCModalOpen, setIsWCModalOpen] = useState(false); // New State
    const [loanScheduleData, setLoanScheduleData] = useState(null);
    const [existingLoans, setExistingLoans] = useState([]);
    const [existingWCLoans, setExistingWCLoans] = useState([]); // New State
    const [totalLoanRequired, setTotalLoanRequired] = useState(0);

    // --- Drawings Modal State (LLP/Proprietorship) ---
    // Removed as Drawings are now standard rows

    // --- Loading & Message State ---
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    const hasSyncedAssetsRef = useRef(false);

    useEffect(() => {
        // Reset sync flag when page changes (e.g. from Operating to Asset)
        // But since component might remount, the ref resets anyway.
        // However, if we navigate within the same component instance (if router keeps it), we might need this.
        // For now, assuming remount.

        // If we are on Asset page, and haven't synced yet, and data is available
        if (pageType === 'asset' && !hasSyncedAssetsRef.current && yearSettings.length > 0 && assetGroups.length > 0) {

            handleSaveAssets();
            hasSyncedAssetsRef.current = true;
        }
    }, [pageType, yearSettings.length, assetGroups.length]);

    // Fetch loan schedule data and project costs
    useEffect(() => {
        if (currentReport?.id) {
            fetchLoanData(); // Renamed
            calculateTotalLoanRequired();
            // Reload financial data to ensure we have the latest values (especially when switching tabs)
            if (reloadFinancialData && currentReport?.id) {
                reloadFinancialData(currentReport.id);
            }
        }
    }, [currentReport?.id, pageType]);

    const calculateTotalLoanRequired = async () => {
        try {
            const projectCosts = await apiClient.getProjectCosts(currentReport.id);

            // Filter costs: Only include assets purchased in the Start Year AND NOT existing assets
            const startYearSetting = yearSettings.find(y => y.year === currentReport.start_year) || yearSettings[0];
            const startYearId = startYearSetting?.id;

            const startYearCosts = projectCosts.filter(item => {
                // Exclude existing assets (promoter's contribution/existing business)
                if (item.is_existing_asset) return false;

                // If purchase_year is explicitly set, check if it matches start year ID
                if (item.purchase_year) {
                    return parseInt(item.purchase_year) === startYearId;
                }
                // If purchase_year is missing, assume it's part of initial setup (Start Year)
                return true;
            });

            const totalProjectCost = startYearCosts.reduce((acc, item) => acc + parseFloat(item.amount || 0), 0);
            const contributionPercent = parseFloat(currentReport.new_loan_contribution_percent || 0);
            const contribution = totalProjectCost * (contributionPercent / 100);
            const loanRequired = totalProjectCost - contribution;
            setTotalLoanRequired(loanRequired);
        } catch (error) {
            console.error("Failed to calculate total loan:", error);
            setTotalLoanRequired(0);
        }
    };

    const fetchLoanData = async () => {
        try {
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

            // 3. Fetch Existing Working Capital Loans
            const wcLoans = await apiClient.getExistingWCLoans(currentReport.id);
            setExistingWCLoans(wcLoans || []);

            // 4. Fetch Drawings (LLP/Proprietorship)
            // Removed as Drawings are now standard rows

        } catch (error) {
            console.error("Failed to fetch loan data:", error);
            setLoanScheduleData(null);
            setExistingLoans([]);
            setExistingWCLoans([]);
        }
    };

    // Helper to combine all loan summaries
    const getAllLoanSummaries = () => {
        let summaries = [];

        // Add New Loan Summaries
        if (loanScheduleData?.year_summaries) {
            const newLoanName = currentReport.new_loan_type === 'wc' ? 'New Working Capital' : 'New Term Loan';
            const labeled = loanScheduleData.year_summaries.map(s => ({
                ...s,
                loan_name: newLoanName,
                is_new_loan: true
            }));
            summaries = [...summaries, ...labeled];
        }

        // Add Existing Loan Summaries
        if (existingLoans.length > 0) {
            existingLoans.forEach(loan => {
                if (loan.year_summaries) {
                    const labeled = loan.year_summaries.map(s => ({
                        ...s,
                        loan_name: loan.loan_name,
                        is_new_loan: false
                    }));
                    summaries = [...summaries, ...labeled];
                }
            });
        }

        return summaries;
    };

    const handleGenerateLoanSchedule = async () => {
        if (!currentReport || totalLoanRequired <= 0) {
            alert("Please add project costs first");
            return;
        }

        setLoading(true);
        try {
            // Find start year
            const startYearSetting = yearSettings.find(y => y.year === currentReport.start_year) || yearSettings[0];

            // Generate schedule locally to get summary
            const schedule = generateLoanSchedule({
                loanAmount: totalLoanRequired,
                interestRate: parseFloat(currentReport.new_loan_interest_rate || 10),
                tenureMonths: (parseInt(currentReport.new_loan_tenure_years || 5)) * 12,
                moratoriumMonths: parseInt(currentReport.new_loan_moratorium_months || 6),
                repaymentMethod: 'EMI',
                startDate: currentReport.new_loan_start_date
            });

            const yearlySummary = aggregateAllYears(schedule, yearSettings, null);

            const payload = {
                report: currentReport.id,
                loan_amount: totalLoanRequired,
                interest_rate: parseFloat(currentReport.new_loan_interest_rate || 10),
                tenure_months: (parseInt(currentReport.new_loan_tenure_years || 5)) * 12,
                moratorium_months: parseInt(currentReport.new_loan_moratorium_months || 6),
                repayment_method: 'EMI',
                start_year_id: startYearSetting.id,
                yearly_summary: yearlySummary
            };

            if (loanScheduleData) {
                await apiClient.updateLoanSchedule(loanScheduleData.id, payload);
            } else {
                await apiClient.createLoanSchedule(payload);
            }

            await fetchLoanData();
            await reloadFinancialData(currentReport.id);
            setMessage({ type: 'success', text: 'Loan schedule generated successfully!' });
        } catch (error) {
            console.error("Failed to generate loan schedule:", error);
            alert("Failed to generate loan schedule");
        }
        setLoading(false);
        setTimeout(() => setMessage(null), 3000);
    };

    const handleSaveAssets = async () => {
        // 1. Fetch all assets
        const assets = await apiClient.getProjectCosts(currentReport.id);

        // 2. Calculate Vectors using WDV Method (User Preference)
        // Logic:
        // Year 0: GB = input, NB = GB - Dep
        // Year N: GB = Prior NB + Additions, NB = Current GB - Current Dep

        const grossBlockMap = {}; // Calculated Gross Block for each year
        const annualDepMap = {};  // Annual Depreciation Expense

        // Initialize maps
        yearSettings.forEach(y => {
            grossBlockMap[y.id] = 0;
            annualDepMap[y.id] = 0;
        });

        const sortedYears = [...yearSettings].sort((a, b) => a.year - b.year);
        const startYearId = sortedYears[0]?.id;

        // Simplified WDV Logic:
        // Year N Gross Block = Previous Year Total Net Block + Additions
        // Depreciation = Gross Block * Rate (weighted average or per asset)

        let previousYearTotalNetBlock = 0;

        // Track WDV for each asset to ensure correct depreciation on reducing balance
        const assetWDVs = {}; // Map: asset.id -> current WDV (Closing Balance of previous year)

        sortedYears.forEach((year, yearIndex) => {
            let additionsThisYear = 0;
            let depreciationThisYear = 0;

            // 1. Calculate Total Additions for this year
            assets.forEach(asset => {
                let purchaseYearId = asset.purchase_year ? parseInt(asset.purchase_year) : startYearId;

                // LOGIC FIX: Only respect is_existing_asset if the purchase year actually matches start year
                if (asset.is_existing_asset && purchaseYearId === startYearId) {
                    purchaseYearId = startYearId;
                }

                const isMatch = String(year.id) === String(purchaseYearId);
                // Robust comparison: Ensure both are treated as strings or numbers
                if (isMatch) {
                    additionsThisYear += parseFloat(asset.amount || 0);
                }
            });

            // 2. Calculate Gross Block
            let grossBlockThisYear = 0;
            if (yearIndex === 0) {
                grossBlockThisYear = additionsThisYear;
            } else {
                // STRICTLY: Previous Year Net Block + Additions
                grossBlockThisYear = previousYearTotalNetBlock + additionsThisYear;
            }

            // 3. Calculate Depreciation
            // We calculate depreciation for each asset based on its share of the Gross Block
            // Or simply: Depreciation = Sum(Asset Current Value * Rate)
            // But since we forced GB = Prev NB + Additions, we must distribute this GB back to assets to apply rates

            // Alternative: Calculate depreciation per asset on its theoretical WDV, then sum it up
            // But we must ensure Total Depreciation is consistent with the Gross Block we just set.

            // Let's calculate depreciation on the *components* of the Gross Block
            assets.forEach(asset => {
                let purchaseYearId = asset.purchase_year ? parseInt(asset.purchase_year) : startYearId;
                if (asset.is_existing_asset) purchaseYearId = startYearId;
                const purchaseYearIndex = sortedYears.findIndex(y => y.id === purchaseYearId);

                if (yearIndex >= purchaseYearIndex) {
                    const assetAmount = parseFloat(asset.amount || 0);
                    const rate = parseFloat(asset.depreciation_rate || 0) / 100;

                    let effectiveRate = rate;
                    if (year.id === purchaseYearId && asset.is_second_half_purchase) {
                        effectiveRate = rate / 2;
                    }

                    // We need to apply this rate to the asset's portion of the Gross Block
                    // Approximation: Use the asset's original cost weight against total cost
                    // Better: Track individual WDVs just for depreciation calculation

                    // To keep it simple and match the "Gross Block" exactly:
                    // We can't easily apply different rates to a single "Gross Block" number without tracking components.
                    // So we will track components BUT force their sum to match our Gross Block rule.

                    // Actually, if we just calculate depreciation on the asset's WDV, the math works out.
                    // The sum of (Asset Prev WDV + Asset Addition) IS (Total Prev Net Block + Total Additions).
                    // So we can use the per-asset logic, but we must be careful not to double count.

                    // Let's use the per-asset tracking again, but verify the sum.
                }
            });

            // RE-IMPLEMENTING PER-ASSET TRACKING BUT SIMPLER
            // to ensure GB = Prev NB + Additions holds true mathematically.

            let calculatedDepreciation = 0;

            assets.forEach(asset => {
                // Initialize WDV if needed
                if (assetWDVs[asset.id] === undefined) assetWDVs[asset.id] = 0;

                let purchaseYearId = asset.purchase_year ? parseInt(asset.purchase_year) : startYearId;
                // Same logic fix for depreciation loop
                if (asset.is_existing_asset && purchaseYearId === startYearId) {
                    purchaseYearId = startYearId;
                }

                const purchaseYearIndex = sortedYears.findIndex(y => String(y.id) === String(purchaseYearId));

                if (yearIndex >= purchaseYearIndex) {
                    const rate = parseFloat(asset.depreciation_rate || 0) / 100;
                    let effectiveRate = rate;
                    // Robust comparison for half depreciation check
                    if (String(year.id) === String(purchaseYearId) && asset.is_second_half_purchase) effectiveRate = rate / 2;

                    // Robust comparison for addition check
                    let assetAddition = (String(year.id) === String(purchaseYearId)) ? parseFloat(asset.amount || 0) : 0;

                    // Asset GB = Prev WDV + Addition
                    let assetGB = assetWDVs[asset.id] + assetAddition;

                    // Asset Dep = Asset GB * Rate
                    let assetDep = assetGB * effectiveRate;

                    // Asset NB = Asset GB - Asset Dep
                    let assetNB = assetGB - assetDep;

                    // Update WDV
                    assetWDVs[asset.id] = assetNB;

                    calculatedDepreciation += assetDep;
                }
            });

            depreciationThisYear = calculatedDepreciation;

            // Net Block = Gross Block - Depreciation
            const netBlockThisYear = grossBlockThisYear - depreciationThisYear;

            // Update for next year
            previousYearTotalNetBlock = netBlockThisYear;

            // Store results
            grossBlockMap[year.id] = grossBlockThisYear;
            annualDepMap[year.id] = depreciationThisYear;
        });

        // Helper to find row by name across all groups
        const findRowId = async (namePart, pType) => {
            let groups = [];
            if (pType === 'operating') groups = operatingGroups;
            else if (pType === 'asset') groups = assetGroups;
            else if (pType === 'liability') groups = liabilityGroups;

            // Priority 1: Exact Match (Trimmed and Case Insensitive)
            for (const g of groups) {
                const r = g.rows.find(r => r.name.trim().toLowerCase() === namePart.trim().toLowerCase());
                if (r) return r.id;
            }

            // Priority 2: Partial Match (Fallback)
            for (const g of groups) {
                const r = g.rows.find(r => r.name.toLowerCase().includes(namePart.toLowerCase()));
                if (r) return r.id;
            }
            return null;
        };

        // 3. Save to Database

        // A. Gross Block (Asset Page) -> Opening WDV + Additions
        const grossBlockRowId = await findRowId("Gross block", 'asset');
        if (grossBlockRowId) {
            for (const year of yearSettings) {
                await apiClient.saveCell({
                    report_id: currentReport.id,
                    row_id: grossBlockRowId,
                    year_setting_id: year.id,
                    value: grossBlockMap[year.id]
                });
            }
        }

        // B. Depreciation (Asset Page) -> Annual Depreciation
        // So that Net Block = Gross Block - Depreciation
        const assetDepRowId = await findRowId("Depreciation", 'asset');
        if (assetDepRowId) {
            for (const year of yearSettings) {
                await apiClient.saveCell({
                    report_id: currentReport.id,
                    row_id: assetDepRowId,
                    year_setting_id: year.id,
                    value: annualDepMap[year.id]
                });
            }
        }

        // C. Depreciation (Operating Page) -> Annual Depreciation Expense
        // Changed target to generic "Depreciation" as per user request
        const opDepRowId = await findRowId("Depreciation", 'operating');
        if (opDepRowId) {
            for (const year of yearSettings) {
                await apiClient.saveCell({
                    report_id: currentReport.id,
                    row_id: opDepRowId,
                    year_setting_id: year.id,
                    value: annualDepMap[year.id]
                });
            }
        }

        // Reload data to reflect changes
        await reloadFinancialData(currentReport.id);
    };

    const startFormulaMode = (rowId, yearId, currentVal, setValFn) => {
        setFormulaState({
            active: true,
            targetRowId: rowId,
            targetYearId: yearId,
            expression: currentVal ? String(currentVal) : '',
            targetSetVal: setValFn
        });
    };

    const cancelFormulaMode = () => {
        setFormulaState({ active: false, targetRowId: null, targetYearId: null, expression: '', targetSetVal: null });
    };

    const handleFormulaInput = (val) => {
        setFormulaState(prev => ({ ...prev, expression: val }));
    };

    const appendToFormula = (val) => {
        if (!formulaState.active) return;
        // If the last char is a number and we add a number, it appends. 
        // Ideally we want to prevent invalid syntax like "100100" if the user meant "100+100".
        // But for now, we just append the value. The user can type operators.
        setFormulaState(prev => ({ ...prev, expression: prev.expression + val }));
    };

    const applyFormula = async () => {
        try {
            // Evaluate the expression safely
            // NOTE: eval is dangerous if input is unchecked, but here input is numbers/operators.
            // We'll do a basic regex check to ensure only numbers and + - * / ( ) . are present.
            if (/[^0-9+\-*/().\s]/.test(formulaState.expression)) {
                alert("Invalid characters in formula");
                return;
            }

            // eslint-disable-next-line no-new-func
            const result = new Function('return ' + formulaState.expression)();
            const finalVal = Math.round(result * 100) / 100; // Round to 2 decimals

            if (isNaN(finalVal)) {
                alert("Invalid Formula Result");
                return;
            }

            // Update the target cell
            await handleSaveCell(formulaState.targetRowId, formulaState.targetYearId, finalVal);

            // Update local state if available (for immediate feedback)
            if (formulaState.targetSetVal) formulaState.targetSetVal(finalVal);

            cancelFormulaMode();
        } catch (e) {
            alert("Error evaluating formula");
            console.error(e);
        }
    };

    // Prepare data with SMART TOTALS
    const processedData = useMemo(() => {


        let groups = [];
        if (pageType === 'operating') groups = operatingGroups;
        else if (pageType === 'asset') groups = assetGroups;
        else if (pageType === 'liability' || pageType === 'liabilities') groups = liabilityGroups;
        else return []; // Unknown page type

        // Filter hidden rows first!
        // Also strictly filter out Accumulated Depreciation and other unwanted Asset rows here
        const visibleGroups = groups.map(g => ({
            ...g,
            rows: g.rows.filter(r => {
                if (r.is_hidden) return false;

                // STRICT FILTERING FOR ASSETS
                const lowerName = r.name.toLowerCase().trim();
                const isAssetPage = pageType === 'asset';

                if (isAssetPage) {
                    if (lowerName.includes('accumulated') && lowerName.includes('depreciation')) return false;
                    if (lowerName === 'accumulated depreciation') return false;
                    if (lowerName === 'accum depreciation') return false;

                    // Filter duplicate Net Block / Depreciation (we inject calculated ones)
                    // Keep Gross Block though
                    if ((lowerName === 'net block' || lowerName === 'depreciation') && !lowerName.includes('gross')) {
                        return false;
                    }
                }

                return true;
            })
        }));

        // Efficient copy and custom visibility logic
        const displayGroups = visibleGroups.map(group => {
            const isOperating = pageType === 'operating';
            const groupNameLower = group.name.toLowerCase();

            return {
                ...group,
                rows: group.rows.map(row => {
                    const lowerName = row.name.toLowerCase();
                    let is_hidden = row.is_hidden || false;

                    if (isOperating) {
                        // Block "Depreciation (Office Equipment)" as it is auto-calculated
                        if (lowerName.includes("office equipment") && (lowerName.includes("depreciation") || lowerName.includes("depriciation"))) {
                            is_hidden = true;
                        }
                        // Hide "Working Capital Interest" as it is replaced by split heads
                        // AND Hide ANY interest row if it appears in "Selling" group (to avoid duplication)
                        if (groupNameLower.includes("selling") && lowerName.includes("interest")) {
                            is_hidden = true;
                        }

                        if (row.name.trim().toLowerCase() === "working capital interest") {
                            is_hidden = true;
                        }

                        // Hide "Term Loan Interest" as it will be re-injected in the correct group
                        if (row.name.trim().toLowerCase() === "term loan interest") {
                            is_hidden = true;
                        }

                        // Hide "Provision for Taxes" in Operating Statement (User wants "Tax" instead)
                        if (row.name.trim().toLowerCase() === "provision for taxes") {
                            is_hidden = true;
                        }
                    }
                    return { ...row, is_hidden };
                }).filter(r => !r.is_hidden)
            };
        });

        // --- INJECT CALCULATED ROWS ---

        // Calculate results for ALL pages to ensure consistency
        const allGroupsForCalc = [...operatingGroups, ...assetGroups, ...liabilityGroups];
        // Filter excluded items for calculation
        const excludedRows = [];
        const filteredGroups = allGroupsForCalc.map(g => ({
            ...g,
            rows: g.rows.filter(r => {
                const n = r.name.toLowerCase();
                const shouldExclude = n.includes('office equipment') || n.includes('depreciation');
                if (shouldExclude) excludedRows.push(r);
                return !shouldExclude;
            })
        }));
        filteredGroups.push({ name: "Excluded Items", rows: excludedRows });

        const results = calculateAll(
            filteredGroups,
            yearSettings,
            currentReport?.sector,
            currentReport?.tax_regime || 'domestic_22',
            getAllLoanSummaries(),
            undefined,
            currentReport,
            projectCosts,
            existingWCLoans,
            existingWCLoans
        );

        if (pageType === 'operating') {
            // 1. Calculate everything using the shared engine
            // We need all groups for accurate calculation
            // SMART FILTER: Move Depreciation/Office Equipment to a separate group
            const allGroups = [...operatingGroups, ...assetGroups, ...liabilityGroups];
            const excludedRows = [];
            const filteredGroups = allGroups.map(g => ({
                ...g,
                rows: g.rows.filter(r => {
                    const n = r.name.toLowerCase();
                    const shouldExclude = n.includes('office equipment') || n.includes('depreciation');
                    if (shouldExclude) excludedRows.push(r);
                    return !shouldExclude;
                })
            }));
            filteredGroups.push({ name: "Excluded Items", rows: excludedRows });
            const results = calculateAll(filteredGroups, yearSettings, currentReport?.sector, currentReport?.tax_regime || 'domestic_22', getAllLoanSummaries(), undefined, currentReport, projectCosts, existingWCLoans);

            // 2. Find where to inject Gross Profit (After COGS or before SG&A)
            let targetGroupIndex = -1;
            let targetRowIndex = -1;

            displayGroups.forEach((group, gIdx) => {
                // Try to find COGS
                const cogsIndex = group.rows.findIndex(r => r.name.toLowerCase().includes('cost of goods sold'));
                if (cogsIndex !== -1) {
                    targetGroupIndex = gIdx;
                    targetRowIndex = cogsIndex;
                }
            });

            // If COGS not found, try to find the group that contains "Purchases" or "Manufacturing"
            if (targetGroupIndex === -1) {
                targetGroupIndex = displayGroups.findIndex(g =>
                    g.name.toLowerCase().includes('manufacturing') ||
                    g.name.toLowerCase().includes('trading') ||
                    g.name.toLowerCase().includes('operating')
                );
                if (targetGroupIndex !== -1) {
                    targetRowIndex = displayGroups[targetGroupIndex].rows.length - 1;
                }
            }

            if (targetGroupIndex !== -1) {
                // Check if Gross Profit already exists
                const gpExists = displayGroups[targetGroupIndex].rows.some(r => r.name === 'Gross Profit');

                if (!gpExists) {
                    // Create Gross Profit Row
                    const gpData = yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Gross Profit"] || 0
                    }));

                    const gpRow = {
                        id: 'calc-gross-profit',
                        name: 'Gross Profit',
                        is_calculated: true,
                        is_total_row: true,
                        data: gpData
                    };

                    // Create Gross Profit Ratio Row
                    const gpRatioData = yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Gross Profit Ratio"] || 0
                    }));

                    const gpRatioRow = {
                        id: 'calc-gp-ratio',
                        name: 'Gross Profit Ratio',
                        is_calculated: true,
                        is_total_row: true,
                        data: gpRatioData
                    };

                    // Inject them
                    displayGroups[targetGroupIndex].rows.splice(targetRowIndex + 1, 0, gpRow);
                    displayGroups[targetGroupIndex].rows.splice(targetRowIndex + 2, 0, gpRatioRow);
                }
            }

            // 3. INJECT PBDIT & OPERATING PROFIT (After SG&A)
            const sgaGroupIndex = displayGroups.findIndex(g => g.name.toLowerCase().includes('selling') || g.name.toLowerCase().includes('administrative'));
            if (sgaGroupIndex !== -1) {
                const pbditExists = displayGroups[sgaGroupIndex].rows.some(r => r.name.includes('Profit before Depreciation'));
                if (!pbditExists) {
                    const pbditRow = {
                        id: 'calc-pbdit',
                        name: 'Profit before Depreciation, Interest and Tax',
                        is_calculated: true,
                        is_total_row: true,
                        data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Profit before Depreciation, Interest and Tax"] || 0 }))
                    };

                    const deprRow = {
                        id: 'calc-depr-total',
                        name: 'Depreciation',
                        is_calculated: true,
                        is_total_row: true,
                        data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Depreciation"] || 0 }))
                    };

                    const opProfitRow = {
                        id: 'calc-op-profit',
                        name: 'Profit After Depreciation',
                        is_calculated: true,
                        is_total_row: true,
                        data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Profit After Depreciation"] || 0 }))
                    };

                    // Inject at the end of SG&A group
                    displayGroups[sgaGroupIndex].rows.push(pbditRow);
                    displayGroups[sgaGroupIndex].rows.push(deprRow);
                    displayGroups[sgaGroupIndex].rows.push(opProfitRow);
                }
            }

            // 4. INJECT TAXES AND PROFIT APPROPRIATION (Restructured Group)
            const taxGroupIndex = displayGroups.findIndex(g => g.name.toLowerCase().includes('taxes') && g.name.toLowerCase().includes('appropriation'));

            if (taxGroupIndex !== -1) {
                const taxGroup = displayGroups[taxGroupIndex];

                // 1. EXTRACT INPUT ROWS (Preserve their data and IDs)
                const deferredTaxRow = taxGroup.rows.find(r => r.name.toLowerCase().includes('deferred tax'));
                const priorYearAdjRow = taxGroup.rows.find(r => r.name.toLowerCase().includes('prior year adjustment'));
                const dividendPaidRow = taxGroup.rows.find(r => r.name.toLowerCase().includes('equity / dividend paid amount'));
                const dividendTaxRow = taxGroup.rows.find(r => r.name.toLowerCase().includes('dividend tax'));

                // 2. CLEAR EXISTING ROWS
                taxGroup.rows = [];

                // 3. RE-INJECT ROWS IN CORRECT ORDER

                // --- A. INTEREST BREAKDOWN ---

                // Existing Term Loans
                existingLoans.forEach(loan => {
                    taxGroup.rows.push({
                        id: `calc-interest-${loan.id}`,
                        name: `Interest on ${loan.loan_name}`,
                        is_calculated: true,
                        is_total_row: false,
                        data: yearSettings.map(year => ({
                            year_setting: year.id,
                            value: results[year.id]?.[`Interest on ${loan.loan_name}`] || 0
                        }))
                    });
                });

                // New Term Loan / WC (from Schedule)
                if (loanScheduleData) {
                    const newLoanName = currentReport.new_loan_type === 'wc' ? 'New Working Capital' : 'New Term Loan';
                    taxGroup.rows.push({
                        id: 'calc-interest-new',
                        name: `Interest on ${newLoanName}`,
                        is_calculated: true,
                        is_total_row: false,
                        data: yearSettings.map(year => ({
                            year_setting: year.id,
                            value: results[year.id]?.[`Interest on ${newLoanName}`] || 0
                        }))
                    });
                }

                // Working Capital Interest (Existing & Proposed)
                if (existingWCLoans && existingWCLoans.length > 0) {
                    existingWCLoans.forEach(loan => {
                        taxGroup.rows.push({
                            id: `calc-wc-interest-${loan.id}`,
                            name: `Interest on ${loan.bank_name} WC`,
                            is_calculated: true,
                            is_total_row: false,
                            data: yearSettings.map(year => ({
                                year_setting: year.id,
                                value: results[year.id]?.[`Interest on ${loan.bank_name} WC`] || 0
                            }))
                        });
                    });
                } else {
                    taxGroup.rows.push({
                        id: 'calc-wc-interest-existing',
                        name: 'Interest on Existing Working Capital',
                        is_calculated: true,
                        is_total_row: false,
                        data: yearSettings.map(year => ({
                            year_setting: year.id,
                            value: results[year.id]?.["Interest on Existing Working Capital"] || 0
                        }))
                    });
                }

                taxGroup.rows.push({
                    id: 'calc-wc-interest-proposed',
                    name: 'Interest on Proposed Working Capital',
                    is_calculated: true,
                    is_total_row: false,
                    data: yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Interest on Proposed Working Capital"] || 0
                    }))
                });

                // Total Interest
                taxGroup.rows.push({
                    id: 'calc-total-interest',
                    name: 'Total Interest',
                    is_calculated: true,
                    is_total_row: true,
                    data: yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Total Interest"] || 0
                    }))
                });

                // --- B. PROFIT BEFORE TAX ---
                taxGroup.rows.push({
                    id: 'calc-pbt',
                    name: 'Profit Before Tax',
                    is_calculated: true,
                    is_total_row: true,
                    data: yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Profit Before Tax"] || 0
                    }))
                });

                // --- C. TAX (Current) ---
                taxGroup.rows.push({
                    id: 'calc-tax',
                    name: 'Tax',
                    is_calculated: true,
                    is_total_row: true,
                    data: yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Total Tax"] || 0
                    }))
                });

                // --- D. DEFERRED TAX (Input) ---
                if (deferredTaxRow) {
                    taxGroup.rows.push(deferredTaxRow);
                }

                // --- E. PRIOR YEAR ADJUSTMENT (Input) ---
                if (priorYearAdjRow) {
                    taxGroup.rows.push(priorYearAdjRow);
                }

                // --- F. PROFIT AFTER TAX (Calculated) ---
                // PAT = PBT - Tax - Deferred Tax - Prior Year Adj
                taxGroup.rows.push({
                    id: 'calc-pat',
                    name: 'Profit After Tax (PAT)',
                    is_calculated: true,
                    is_total_row: true,
                    data: yearSettings.map(year => {
                        const rawPAT = results[year.id]?.["Profit After Tax (PAT)"] || 0; // This is PBT - Current Tax

                        // Get Input Values safely
                        const deferredTaxVal = deferredTaxRow?.data.find(d => d.year_setting === year.id)?.value || 0;
                        const priorAdjVal = priorYearAdjRow?.data.find(d => d.year_setting === year.id)?.value || 0;

                        // Final PAT
                        return {
                            year_setting: year.id,
                            value: rawPAT - parseFloat(deferredTaxVal) - parseFloat(priorAdjVal)
                        };
                    })
                });

                // --- G. DIVIDENDS (Input) ---
                if (dividendPaidRow) {
                    taxGroup.rows.push(dividendPaidRow);
                }
                if (dividendTaxRow) {
                    taxGroup.rows.push(dividendTaxRow);
                }

                // --- H. RETAINED PROFIT ---
                taxGroup.rows.push({
                    id: 'calc-retained-profit',
                    name: 'Retained Profit',
                    is_calculated: true,
                    is_total_row: true,
                    data: yearSettings.map(year => {
                        const rawPAT = results[year.id]?.["Profit After Tax (PAT)"] || 0;
                        const deferredTaxVal = deferredTaxRow?.data.find(d => d.year_setting === year.id)?.value || 0;
                        const priorAdjVal = priorYearAdjRow?.data.find(d => d.year_setting === year.id)?.value || 0;

                        const finalPAT = rawPAT - parseFloat(deferredTaxVal) - parseFloat(priorAdjVal);

                        const divPaid = dividendPaidRow?.data.find(d => d.year_setting === year.id)?.value || 0;
                        const divTax = dividendTaxRow?.data.find(d => d.year_setting === year.id)?.value || 0;

                        return {
                            year_setting: year.id,
                            value: finalPAT - parseFloat(divPaid) - parseFloat(divTax)
                        };
                    })
                });
            }
        }

        // 1. ASSET PAGE: Inject Net Block
        if (pageType === 'asset') {
            // Calculate everything first to get Operating Statement values
            // Results are already calculated above
            // const results = calculateAll(filteredGroups, yearSettings, currentReport?.sector, currentReport?.tax_regime || 'domestic_22', getAllLoanSummaries(), undefined, currentReport, projectCosts, [], drawingsData);

            // Find Gross Block row
            let targetGroupIndex = -1;
            let targetRowIndex = -1;

            displayGroups.forEach((group, gIdx) => {
                group.rows.forEach((row, rIdx) => {
                    const name = row.name.trim();
                    const lowerName = name.toLowerCase();

                    // --- FIX: Hide unwanted rows explicitly ---
                    // 1. Accumulated Depreciation (User request)
                    if (lowerName.includes('accumulated') || lowerName.includes('accum') || (lowerName.includes('depreciation') && lowerName.includes('accumulated'))) {
                        row.is_hidden = true;
                    }
                    // 2. Hide existing Depreciation/Net Block to prevent duplicates (since we inject new ones)
                    // But DO NOT hide "Gross Block"
                    if ((lowerName === 'depreciation' || lowerName === 'net block') && !lowerName.includes('gross')) {
                        row.is_hidden = true;
                    }

                    // 1. Handle Gross Block (Read-only)
                    if (lowerName.includes('gross block')) {
                        targetGroupIndex = gIdx;
                        targetRowIndex = rIdx;
                        row.is_calculated = true;
                        // Update data to show calculated Opening WDV for each year
                        // Try both keys: "Gross block" (from my fix) and "Gross Block" (fallback)
                        row.data = yearSettings.map(year => {
                            const val = results[year.id]?.["Gross block"] !== undefined
                                ? results[year.id]["Gross block"]
                                : results[year.id]?.["Gross Block"] || 0;
                            return { year_setting: year.id, value: val };
                        });
                    }

                    // 2. Auto-populate Inventory Heads from Operating Statement (Closing Stock)
                    // These values flow from the P&L Closing Stock rows and should be READ-ONLY

                    // Helper function to get closing stock value from Operating Statement
                    const getClosingStockValue = (yearId, stockType) => {
                        // First try results object
                        if (results[yearId]?.[stockType] !== undefined && results[yearId][stockType] !== 0) {
                            return results[yearId][stockType];
                        }

                        // Fallback: Directly read from operating groups (COGS section)
                        const cogsGroup = operatingGroups.find(g =>
                            g.name.toLowerCase().includes('cost of goods sold') ||
                            g.name.toLowerCase().includes('cogs')
                        );

                        if (cogsGroup) {
                            let targetRowName = '';
                            if (stockType === 'Raw materials Domestic') {
                                targetRowName = 'closing stock (raw materials)';
                            } else if (stockType === 'Stock in process') {
                                targetRowName = 'closing stock (work-in-process)';
                            } else if (stockType === 'Finished goods') {
                                targetRowName = 'closing stock (finished goods)';
                            }

                            const stockRow = cogsGroup.rows.find(r =>
                                r.name.toLowerCase().includes(targetRowName) ||
                                r.name.toLowerCase() === targetRowName
                            );

                            if (stockRow) {
                                const dp = stockRow.data?.find(d => d.year_setting === yearId);
                                return parseFloat(dp?.value || 0);
                            }
                        }
                        return 0;
                    };

                    // Raw materials Domestic -> Closing Stock (Raw Materials)
                    if (lowerName.includes('raw material') && lowerName.includes('domestic')) {
                        row.is_calculated = true;
                        row.is_closing_stock_linked = true; // Custom flag for UI indicator
                        row.data = yearSettings.map(year => ({
                            year_setting: year.id,
                            value: getClosingStockValue(year.id, 'Raw materials Domestic')
                        }));
                    }
                    // Stock in process -> Closing Stock (Work-in-Process)
                    // IMPORTANT: Exclude "Capital WIP" which should NOT be linked to P&L closing stock
                    else if ((lowerName.includes('stock in process') || lowerName === 'work in process' ||
                        (lowerName.includes('wip') && !lowerName.includes('capital'))) &&
                        !lowerName.includes('capital')) {
                        row.is_calculated = true;
                        row.is_closing_stock_linked = true;
                        row.data = yearSettings.map(year => ({
                            year_setting: year.id,
                            value: getClosingStockValue(year.id, 'Stock in process')
                        }));
                    }
                    // Finished goods -> Closing Stock (Finished Goods)
                    else if (lowerName.includes('finished good')) {
                        row.is_calculated = true;
                        row.is_closing_stock_linked = true;
                        row.data = yearSettings.map(year => ({
                            year_setting: year.id,
                            value: getClosingStockValue(year.id, 'Finished goods')
                        }));
                    }
                });
            });

            if (targetGroupIndex !== -1) {
                // Create Depreciation Row
                const depreciationRow = {
                    id: 'calc-depr-asset',
                    name: 'Depreciation',
                    is_calculated: true,
                    is_total_row: false,
                    data: yearSettings.map(year => ({
                        year_setting: year.id,
                        value: results[year.id]?.["Depreciation"] || 0
                    }))
                };

                // Create Net Block Row
                const netBlockData = yearSettings.map(year => {
                    const grossBlock = results[year.id]?.["Gross block"] || 0;
                    const depreciation = results[year.id]?.["Depreciation"] || 0;
                    return {
                        year_setting: year.id,
                        value: grossBlock - depreciation
                    };
                });

                const netBlockRow = {
                    id: 'calc-net-block',
                    name: 'Net Block',
                    is_calculated: true,
                    is_total_row: true,
                    data: netBlockData
                };

                // Inject after Gross Block: 
                // 1. Depreciation
                // 2. Net Block
                displayGroups[targetGroupIndex].rows.splice(targetRowIndex + 1, 0, depreciationRow);
                displayGroups[targetGroupIndex].rows.splice(targetRowIndex + 2, 0, netBlockRow);

                // 3. Update/Inject Total Fixed Assets row to include Net Block + ALL other fixed asset rows
                // Find existing Total Fixed Assets row and dynamically sum all non-depreciation, non-total rows in the same group
                displayGroups.forEach((group, gIdx) => {
                    let totalFixedAssetsRowIndex = -1;

                    group.rows.forEach((row, rIdx) => {
                        if (row.name.toLowerCase().trim() === 'total fixed assets') {
                            totalFixedAssetsRowIndex = rIdx;
                        }
                    });

                    if (totalFixedAssetsRowIndex !== -1) {
                        // Calculate Total Fixed Assets by summing ALL rows in this group
                        // Exclude: Depreciation (it's a deduction, already reflected in Net Block), Gross Block (Net Block replaces it), and the total row itself
                        const excludedRowNames = ['total fixed assets', 'depreciation', 'gross block'];

                        displayGroups[gIdx].rows[totalFixedAssetsRowIndex].is_calculated = true;
                        displayGroups[gIdx].rows[totalFixedAssetsRowIndex].is_total_row = true;
                        displayGroups[gIdx].rows[totalFixedAssetsRowIndex].data = yearSettings.map(year => {
                            let total = 0;

                            // Sum all rows in this group (Fixed Assets)
                            group.rows.forEach(r => {
                                const lowerName = r.name.toLowerCase().trim();
                                // Skip excluded rows and the total row itself
                                if (excludedRowNames.includes(lowerName)) return;
                                if (r.is_total_row && r.id === displayGroups[gIdx].rows[totalFixedAssetsRowIndex].id) return;

                                // Get value from row data (for user-input rows like Capital WIP, Intangible Assets)
                                const dp = r.data?.find(d => d.year_setting === year.id);
                                const val = parseFloat(dp?.value || 0);
                                total += isNaN(val) ? 0 : val;
                            });

                            return { year_setting: year.id, value: total };
                        });
                    }
                });
            }
        }

        // 3. LIABILITY PAGE: Inject/Update Term Loans

        if (pageType === 'liability' || pageType === 'liabilities') {

            try {
                // 1. Calculate everything
                // 1. Calculate everything
                // SMART FILTER: Move Depreciation/Office Equipment to a separate group
                const allGroups = [...operatingGroups, ...assetGroups, ...liabilityGroups];
                const excludedRows = [];
                const filteredGroups = allGroups.map(g => ({
                    ...g,
                    rows: g.rows.filter(r => {
                        const n = r.name.toLowerCase();
                        const shouldExclude = n.includes('office equipment') || n.includes('depreciation');
                        if (shouldExclude) excludedRows.push(r);
                        return !shouldExclude;
                    })
                }));
                filteredGroups.push({ name: "Excluded Items", rows: excludedRows });
                const results = calculateAll(filteredGroups, yearSettings, currentReport?.sector, currentReport?.tax_regime || 'domestic_22', getAllLoanSummaries(), undefined, currentReport, projectCosts, existingWCLoans);


                if (yearSettings.length > 0) {

                }



                // 2. Generic Update (Same as above, for Liability rows)
                // IMPORTANT: Only UPDATE DATA for rows that have matching calculated values,
                // but DON'T mark user-input rows as is_calculated (which makes them read-only)
                displayGroups.forEach(group => {
                    group.rows.forEach(row => {
                        const firstYearId = yearSettings[0]?.id;
                        // Check exact name match or specific aliases
                        const cleanName = row.name.trim();
                        const lowerName = cleanName.toLowerCase();

                        // Find matching key (Case Insensitive)
                        let matchKey = undefined;
                        if (results[firstYearId]) {
                            if (results[firstYearId][row.name] !== undefined) matchKey = row.name;
                            else if (results[firstYearId][cleanName] !== undefined) matchKey = cleanName;
                            else {
                                // Try case-insensitive scan
                                const keys = Object.keys(results[firstYearId]);
                                matchKey = keys.find(k => k.toLowerCase() === cleanName.toLowerCase());
                            }
                        }

                        if (matchKey) {
                            // Determine if this row should be READ-ONLY (is_calculated)
                            // Only mark as calculated if:
                            // 1. Row is a TOTAL row (name contains 'total')
                            // 2. Row is already marked as is_calculated from DB
                            // 3. Row is a system-injected row (id starts with 'calc-')
                            // 4. Row is "Provision for Taxes" (auto-calculated from Tax Total)
                            const isSystemCalculated =
                                row.is_calculated === true ||  // Already calculated from DB
                                row.is_total_row === true ||   // Total rows
                                String(row.id).startsWith('calc-') || // Injected rows
                                lowerName.includes('total') || // Total rows by name
                                lowerName.includes('term loan') && lowerName.includes('excluding') || // Term loan balance
                                lowerName === 'provision for taxes' || // Tax provision (from P&L)
                                lowerName.includes('provision for tax'); // Alternative naming

                            // Only mark as calculated if truly system-calculated
                            if (isSystemCalculated) {
                                row.is_calculated = true;

                                // Special handling for Provision for Taxes - use Total Tax from P&L
                                if (lowerName === 'provision for taxes' || lowerName.includes('provision for tax')) {
                                    row.is_tax_linked = true; // Custom flag for UI indicator
                                    row.data = yearSettings.map(year => ({
                                        year_setting: year.id,
                                        value: results[year.id]?.["Total Tax"] || results[year.id]?.["Provision for Taxes"] || 0
                                    }));
                                } else {
                                    // Update data for other calculated rows
                                    row.data = yearSettings.map(year => ({
                                        year_setting: year.id,
                                        value: results[year.id][matchKey] || 0
                                    }));
                                }
                            }
                            // For user-input rows: DON'T mark as calculated, DON'T override data
                            // The user's input should be preserved and used in calculations
                        }
                    });
                });

                // 3. INJECT WC LIABILITY ROWS
                // Find "Current Liabilities" group
                const curLiabGroupIndex = displayGroups.findIndex(g => g.name.toLowerCase().includes('current liabilities'));

                if (curLiabGroupIndex !== -1) {
                    // 1. Existing WC Loans (Dynamic List)
                    if (existingWCLoans && existingWCLoans.length > 0) {
                        existingWCLoans.forEach(loan => {
                            const rowName = `${loan.bank_name} WC Limit`;
                            // Check if already exists to avoid duplicates
                            if (!displayGroups[curLiabGroupIndex].rows.some(r => r.name === rowName)) {
                                const newRow = {
                                    id: `calc-wc-liab-${loan.id}`,
                                    name: rowName,
                                    is_calculated: true,
                                    is_total_row: false,
                                    data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.[rowName] || 0 }))
                                };
                                displayGroups[curLiabGroupIndex].rows.unshift(newRow);
                            }
                        });
                    }
                }

                // 3. INJECT WC LIMIT ROWS INTO "WC BORROWINGS" GROUP (or fallback to Current Liabilities)
                const wcBorrowingsGroupIndex = displayGroups.findIndex(g =>
                    g.name.toLowerCase().includes('wc borrowings') ||
                    g.name.toLowerCase().includes('working capital borrowings')
                );
                const wcTargetGroupIndex = wcBorrowingsGroupIndex !== -1 ? wcBorrowingsGroupIndex : curLiabGroupIndex;

                if (wcTargetGroupIndex !== -1) {
                    // Existing WC Limit (Enhancement Mode fallback)
                    if (currentReport?.wc_requirement_type === 'enhancement' && (!existingWCLoans || existingWCLoans.length === 0)) {
                        const wcLiabExistingRow = {
                            id: 'calc-wc-liab-existing',
                            name: 'Existing Working Capital Limit',
                            is_calculated: true,
                            is_total_row: false,
                            data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Existing Working Capital Limit"] || 0 }))
                        };
                        displayGroups[wcTargetGroupIndex].rows.unshift(wcLiabExistingRow);
                    }

                    // Proposed WC Loan
                    if (currentReport?.new_loan_type === 'wc' || currentReport?.new_loan_type === 'both') {
                        const wcLiabProposedRow = {
                            id: 'calc-wc-liab-proposed',
                            name: 'Proposed Working Capital Limit',
                            is_calculated: true,
                            is_total_row: false,
                            data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Proposed Working Capital Limit"] || 0 }))
                        };
                        displayGroups[wcTargetGroupIndex].rows.unshift(wcLiabProposedRow);
                    }
                }

                // 4. INJECT TERM LIABILITY ROWS (Individual Loans)
                const termLiabGroupIndex = displayGroups.findIndex(g => g.name.toLowerCase().includes('term liabilities'));

                if (termLiabGroupIndex !== -1) {
                    // Existing Term Loans
                    if (existingLoans && existingLoans.length > 0) {
                        existingLoans.forEach(loan => {
                            const rowName = `${loan.loan_name} (Closing Balance)`;
                            // Check if already exists
                            if (!displayGroups[termLiabGroupIndex].rows.some(r => r.name === rowName)) {
                                const newRow = {
                                    id: `calc-term-liab-${loan.id}`,
                                    name: rowName,
                                    is_calculated: true,
                                    is_total_row: false,
                                    data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.[rowName] || 0 }))
                                };
                                displayGroups[termLiabGroupIndex].rows.unshift(newRow);
                            }
                        });
                    }

                    // New Term Loan
                    if (loanScheduleData && currentReport?.new_loan_type !== 'wc') {
                        const newLoanName = 'New Term Loan';
                        const rowName = `${newLoanName} (Closing Balance)`;
                        if (!displayGroups[termLiabGroupIndex].rows.some(r => r.name === rowName)) {
                            const newRow = {
                                id: 'calc-term-liab-new',
                                name: rowName,
                                is_calculated: true,
                                is_total_row: false,
                                data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.[rowName] || 0 }))
                            };
                            displayGroups[termLiabGroupIndex].rows.unshift(newRow);
                        }
                    }
                }

                // 3. Inject Total Net Worth Row
                // Find the group containing "Reserves" or "Share Capital"
                let reservesGroupIndex = displayGroups.findIndex(g => g.name.toLowerCase().includes('reserve') || g.name.toLowerCase().includes('share capital') || g.name.toLowerCase().includes('net worth'));

                if (reservesGroupIndex !== -1) {
                    // --- LLP/PROPRIETORSHIP: Inject Capital and Drawings rows ---
                    const isLlpOrProprietorship = currentReport?.tax_regime === 'llp' || currentReport?.tax_regime === 'proprietorship';

                    if (isLlpOrProprietorship) {
                        // a. Replace "Ordinary share capital" with "Capital" behavior
                        // Find and rename or inject Capital row
                        const shareCapitalIdx = displayGroups[reservesGroupIndex].rows.findIndex(
                            r => r.name.toLowerCase().includes('ordinary share capital') ||
                                r.name.toLowerCase() === 'share capital' ||
                                r.name.toLowerCase() === 'capital'
                        );

                        if (shareCapitalIdx !== -1) {
                            // Rename existing row and enforce waterfall logic
                            const existingRow = displayGroups[reservesGroupIndex].rows[shareCapitalIdx];
                            existingRow.name = 'Capital';
                            existingRow.is_capital_waterfall = true; // Enforce custom rendering

                            // Override data for Year 2+ to be calculated
                            // CRITICAL: Use operating waterfall (Prev Capital + PAT - Drawings)
                            // NOT full Net Worth (to avoid double-counting Share Premium)
                            existingRow.data = yearSettings.map((y, idx) => {
                                if (idx === 0) {
                                    // First year: use existing value (user input)
                                    const existingVal = existingRow.data.find(d => d.year_setting === y.id)?.value || 0;
                                    return { year_setting: y.id, value: existingVal };
                                } else {
                                    // Subsequent years: Previous Capital + PAT - Drawings
                                    const prevYearId = yearSettings[idx - 1].id;
                                    const prevCapital = results[prevYearId]?.['Capital'] || 0;
                                    const prevPAT = results[prevYearId]?.['General Reserve (PAT)'] || results[prevYearId]?.['Profit After Tax (PAT)'] || 0;
                                    const prevDrawings = results[prevYearId]?.['Drawings'] || 0;
                                    return { year_setting: y.id, value: prevCapital + prevPAT - prevDrawings };
                                }
                            });
                        } else {
                            // Inject Capital row at the top
                            const capitalRow = {
                                id: 'calc-capital',
                                name: 'Capital',
                                is_calculated: false, // Year 1 is editable
                                is_total_row: false,
                                is_capital_waterfall: true, // Custom flag for cell rendering
                                data: yearSettings.map((y, idx) => {
                                    if (idx === 0) {
                                        // First year: look for user input
                                        return { year_setting: y.id, value: results[y.id]?.['Capital'] || 0 };
                                    } else {
                                        // Subsequent years: Previous Capital + PAT - Drawings (operating waterfall)
                                        const prevYearId = yearSettings[idx - 1].id;
                                        const prevCapital = results[prevYearId]?.['Capital'] || 0;
                                        const prevPAT = results[prevYearId]?.['General Reserve (PAT)'] || results[prevYearId]?.['Profit After Tax (PAT)'] || 0;
                                        const prevDrawings = results[prevYearId]?.['Drawings'] || 0;
                                        return { year_setting: y.id, value: prevCapital + prevPAT - prevDrawings };
                                    }
                                })
                            };
                            displayGroups[reservesGroupIndex].rows.unshift(capitalRow);
                        }

                        // NOTE: Removed automatic injection of "Share premium", "Revaluation Reserves", "Other reserve"
                        // These were causing duplicate rows (if already exist in Reserves & Surplus group)
                        // and 404 errors on projection (fake calc-* IDs don't exist in DB)
                        // Users can add these rows via "Manage Items" → "Add Row" if needed

                        // b. Handle Drawings Row (Deduplicate & Ensure Editable)
                        const drawingsRows = displayGroups[reservesGroupIndex].rows.filter(r => r.name === 'Drawings');

                        if (drawingsRows.length > 0) {
                            // If duplicates exist, keep the first one and remove others
                            if (drawingsRows.length > 1) {
                                const keepId = drawingsRows[0].id;
                                displayGroups[reservesGroupIndex].rows = displayGroups[reservesGroupIndex].rows.filter(r => r.name !== 'Drawings' || r.id === keepId);
                            }

                            // Ensure the remaining row is editable
                            const drawingsRow = displayGroups[reservesGroupIndex].rows.find(r => r.name === 'Drawings');
                            if (drawingsRow) {
                                drawingsRow.is_calculated = false;
                            }
                        } else {
                            // Inject if missing
                            const drawingsRow = {
                                id: 'calc-drawings-standard', // Temporary ID until saved
                                name: 'Drawings',
                                is_calculated: false, // Editable
                                is_total_row: false,
                                data: yearSettings.map(y => ({ year_setting: y.id, value: results[y.id]?.["Drawings"] || 0 }))
                            };

                            // Insert after Capital
                            const capitalIdx = displayGroups[reservesGroupIndex].rows.findIndex(r => r.name === 'Capital');
                            if (capitalIdx !== -1) {
                                displayGroups[reservesGroupIndex].rows.splice(capitalIdx + 1, 0, drawingsRow);
                            } else {
                                displayGroups[reservesGroupIndex].rows.push(drawingsRow);
                            }
                        }

                        // c. Inject or Update "General Reserve (PAT)" row
                        const generalReserveIdx = displayGroups[reservesGroupIndex].rows.findIndex(r => r.name === 'General Reserve (PAT)');
                        const patData = yearSettings.map(y => ({
                            year_setting: y.id,
                            value: results[y.id]?.['Profit After Tax (PAT)'] || results[y.id]?.['PAT'] || 0
                        }));

                        if (generalReserveIdx !== -1) {
                            // Update existing row
                            displayGroups[reservesGroupIndex].rows[generalReserveIdx].is_calculated = true;
                            displayGroups[reservesGroupIndex].rows[generalReserveIdx].data = patData;
                        } else {
                            // Create new row
                            const generalReserveRow = {
                                id: 'calc-general-reserve-pat',
                                name: 'General Reserve (PAT)',
                                is_calculated: true,
                                is_total_row: false,
                                data: patData
                            };
                            // Insert after Drawings
                            const drawingsIdx = displayGroups[reservesGroupIndex].rows.findIndex(r => r.name === 'Drawings');
                            if (drawingsIdx !== -1) {
                                displayGroups[reservesGroupIndex].rows.splice(drawingsIdx + 1, 0, generalReserveRow);
                            } else {
                                displayGroups[reservesGroupIndex].rows.push(generalReserveRow);
                            }
                        }

                        // d. Hide input "General Reserve" row
                        const inputGenResIdx = displayGroups[reservesGroupIndex].rows.findIndex(r => r.name === 'General reserve' || r.name === 'General Reserve');
                        if (inputGenResIdx !== -1) {
                            // We can't easily remove it if it's from DB, but we can filter it out or mark it hidden
                            // Better to remove it from the display array
                            displayGroups[reservesGroupIndex].rows.splice(inputGenResIdx, 1);
                        }

                        // e. Hide "Total Capital" row for LLP/Proprietorship
                        // This is redundant - the proper total is "Total Net Worth"
                        const totalCapitalIdx = displayGroups[reservesGroupIndex].rows.findIndex(r => r.name === 'Total Capital');
                        if (totalCapitalIdx !== -1) {
                            displayGroups[reservesGroupIndex].rows.splice(totalCapitalIdx, 1);
                        }
                    }

                    // Check if Total Net Worth already exists
                    const netWorthExists = displayGroups[reservesGroupIndex].rows.some(r => r.name === 'Total Net Worth');

                    if (!netWorthExists) {
                        const netWorthRow = {
                            id: 'calc-total-net-worth',
                            name: 'Total Net Worth',
                            is_calculated: true,
                            is_total_row: true, // Bold
                            data: yearSettings.map(y => ({
                                year_setting: y.id,
                                value: results[y.id]?.["Net Worth"] || 0
                            }))
                        };
                        // Append to the end of this group
                        displayGroups[reservesGroupIndex].rows.push(netWorthRow);
                    }
                }

                // Inject Total Liabilities if needed (usually handled by generic update if row exists)
            } catch (error) {
                console.error("❌ [LIABILITY CALCULATION ERROR]", error);
            }
        }

        return displayGroups;
    }, [operatingGroups, assetGroups, liabilityGroups, yearSettings, currentReport, projectCosts, existingLoans, loanScheduleData, existingWCLoans]);

    const ensureDrawingsRowExists = async () => {
        // Find Net Worth group (or Capital & Net Worth for LLP)
        const netWorthGroup = liabilityGroups.find(g =>
            g.name.toLowerCase().includes('net worth') ||
            g.name.toLowerCase().includes('capital')
        );
        if (!netWorthGroup) {
            console.error("Net Worth / Capital group not found");
            return null;
        }

        try {
            // Check if it already exists (race condition check)
            const existingRow = netWorthGroup.rows.find(r => r.name === 'Drawings');
            if (existingRow) return existingRow.id;

            // Create row
            const newRow = await apiClient.createRow({
                group: netWorthGroup.id,
                name: 'Drawings',
                display_order: 15
            });
            return newRow.id;
        } catch (error) {
            console.error("Error creating Drawings row:", error);
            return null;
        }
    };

    const handleSaveCell = async (rowId, yearId, val) => {
        let finalRowId = rowId;

        // Handle creation of Drawings row if it's the temporary one
        if (rowId === 'calc-drawings-standard') {
            const newId = await ensureDrawingsRowExists();
            if (newId) {
                finalRowId = newId;
            } else {
                return; // Failed to create
            }
        }

        try {
            // Standard save
            await apiClient.saveCell({
                report_id: currentReport.id,
                row_id: finalRowId,
                year_setting_id: yearId,
                value: val
            });

            // We MUST reload to update totals across the app (e.g. Net Profit depends on Sales)
            await reloadFinancialData(currentReport.id);
            await fetchLoanData();

        } catch (error) {
            console.error("Error saving cell:", error);
        }
    };

    const handleAutoProjection = async (row, baseYearIndex, baseValue) => {
        const defaultGrowthRate = 10; // 10% default growth
        const futureYears = yearSettings.slice(baseYearIndex + 1);

        let currentValue = baseValue;
        let finalRowId = row.id;

        if (row.id === 'calc-drawings-standard') {
            const newId = await ensureDrawingsRowExists();
            if (newId) finalRowId = newId;
            else return;
        }

        const cells = futureYears.map(year => {
            currentValue = currentValue * (1 + defaultGrowthRate / 100);
            return {
                row_id: finalRowId,
                year_setting_id: year.id,
                value: Math.round(currentValue * 100) / 100
            };
        });

        if (cells.length > 0) {
            try {
                await apiClient.saveMultipleCells({
                    report_id: currentReport.id,
                    cells: cells
                });
            } catch (e) {
                console.error(e);
            }
        }
        await reloadFinancialData(currentReport.id);
    };

    const handleProjection = async (rowId, baseYear, baseValue, pct) => {
        let finalRowId = rowId;
        if (rowId === 'calc-drawings-standard') {
            const newId = await ensureDrawingsRowExists();
            if (newId) finalRowId = newId;
            else return;
        }

        // Standard projection
        await apiClient.runProjection(finalRowId, { base_year: baseYear, base_value: baseValue, percentage: pct });
        await reloadFinancialData(currentReport.id);
    };

    const handleSmartProject = async (rowId, percentage, baseRowName) => {
        // 1. Calculate latest results to get "Total Revenue" and other aggregates
        const allGroups = [...operatingGroups, ...assetGroups, ...liabilityGroups];

        // Filter excluded rows logic (same as in useMemo) to ensure consistency
        const excludedRows = [];
        const filteredGroups = allGroups.map(g => ({
            ...g,
            rows: g.rows.filter(r => {
                const n = r.name.toLowerCase();
                const shouldExclude = n.includes('office equipment') || n.includes('depreciation');
                if (shouldExclude) excludedRows.push(r);
                return !shouldExclude;
            })
        }));
        filteredGroups.push({ name: "Excluded Items", rows: excludedRows });
        const results = calculateAll(filteredGroups, yearSettings, currentReport?.sector, currentReport?.tax_regime || 'domestic_22', getAllLoanSummaries(), undefined, currentReport, projectCosts, existingWCLoans);

        // 2. Iterate and Prepare Batch
        const cells = [];
        for (const year of yearSettings) {
            let baseVal = 0;

            if (baseRowName === "Total Revenue" || baseRowName === "Total Sales") {
                baseVal = results[year.id]["Total Revenue"] || 0;
            } else {
                let foundRow = null;
                for (const g of allGroups) {
                    foundRow = g.rows.find(r => r.name.trim().toLowerCase() === baseRowName.trim().toLowerCase());
                    if (foundRow) break;
                    if (!foundRow) {
                        foundRow = g.rows.find(r => r.name.toLowerCase().includes(baseRowName.toLowerCase()));
                        if (foundRow) break;
                    }
                }

                if (foundRow) {
                    const dp = foundRow.data.find(d => d.year_setting === year.id);
                    baseVal = parseFloat(dp?.value || 0);
                } else if (results[year.id][baseRowName] !== undefined) {
                    baseVal = results[year.id][baseRowName];
                }
            }

            const newVal = (baseVal * percentage) / 100;
            cells.push({
                row_id: rowId,
                year_setting_id: year.id,
                value: Math.round(newVal * 100) / 100
            });
        }

        if (cells.length > 0) {
            try {
                await apiClient.saveMultipleCells({
                    report_id: currentReport.id,
                    cells: cells
                });
            } catch (e) {
                console.error(e);
            }
        }
        await reloadFinancialData(currentReport.id);
    };

    if (!yearSettings || yearSettings.length === 0) return <FullScreenLoader text="Initializing Grid..." />;

    return (
        <div className="max-w-[95vw] mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
                <div className="flex items-center space-x-4">
                    {formulaState.active && (
                        <div className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded text-sm font-bold animate-pulse">
                            Formula Mode Active: Select cells to add values
                        </div>
                    )}
                    {currentReport?.wc_requirement_type === 'enhancement' && (
                        <button
                            onClick={() => setIsWCModalOpen(true)}
                            className="text-sm text-blue-600 hover:underline bg-blue-50 px-3 py-1 rounded"
                        >
                            Manage Existing WC
                        </button>
                    )}
                    <button onClick={() => navigate(`/project-report/${currentReport.id}/manage-items?from=${pageType}`)} className="text-sm text-blue-600 hover:underline">+ Manage Items / Hide Rows</button>
                </div >
            </div >

            {/* Formula Bar */}
            {
                formulaState.active && (
                    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl p-4 z-50 flex items-center justify-center space-x-4">
                        <span className="font-bold text-gray-700">Formula:</span>
                        <input
                            type="text"
                            className="border border-gray-300 rounded px-3 py-2 w-1/2 font-mono text-lg"
                            value={formulaState.expression}
                            onChange={(e) => handleFormulaInput(e.target.value)}
                            placeholder="Select cells or type (e.g. 100 + 200)"
                            autoFocus
                        />
                        <div className="flex space-x-2">
                            <button onClick={() => appendToFormula('+')} className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 font-bold">+</button>
                            <button onClick={() => appendToFormula('-')} className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 font-bold">-</button>
                            <button onClick={() => appendToFormula('*')} className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 font-bold">*</button>
                            <button onClick={() => appendToFormula('/')} className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 font-bold">/</button>
                        </div>
                        <div className="border-l pl-4 flex space-x-2">
                            <button onClick={applyFormula} className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-bold">Apply (=)</button>
                            <button onClick={cancelFormulaMode} className="bg-red-100 text-red-600 px-4 py-2 rounded hover:bg-red-200">Cancel</button>
                        </div>
                    </div>
                )
            }

            <div className={`overflow-x-auto shadow border border-gray-300 rounded-lg bg-white ${formulaState.active ? 'mb-24' : ''}`}>
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="sticky left-0 z-20 bg-gray-50 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-64 border-r">Particulars</th>
                            <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase w-32 border-r">Action</th>
                            {yearSettings.map(y => (
                                <th key={y.id} className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase min-w-[100px] border-r">
                                    {y.year_display}<br /><span className="text-[10px] text-gray-400">{y.year_type}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {processedData.map(group => (
                            <React.Fragment key={group.id}>
                                <tr className="bg-gray-100">
                                    <td colSpan={yearSettings.length + 2} className="sticky left-0 z-10 bg-gray-100 px-4 py-2 text-sm font-bold text-gray-800">{group.name}</td>
                                </tr>
                                {group.rows.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50 group">
                                        <td className={`sticky left-0 z-10 bg-white px-2 py-2 text-sm border-r ${row.is_total_row ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                                            <div className="flex items-center gap-2">
                                                {row.name}
                                                {row.is_closing_stock_linked && (
                                                    <span
                                                        className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold"
                                                        title="Value flows from Operating Statement Closing Stock"
                                                    >
                                                        P&L
                                                    </span>
                                                )}
                                                {row.is_tax_linked && (
                                                    <span
                                                        className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold"
                                                        title="Value flows from Operating Statement Tax Calculation"
                                                    >
                                                        TAX
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-2 py-1 text-center border-r">
                                            {row.name === 'Gross block' ? (
                                                <button
                                                    onClick={() => setIsAssetModalOpen(true)}
                                                    className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                                                >
                                                    Manage
                                                </button>
                                            ) : (
                                                // Don't show projection tools for rows with fake calc-* IDs (they don't exist in DB)
                                                (String(row.id).startsWith('calc-')) ? null :
                                                    ((!row.is_calculated && !row.is_total_row && !row.is_capital_waterfall &&
                                                        !row.name.toLowerCase().includes('opening stock') &&
                                                        !row.name.toLowerCase().includes('closing stock') &&
                                                        row.name !== 'General reserve') ||
                                                        ["Share premium", "Revaluation Reserves", "Other reserve", "Drawings"].includes(row.name)) && (
                                                        // Smart Projection Logic
                                                        row.name === 'Receivables' ? (
                                                            <SmartProjectionTool
                                                                row={row}
                                                                label="Sales"
                                                                onRun={(id, pct) => handleSmartProject(id, pct, "Total Revenue")}
                                                            />
                                                        ) : row.name.toLowerCase().includes('sundry creditors') ? (
                                                            <SmartProjectionTool
                                                                row={row}
                                                                label="Purchases"
                                                                onRun={(id, pct) => handleSmartProject(id, pct, "Purchases (Raw Materials)")}
                                                            />
                                                        ) : (
                                                            <ProjectionTool row={row} years={yearSettings} onRun={handleProjection} />
                                                        )
                                                    )
                                            )}
                                        </td>
                                        {yearSettings.map(year => {
                                            // Find the data point for this year
                                            const dp = row.data.find(d => d.year_setting === year.id);
                                            const val = dp ? dp.value : 0;

                                            // Check if this is an opening stock row from second year onwards
                                            const isOpeningStock = row.name.includes('Opening Stock') || row.name.includes('Opening Inventory');
                                            const yearIndex = yearSettings.findIndex(y => y.id === year.id);
                                            const isBlockedOpeningStock = isOpeningStock && yearIndex > 0; // Block from 2nd year onwards, allow 1st year

                                            // Check if this is General Reserve from second year onwards
                                            const isGeneralReserve = row.name === 'General reserve';
                                            const isBlockedGeneralReserve = isGeneralReserve && yearIndex > 0; // Block from 2nd year onwards, allow 1st year

                                            // Special handling for Drawings row (clickable to open modal)
                                            if (row.is_clickable_drawings) {
                                                const drawingCount = (drawingsData || []).filter(d => d.year_setting === year.id).length;
                                                return (
                                                    <td
                                                        key={year.id}
                                                        className="p-0 border-r bg-purple-50 cursor-pointer hover:bg-purple-100 transition-colors"
                                                        onClick={() => setIsDrawingsModalOpen(true)}
                                                    >
                                                        <div className="w-full h-full p-2 text-right text-sm font-semibold text-purple-800 flex items-center justify-end gap-2">
                                                            {drawingCount > 0 && (
                                                                <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                                                                    {drawingCount}
                                                                </span>
                                                            )}
                                                            {parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            // Special handling for Capital waterfall row (Year 1 editable, others read-only)
                                            if (row.is_capital_waterfall) {
                                                if (yearIndex === 0) {
                                                    // First year is editable
                                                    return (
                                                        <DataCell
                                                            key={year.id}
                                                            rowId={row.id}
                                                            yearId={year.id}
                                                            initialValue={val}
                                                            row={row}
                                                            yearSettings={yearSettings}
                                                            onSave={handleSaveCell}
                                                            onAutoProject={handleAutoProjection}
                                                            formulaState={formulaState}
                                                            onStartFormula={startFormulaMode}
                                                            onAppendToFormula={appendToFormula}
                                                        />
                                                    );
                                                } else {
                                                    // Subsequent years show previous year's Net Worth (read-only)
                                                    return (
                                                        <td key={year.id} className="p-0 border-r bg-green-50">
                                                            <div className="w-full h-full p-2 text-right text-sm font-bold text-green-800" title="Auto-filled from previous year Net Worth">
                                                                {parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                            }

                                            if ((row.is_calculated || row.is_total_row || isBlockedOpeningStock || isBlockedGeneralReserve) &&
                                                !["Share premium", "Revaluation Reserves", "Other reserve"].includes(row.name)) {
                                                // Determine cell styling based on row type
                                                const isClosingStockLinked = row.is_closing_stock_linked;
                                                const isTaxLinked = row.is_tax_linked;

                                                const bgColor = isClosingStockLinked
                                                    ? 'bg-amber-50'
                                                    : isTaxLinked
                                                        ? 'bg-purple-50'
                                                        : (isBlockedOpeningStock || isBlockedGeneralReserve)
                                                            ? 'bg-blue-50'
                                                            : 'bg-gray-50';
                                                const textColor = isClosingStockLinked
                                                    ? 'text-amber-800'
                                                    : isTaxLinked
                                                        ? 'text-purple-800'
                                                        : (isBlockedOpeningStock || isBlockedGeneralReserve)
                                                            ? 'text-blue-800'
                                                            : 'text-gray-800';
                                                const tooltipText = isClosingStockLinked
                                                    ? 'Auto-calculated from Operating Statement Closing Stock'
                                                    : isTaxLinked
                                                        ? 'Auto-calculated from Operating Statement Tax'
                                                        : (isBlockedOpeningStock || isBlockedGeneralReserve)
                                                            ? 'Auto-filled from previous year'
                                                            : '';

                                                // Read Only Cell
                                                return (
                                                    <td
                                                        key={year.id}
                                                        className={`p-0 border-r ${bgColor} ${formulaState.active ? 'cursor-pointer hover:bg-yellow-50 ring-1 ring-transparent hover:ring-yellow-400' : ''}`}
                                                        onClick={() => {
                                                            if (formulaState.active) {
                                                                appendToFormula(val);
                                                            }
                                                        }}
                                                    >
                                                        <div className={`w-full h-full p-2 text-right text-sm font-bold ${textColor}`} title={tooltipText}>
                                                            {(() => {
                                                                const numVal = parseFloat(val);
                                                                const formatted = numVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                                                if (row.name.toLowerCase().includes('ratio') || row.name.includes('%')) {
                                                                    return `${formatted}%`;
                                                                }
                                                                return formatted;
                                                            })()}
                                                        </div>

                                                    </td>
                                                );
                                            } else {
                                                // Editable Cell
                                                return (
                                                    <DataCell
                                                        key={year.id}
                                                        rowId={row.id}
                                                        yearId={year.id}
                                                        initialValue={val}
                                                        row={row}
                                                        yearSettings={yearSettings}
                                                        onSave={handleSaveCell}
                                                        onAutoProject={handleAutoProjection}
                                                        formulaState={formulaState}
                                                        onStartFormula={startFormulaMode}
                                                        onAppendToFormula={appendToFormula}
                                                    />
                                                );
                                            }
                                        })}
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-6 flex justify-between items-center">
                {(pageType === 'liability' || pageType === 'liabilities') && (
                    <div className="flex gap-4 items-center">
                        <button
                            onClick={() => {
                                calculateTotalLoanRequired();
                                setIsLoanModalOpen(true);
                            }}
                            className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700"
                        >
                            {loanScheduleData ? 'View/Edit' : 'Setup'} Loan Schedule
                        </button>
                        {loanScheduleData && (
                            <span className="text-sm text-gray-600">
                                ₹{parseFloat(loanScheduleData.loan_amount).toLocaleString('en-IN')} @ {loanScheduleData.interest_rate}% for {Math.floor(loanScheduleData.tenure_months / 12)} years
                            </span>
                        )}
                    </div>
                )}
                <button onClick={() => navigate(getNextPage(pageType, currentReport.id))} className="bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700">Next Section &rarr;</button>
            </div>

            <AssetBreakdownModal
                isOpen={isAssetModalOpen}
                onClose={() => setIsAssetModalOpen(false)}
                reportId={currentReport.id}
                yearSettings={yearSettings}
                onSave={handleSaveAssets}
            />

            <LoanScheduleModal
                isOpen={isLoanModalOpen}
                onClose={() => setIsLoanModalOpen(false)}
                reportId={currentReport.id}
                yearSettings={yearSettings}
                totalLoanRequired={totalLoanRequired}
                onSave={() => {
                    fetchLoanData();
                    calculateTotalLoanRequired();
                    reloadFinancialData(currentReport.id);
                }}
            />

            <ExistingWCModal
                isOpen={isWCModalOpen}
                onClose={() => setIsWCModalOpen(false)}
                reportId={currentReport.id}
                onSave={() => {
                    fetchLoanData();
                    reloadFinancialData(currentReport.id);
                }}
            />


        </div >
    );
}
