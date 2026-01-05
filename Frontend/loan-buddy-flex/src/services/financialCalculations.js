/**
 * --- Helper: Tax Calculator ---
 */
export const calculateTax = (pbt, regime) => {
    if (pbt <= 0) return { tax: 0, surcharge: 0, cess: 0, total: 0 };

    let tax = 0;
    let surcharge = 0;
    let cess = 0;

    if (regime === 'domestic_22') {
        // Section 115BAA: 22% Tax + 10% Surcharge + 4% Cess
        tax = pbt * 0.22;
        surcharge = tax * 0.10;
        cess = (tax + surcharge) * 0.04;
    } else if (regime === 'llp') {
        // LLP: 30% Tax
        tax = pbt * 0.30;
        // Surcharge: 12% if Income > 1Cr
        if (pbt > 10000000) {
            surcharge = tax * 0.12;
        }
        cess = (tax + surcharge) * 0.04;
    } else if (regime === 'proprietorship') {
        // New Regime 2024-25 Slabs
        let taxable = pbt;

        // 0-3L: Nil
        if (taxable > 300000) {
            // 3-7L: 5%
            let slabAmount = Math.min(taxable, 700000) - 300000;
            tax += slabAmount * 0.05;
        }
        if (taxable > 700000) {
            // 7-10L: 10%
            let slabAmount = Math.min(taxable, 1000000) - 700000;
            tax += slabAmount * 0.10;
        }
        if (taxable > 1000000) {
            // 10-12L: 15%
            let slabAmount = Math.min(taxable, 1200000) - 1000000;
            tax += slabAmount * 0.15;
        }
        if (taxable > 1200000) {
            // 12-15L: 20%
            let slabAmount = Math.min(taxable, 1500000) - 1200000;
            tax += slabAmount * 0.20;
        }
        if (taxable > 1500000) {
            // >15L: 30%
            let slabAmount = taxable - 1500000;
            tax += slabAmount * 0.30;
        }

        // Rebate u/s 87A if income <= 7L (New Regime) -> Tax is 0
        if (pbt <= 700000) {
            tax = 0;
        }
    }

    const total = tax + surcharge + cess;
    return { tax, surcharge, cess, total };
};
    
/**
 * --- CORE CALCULATION ENGINE ---
 */
export const calculateAll = (allGroups, yearSettings, sector, taxRegime, loanSummaries, gprSettings, wcSettings, projectCostsData, existingWCLoans = [], drawingsData = []) => {
    const results = {};
    yearSettings.forEach(year => results[year.id] = {});

    // Extract WC Settings
    const {
        wc_requirement_type = 'new',
        existing_wc_limit = 0, // Fallback if no list
        existing_wc_interest_rate = 10,
        proposed_wc_limit = 0,
        proposed_wc_interest_rate = 10
    } = wcSettings || {};

    // Group loan data by year for easy access
    const loanDataByYear = {};



    if (loanSummaries && Array.isArray(loanSummaries)) {
        loanSummaries.forEach((summary, index) => {
            const yearId = summary.year_setting?.id || summary.year_setting || summary.year_id || summary.year_setting_id;

            if (!loanDataByYear[yearId]) {
                loanDataByYear[yearId] = {
                    interest: 0,
                    principal: 0,
                    closingBalance: 0,
                    openingBalance: 0
                };
            }

            // ACCUMULATE values (+=)
            loanDataByYear[yearId].interest += parseFloat(summary.annual_interest || summary.interest || 0);
            loanDataByYear[yearId].principal += parseFloat(summary.annual_principal || summary.principal || 0);
            loanDataByYear[yearId].closingBalance += parseFloat(summary.closing_balance || summary.closingBalance || 0);
            loanDataByYear[yearId].openingBalance += parseFloat(summary.opening_balance || summary.openingBalance || 0);
        });

    } else {

    }

    // Helper to get value from a specific row in a specific year
    const getVal = (yearId, key) => {
        // Check if it's already calculated
        if (results[yearId][key] !== undefined) return results[yearId][key];

        const keyLower = key.toLowerCase();

        // Search in groups
        for (const group of allGroups) {
            for (const row of group.rows) {
                const rowLower = row.name.toLowerCase();

                // Exact match first
                if (rowLower === keyLower) {
                    const dp = row.data.find(d => d.year_setting === yearId);
                    return parseFloat(dp?.value || 0);
                }

                // Special handling for Capital-related searches (LLP/Proprietorship)
                if (keyLower === 'capital' && (rowLower === 'ordinary share capital' || rowLower === 'share capital')) {
                    const dp = row.data.find(d => d.year_setting === yearId);
                    return parseFloat(dp?.value || 0);
                }
            }
        }
        return 0;
    };

    // Helper to sum a group dynamically
    const sumGroup = (yearId, groupNamePart, excludeNames = []) => {
        let sum = 0;
        // Find group by name OR system_tag (for new template structure)
        const group = allGroups.find(g =>
            g.name.toLowerCase().includes(groupNamePart.toLowerCase()) ||
            (g.system_tag && g.system_tag.toLowerCase().includes(groupNamePart.toLowerCase().replace(/\s+/g, '_')))
        );

        if (group) {
            group.rows.forEach(row => {
                // CRITICAL: Skip hidden rows from calculations
                if (row.is_hidden) return;

                // Ultra-robust exclusion
                // Normalize name: remove all non-alphanumeric chars to handle hidden/special chars
                const cleanName = row.name.toLowerCase().replace(/[^a-z0-9]/g, '');

                const isExcluded = excludeNames.some(ex => cleanName.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))
                    || cleanName.includes('depreciation') // changed from startsWith('depr') to includes('depreciation') on clean string
                    || cleanName.startsWith('depr')
                    || cleanName.includes('interest');

                if (!isExcluded && !row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                    const dp = row.data.find(d => d.year_setting === yearId);
                    const val = parseFloat(dp?.value || 0);

                    // Log included rows for debugging (only for first year to reduce noise)
                    if (yearId === yearSettings[0]?.id && groupNamePart === "Selling" && val > 0) {

                    }

                    sum += isNaN(val) ? 0 : val;
                } else if (yearId === yearSettings[0]?.id && groupNamePart === "Selling" && isExcluded) {

                }
            });
        }
        return sum;
    };

    // Helper to sum ALL groups of a given page_type (for accurate Total Assets/Liabilities)
    // This ensures CFS and BS iterate over the EXACT same rows
    // CRITICAL FIX: Added resultsObj parameter to prefer calculated values over raw input
    const sumAllGroupsByPageType = (yearId, pageType, excludeSystemTags = ['total_assets', 'total_liabilities'], excludeRowNames = [], resultsObj = null) => {
        let sum = 0;
        const normalizedExcludes = excludeRowNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));

        allGroups
            .filter(g => g.page_type === pageType && !excludeSystemTags.includes(g.system_tag))
            .forEach(group => {
                group.rows.forEach(row => {
                    if (row.is_hidden || row.is_calculated || row.is_total_row) return;
                    if (row.name.startsWith('=')) return; // Skip formula rows

                    // Skip rows that are injected/calculated elsewhere (Cash, Provision for Taxes, Term Loans, WC Loans)
                    const cleanName = row.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (normalizedExcludes.some(ex => cleanName.includes(ex))) return;

                    // CRITICAL FIX: Prefer calculated value from results if available
                    let val = 0;
                    if (resultsObj && resultsObj[row.name] !== undefined) {
                        val = parseFloat(resultsObj[row.name] || 0);
                    } else {
                        const dp = row.data.find(d => d.year_setting === yearId);
                        val = parseFloat(dp?.value || 0);
                    }
                    sum += isNaN(val) ? 0 : val;
                });
            });
        return sum;
    };


    // Store previous year's results for YoY waterfall calculations
    let prevYearResults = null;

    // Sequential waterfall: Process each year in order
    // Fix: Ensure yearSettings is sorted by year to guarantee correct carry-forward
    // Use regex to extract the first 4-digit number (e.g., "2025-2026" -> 2025, "FY25" -> 25?)
    const getYearNum = (yStr) => {
        if (!yStr) return 0;
        const match = yStr.toString().match(/\d{4}/);
        return match ? parseInt(match[0]) : 0;
    };
    const sortedYearSettings = [...yearSettings].sort((a, b) => getYearNum(a.year) - getYearNum(b.year));

    // DEBUG: Log the sort order to ensure it matches expectations
    if (typeof window !== 'undefined') {
        // console.log("Sorted Year Settings:", sortedYearSettings.map(y => y.year));
    }

    sortedYearSettings.forEach((year, yearIndex) => {
        const yId = year.id;

        // ========================================
        // 1. OPERATING STATEMENT (P&L)
        // ========================================

        // A. REVENUE
        let totalRevenue = 0;
        const revenueGroup = allGroups.find(g => g.name.toLowerCase().includes("revenue"));
        if (revenueGroup) {
            revenueGroup.rows.forEach(row => {
                // CRITICAL: Skip hidden rows from calculations
                if (row.is_hidden) return;

                if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                    const dp = row.data.find(d => d.year_setting === yId);
                    const value = parseFloat(dp?.value || 0);
                    totalRevenue += value;
                }
            });
        }
        results[yId]["Total Revenue"] = totalRevenue;
        results[yId]["Total Sales"] = totalRevenue; // Alias

        // B. COST OF GOODS SOLD (COGS)
        const cogsGroup = allGroups.find(g => g.name.toLowerCase().includes("cost of goods sold") || g.name.toLowerCase().includes("cogs"));

        let openStockRM = 0, closeStockRM = 0, purchasesRM = 0, otherRMCosts = 0;
        let manufacturingExpenses = 0;
        let openWIP = 0, closeWIP = 0;
        let openFG = 0, closeFG = 0;

        if (cogsGroup) {
            cogsGroup.rows.forEach(row => {
                // CRITICAL: Skip hidden rows from calculations
                if (row.is_hidden) return;

                if (!row.is_calculated && !row.is_total_row && !row.name.startsWith('=')) {
                    const dp = row.data.find(d => d.year_setting === yId);
                    const value = parseFloat(dp?.value || 0);
                    const name = row.name.toLowerCase();

                    // Smart categorization
                    if (name.includes('opening') && name.includes('stock') && name.includes('raw')) {
                        // PRIORITY 1: Check if GPR mode forced a specific opening stock
                        if (results[yId]?.["_forced_opening_stock_rm"] !== undefined) {
                            openStockRM = results[yId]["_forced_opening_stock_rm"];
                        }
                        // PRIORITY 2: Standard Waterfall (if Year > 0)
                        else if (yearIndex > 0) {
                            openStockRM = prevYearResults?.["Closing Stock (Raw Materials)"] || value;
                        }
                        // PRIORITY 3: Year 0 Input
                        else {
                            openStockRM = value;
                        }
                        results[yId][row.name] = openStockRM;
                        results[yId]["Opening Stock (Raw Materials)"] = openStockRM;

                    } else if (name.includes('closing') && name.includes('stock') && name.includes('raw')) {
                        closeStockRM = value;
                    } else if (name.includes('purchase') && name.includes('raw')) {
                        purchasesRM += value;
                    } else if (name.includes('freight') && name.includes('in')) {
                        otherRMCosts += value;
                    } else if (name.includes('opening') && name.includes('work') && name.includes('process')) {
                        openWIP = yearIndex === 0 ? value : (prevYearResults?.["Closing Stock (Work-in-Process)"] || value);
                    } else if (name.includes('closing') && name.includes('work') && name.includes('process')) {
                        closeWIP = value;
                    } else if (name.includes('opening') && name.includes('finished')) {
                        openFG = yearIndex === 0 ? value : (prevYearResults?.["Closing Stock (Finished Goods)"] || value);
                    } else if (name.includes('closing') && name.includes('finished')) {
                        closeFG = value;
                    } else {
                        manufacturingExpenses += value;
                    }
                }
            });
        }

        // --- TARGET GPR LOGIC ---
        if (gprSettings?.enabled && totalRevenue > 0) {
            let targetGPR = 0;
            if (yearIndex === 0) {
                const actualRMConsumed = openStockRM + purchasesRM + otherRMCosts - closeStockRM;
                const actualGrossFactoryCost = actualRMConsumed + manufacturingExpenses;
                const actualFactoryCostProduced = actualGrossFactoryCost + openWIP - closeWIP;
                const actualCOGS = actualFactoryCostProduced + openFG - closeFG;
                const actualGrossProfit = totalRevenue - actualCOGS;
                const actualGPR = (actualGrossProfit / totalRevenue) * 100;
                results[yId]["_actual_gpr"] = actualGPR;
            } else {
                const prevGPR = prevYearResults?.["_actual_gpr"] || 0;
                if (yearIndex === 1) {
                    targetGPR = prevGPR + (gprSettings.firstYearIncrement || 0);
                } else {
                    targetGPR = prevGPR + (gprSettings.subsequentIncrement || 0);
                }
                results[yId]["_actual_gpr"] = targetGPR;

                const targetGrossProfit = totalRevenue * (targetGPR / 100);
                const targetCOGS = totalRevenue - targetGrossProfit;
                const fixedPart = (openStockRM + purchasesRM + otherRMCosts) + manufacturingExpenses + (openWIP - closeWIP) + (openFG - closeFG);
                closeStockRM = fixedPart - targetCOGS;

                results[yId]["Closing Stock (Raw Materials)"] = closeStockRM;
                if (results[yId]["Closing Stock"]) results[yId]["Closing Stock"] = closeStockRM;

                if (yearIndex < yearSettings.length - 1) {
                    const nextYearId = yearSettings[yearIndex + 1].id;
                    if (!results[nextYearId]) results[nextYearId] = {};
                    results[nextYearId]["_forced_opening_stock_rm"] = closeStockRM;
                }
            }
        }

        const rmConsumed = openStockRM + purchasesRM + otherRMCosts - closeStockRM;
        results[yId]["Raw Material Consumed"] = rmConsumed;

        const grossFactoryCost = rmConsumed + manufacturingExpenses;
        results[yId]["Total Manufacturing Expenses"] = manufacturingExpenses;
        results[yId]["Gross Factory Cost"] = grossFactoryCost;

        const factoryCostProduced = grossFactoryCost + openWIP - closeWIP;
        results[yId]["Factory Cost of Goods Produced"] = factoryCostProduced;

        const cogs = factoryCostProduced + openFG - closeFG;
        results[yId]["Cost of Goods Sold (COGS)"] = cogs;

        const grossProfit = totalRevenue - cogs;
        results[yId]["Gross Profit"] = grossProfit;
        results[yId]["Gross Profit Ratio"] = totalRevenue ? (grossProfit / totalRevenue) * 100 : 0;

        // G. SG&A
        // Debugging SG&A Sum


        // WC Interest Calculation (Auto-calculated)
        let wcInterestExisting = 0;
        let wcInterestProposed = 0;

        if (existingWCLoans && existingWCLoans.length > 0) {
            existingWCLoans.forEach(loan => {
                const limit = parseFloat(loan.sanctioned_amount || 0);
                const rate = parseFloat(loan.interest_rate || 0);
                const interest = (limit * rate) / 100;
                wcInterestExisting += interest;
                results[yId][`Interest on ${loan.bank_name} WC`] = interest;
            });
        } else if (wc_requirement_type === 'enhancement') {
            wcInterestExisting = (parseFloat(existing_wc_limit) * parseFloat(existing_wc_interest_rate)) / 100;
            results[yId]["Interest on Existing Working Capital"] = wcInterestExisting;
        }

        wcInterestProposed = (parseFloat(proposed_wc_limit) * parseFloat(proposed_wc_interest_rate)) / 100;

        results[yId]["Interest on Proposed Working Capital"] = wcInterestProposed;

        let totalSGA = sumGroup(yId, "Selling", ["Depreciation", "Interest", "Depriciation", "Equipment", "Depr", "Amortization"]);

        // REVERT: Do NOT add WC Interest to SG&A Total. Interest is separate.
        // totalSGA += wcInterestExisting + wcInterestProposed;

        results[yId]["Total SG&A Expenses"] = totalSGA;
        results[yId]["Total Selling, General & Administrative Expenses"] = totalSGA; // Alias for preview
        results[yId]["Selling, General, and Admn. Exp. Total"] = totalSGA; // Exact alias for grid row match

        // H. EBITDA
        const ebitda = grossProfit - totalSGA;
        results[yId]["EBITDA"] = ebitda;
        results[yId]["Profit before Depreciation, Interest and Tax"] = ebitda; // Alias for preview

        // I. INTEREST
        const termLoanInterest = loanDataByYear[yId]?.interest || 0;


        // Separate Working Capital Interest from other interests
        // Populate Individual Loan Interests in Results
        if (loanSummaries && Array.isArray(loanSummaries)) {
            loanSummaries.forEach(summary => {
                const yearId = summary.year_setting?.id || summary.year_setting || summary.year_id || summary.year_setting_id;
                if (yearId === yId) {
                    const loanName = summary.loan_name || (summary.is_new_loan ? 'New Term Loan' : 'Term Loan');
                    const key = `Interest on ${loanName}`;
                    results[yId][key] = parseFloat(summary.annual_interest || summary.interest || 0);
                }
            });
        }

        const wcInterest = 0; // Force to 0 to ignore legacy row

        // ROBUST INTEREST CALCULATION:
        // Instead of looking only in "Financial" group, scan ALL groups for rows with "Interest" in name.
        // But exclude "Total Interest", "Term Loan Interest" (handled separately), and WC interest rows.
        // ALSO EXCLUDE: Any row starting with "Interest on" to avoid double counting injected loan rows.
        let otherInterest = 0;
        allGroups.forEach(group => {
            group.rows.forEach(row => {
                const name = row.name.toLowerCase();
                if (name.includes('interest') &&
                    !name.includes('total interest') &&
                    !name.includes('term loan interest') &&
                    !name.includes('working capital interest') && // Generic row
                    !name.startsWith('interest on') && // Exclude specific loan interests (injected)
                    !name.includes('interest coverage') // Ratio
                ) {
                    const dp = row.data.find(d => d.year_setting === yId);
                    otherInterest += parseFloat(dp?.value || 0);
                }
            });
        });



        const totalInterest = termLoanInterest + otherInterest + wcInterestExisting + wcInterestProposed;
        results[yId]["Term Loan Interest"] = termLoanInterest;
        results[yId]["Working Capital Interest"] = 0; // Ensure it doesn't show up
        results[yId]["Other Interest"] = otherInterest;
        results[yId]["Total Interest"] = totalInterest;

        // J. DEPRECIATION
        // Get depreciation from the saved row (calculated by asset management)
        // Prioritize generic "Depreciation" as per user request
        const depreciation = getVal(yId, "Depreciation") || getVal(yId, "Depreciation (Office Equipment)");
        results[yId]["Depreciation"] = depreciation;
        results[yId]["Depreciation (Office Equipment)"] = depreciation;

        // K. OPERATING PROFIT (EBIT)
        const opProfit = ebitda - depreciation;
        results[yId]["Operating Profit (EBIT)"] = opProfit;
        results[yId]["Profit After Depreciation"] = opProfit; // Alias for grid display
        results[yId]["EBIT"] = opProfit; // Alias

        // L. PBT
        const pbt = ebitda - totalInterest - depreciation;
        results[yId]["Profit Before Tax"] = pbt;
        results[yId]["Profit/loss before tax"] = pbt;

        // L. TAX
        // Reverted to auto-calculation based on Tax Regime (as requested)
        const taxDetails = calculateTax(pbt, taxRegime);

        results[yId]["Tax"] = taxDetails.tax;
        results[yId]["Surcharge"] = taxDetails.surcharge;
        results[yId]["Cess"] = taxDetails.cess;
        results[yId]["Total Tax"] = taxDetails.total;
        results[yId]["Provision for Taxes"] = taxDetails.total; // For Balance Sheet

        // M. PAT
        const pat = pbt - taxDetails.total;
        results[yId]["Profit After Tax (PAT)"] = pat;
        results[yId]["PAT"] = pat;

        // N. RETAINED PROFIT
        const dividends = getVal(yId, "Equity / Dividend Paid Amount");
        const divTax = getVal(yId, "Dividend Tax including Surcharge");
        const retainedProfit = pat - (dividends + divTax);
        results[yId]["Retained Profit"] = retainedProfit;

        // ========================================
        // 2. BALANCE SHEET
        // ========================================

        // A. CURRENT ASSETS
        // A. CURRENT ASSETS
        let nonCashCurrentAssets = sumGroup(yId, "Current assets", ["Cash", "Bank"]);

        // --- AUTO-POPULATE ASSET HEADS FROM OPERATING STATEMENT ---
        // Store closing stock values with BOTH asset names AND P&L names for reliable lookup

        // 1. Raw materials Domestic -> Closing Stock (Raw Materials)
        const gridRM = getVal(yId, "Raw materials Domestic");
        results[yId]["Raw materials Domestic"] = closeStockRM;
        results[yId]["Closing Stock (Raw Materials)"] = closeStockRM;

        // 2. Stock in process -> Closing Stock (Work-in-Process)
        const gridWIP = getVal(yId, "Stock in process");
        results[yId]["Stock in process"] = closeWIP;
        results[yId]["Closing Stock (Work-in-Process)"] = closeWIP;

        // 3. Finished goods -> Closing Stock (Finished Goods)
        const gridFG = getVal(yId, "Finished goods");
        results[yId]["Finished goods"] = closeFG;
        results[yId]["Closing Stock (Finished Goods)"] = closeFG;

        // Adjust Total Current Assets:
        // Subtract the values that came from the grid (via sumGroup) and add the calculated values
        nonCashCurrentAssets = nonCashCurrentAssets - gridRM - gridWIP - gridFG + closeStockRM + closeWIP + closeFG;

        // B. FIXED ASSETS (WDV Method with Asset Additions)
        let grossBlock;
        let assetAdditions = 0;

        // Calculate asset additions for this year
        if (projectCostsData && projectCostsData.length > 0) {
            const currentYearLabel = yearSettings[yearIndex]?.year; // e.g., "2025-2026"

            // Sum up all assets that start in this year
            // Assets can have start_date (e.g., "2025-2026") or start_year (e.g., 2025)
            assetAdditions = projectCostsData
                .filter(asset => {
                    // Skip existing assets (they're counted in Year 0 Gross Block)
                    if (asset.is_existing_asset) return false;

                    // Match by start_date if available
                    if (asset.start_date && asset.start_date === currentYearLabel) {
                        return true;
                    }

                    // Match by purchase_year (ID) - THIS IS THE KEY FIX
                    if (asset.purchase_year && (asset.purchase_year === yId || parseInt(asset.purchase_year) === yId)) {
                        return true;
                    }

                    // Fallback: check if start_year matches the first year of the period
                    // e.g., "2025-2026" -> check if start_year == 2025
                    if (asset.start_year && currentYearLabel) {
                        const firstYear = parseInt(currentYearLabel.split('-')[0]);
                        return asset.start_year === firstYear;
                    }

                    return false;
                })
                .reduce((sum, asset) => sum + parseFloat(asset.amount || 0), 0);
        }

        if (yearIndex === 0) {
            // Year 0: Gross Block = Value from Asset Management (sum of Existing Assets)
            // This is saved by handleSaveAssets() to the "Gross block" row
            grossBlock = getVal(yId, "Gross block");
            // Add any new assets purchased in Year 0
            grossBlock += assetAdditions;
        } else {
            // Year N: Gross Block = Previous Year's Net Block + Asset Additions
            // Fix: Use internal carry key if available, else fallback to name lookup
            const prevNetBlock = (prevYearResults && (
                prevYearResults["_net_block_carry"] !== undefined ? prevYearResults["_net_block_carry"] :
                    (prevYearResults["Net block"] || prevYearResults["Net Block"])
            )) || 0;
            grossBlock = prevNetBlock + assetAdditions;
        }

        const netBlock = grossBlock - depreciation;
        results[yId]["Gross block"] = grossBlock;
        results[yId]["Net block"] = netBlock;
        // CRITICAL FIX: Internal carry key to bypass casing/naming issues for next year's calculation
        results[yId]["_net_block_carry"] = netBlock;

        // --- ROBUST ASSIGNMENT: Iterate identifying row names to prevent ghost rows ---
        // --- ROBUST ASSIGNMENT: Iterate identifying row names to prevent ghost rows ---
        const fixedAssetGroup = allGroups.find(g => g.name.toLowerCase().includes('fixed') || g.system_tag === 'fixed_assets');
        if (fixedAssetGroup && fixedAssetGroup.rows) {
            fixedAssetGroup.rows.forEach(r => {
                const lowerName = r.name.toLowerCase().trim();
                // ONLY assign to Gross Block and Net Block. Skip Accumulated Depreciation.
                if (lowerName.includes('gross block')) {
                    results[yId][r.name] = grossBlock;
                } else if (lowerName === 'net block') {
                    results[yId][r.name] = netBlock;
                }
                // REMOVED: Assignment to Accumulated Depreciation / Depreciation rows here
                // Depreciation is already assigned at line 423/424
            });
        }

        results[yId]["Asset Additions"] = assetAdditions; // Store for reference

        // Get Capital WIP and Intangible Assets (not included in Gross Block calculation)
        const capitalWIP = getVal(yId, "Capital WIP") || getVal(yId, "Capital WIP");
        const intangibleAssets = getVal(yId, "Intangible Assets") || 0;

        // Total Fixed Assets = Net Block + Capital WIP + Intangibles
        const totalFixedAssets = netBlock + capitalWIP + intangibleAssets;
        results[yId]["Total Fixed Assets"] = totalFixedAssets;


        // C. CURRENT LIABILITIES
        const totalCurrentLiabilitiesInput = sumGroup(yId, "Current liabilities", ["Provision for Taxes"]);

        // WC Liability Injection
        let wcLiabilityExisting = 0;
        let wcLiabilityProposed = 0;

        if (existingWCLoans && existingWCLoans.length > 0) {
            existingWCLoans.forEach(loan => {
                const val = parseFloat(loan.sanctioned_amount || 0);
                wcLiabilityExisting += val;
                results[yId][`${loan.bank_name} WC Limit`] = val;
            });
        } else if (wc_requirement_type === 'enhancement') {
            wcLiabilityExisting = parseFloat(existing_wc_limit);
            results[yId]["Existing Working Capital Limit"] = wcLiabilityExisting;
        }

        wcLiabilityProposed = parseFloat(proposed_wc_limit);

        results[yId]["Proposed Working Capital Limit"] = wcLiabilityProposed;

        const totalCurrentLiabilities = totalCurrentLiabilitiesInput + taxDetails.total + wcLiabilityExisting + wcLiabilityProposed;
        results[yId]["Total current liability"] = totalCurrentLiabilities;
        results[yId]["Total Current Liabilities"] = totalCurrentLiabilities; // Alias
        results[yId]["Provision for Taxes"] = taxDetails.total;

        // D. TERM LIABILITIES
        const termLiabilitiesInput = sumGroup(yId, "Term liabilities", ["Term loans"]);
        const loanOutstanding = loanDataByYear[yId]?.closingBalance || 0;

        // Store individual loan closing balances
        if (loanSummaries && Array.isArray(loanSummaries)) {
            loanSummaries.forEach(summary => {
                const yearId = summary.year_setting?.id || summary.year_setting || summary.year_id || summary.year_setting_id;
                if (yearId === yId) {
                    const loanName = summary.loan_name || (summary.is_new_loan ? 'New Term Loan' : 'Term Loan');
                    const key = `${loanName} (Closing Balance)`;
                    results[yId][key] = parseFloat(summary.closing_balance || 0);
                }
            });
        }


        const totalTermLiabilities = termLiabilitiesInput + loanOutstanding;
        results[yId]["Total term liabilities"] = totalTermLiabilities;
        results[yId]["Total Term Liabilities"] = totalTermLiabilities; // Alias
        results[yId]["Term loans (excluding installments)"] = loanOutstanding;
        // E. NET WORTH
        // Different calculation for LLP/Proprietorship vs Domestic Company
        const isLlpOrProprietorship = taxRegime === 'llp' || taxRegime === 'proprietorship';

        let totalNetWorth = 0;
        let shareCapital = 0; // Define for both branches to avoid reference errors

        if (isLlpOrProprietorship) {
            // LLP/Proprietorship: Capital - Drawings + General Reserve (PAT) + Other Heads
            // 
            // CRITICAL FIX: Capital flows as the "operating portion" of Net Worth:
            // - Year 1 Capital = User input
            // - Year 2+ Capital = Previous Year's Capital + PAT - Drawings (NOT including Share Premium etc.)
            // 
            // This prevents double-counting of Share Premium/Other Heads which are absolute values.

            let capital = 0;
            if (yearIndex === 0) {
                // First year: look for user input in "Capital" or "Ordinary share capital"
                capital = getVal(yId, "Capital") || getVal(yId, "Ordinary share capital") || 0;
            } else {
                // Year 2+: Capital = Previous Year's Capital + PAT - Drawings
                // This is the "operating waterfall" - NOT the full Net Worth
                const prevCapital = prevYearResults?.["Capital"] || 0;
                const prevPAT = prevYearResults?.["General Reserve (PAT)"] || prevYearResults?.["Profit After Tax (PAT)"] || 0;
                const prevDrawings = prevYearResults?.["Drawings"] || 0;
                capital = prevCapital + prevPAT - prevDrawings;
            }
            results[yId]["Capital"] = capital;
            shareCapital = capital; // For cash flow calculations

            // Drawings: Get from standard row input
            const yearDrawings = getVal(yId, "Drawings") || 0;
            results[yId]["Drawings"] = yearDrawings;

            // General Reserve (PAT): Use this year's PAT from Operating Statement
            const generalReservePAT = results[yId]["Profit After Tax (PAT)"] || 0;


            results[yId]["General Reserve (PAT)"] = generalReservePAT;

            // Net Worth = Capital - Drawings + General Reserve (PAT) + Other Heads
            // Other Heads (Share Premium, Revaluation Reserves, etc.) are ABSOLUTE values each year
            // Since Capital only carries forward the operating portion, we add full Other Heads value
            const otherHeads = sumGroup(yId, "Net Worth", ["Capital", "Drawings", "General reserve", "Total Net Worth", "Ordinary share capital", "Share Capital", "Reserves & Surplus"]);

            totalNetWorth = capital - yearDrawings + generalReservePAT + otherHeads;
        } else {
            // Domestic Company: Original calculation
            // 1. Share Capital & Other Equity (Excluding General Reserve & Net Worth itself)
            // Prioritize "Shareholders" to avoid apostrophe mismatch issues
            // Exclude "liability" to avoid including "Deferred Tax Liability" if it's in the same group
            let shareCapital = sumGroup(yId, "Shareholders", ["General reserve", "Net worth", "liability"]);

            // Fallback: If "Shareholders" group is empty/missing, check "Share capital"
            if (shareCapital === 0) {
                shareCapital = sumGroup(yId, "Share capital", ["General reserve", "Net worth", "liability"]);
            }

            // Fallback 2: If both fail, check for "Net Worth" group (as seen in user logs)
            if (shareCapital === 0) {
                shareCapital = sumGroup(yId, "Net Worth", ["General reserve", "Net worth", "liability"]);
            }

            const generalReserveInput = getVal(yId, "General reserve");
            const drawings = getVal(yId, "Drawings") || 0;  // Drawings reduce reserves
            let currentReserves;

            if (yearIndex === 0) {
                // Year 0: Opening Reserves + Current Year PAT - Drawings
                // This is the P&L to BS Link (Three-Way Linkage)
                currentReserves = generalReserveInput + retainedProfit;
            } else {
                // Year 1+: Previous Reserves + Current Year PAT
                const prevReserves = (prevYearResults && prevYearResults["Reserves"]) || 0;
                currentReserves = prevReserves + retainedProfit;
            }

            // Store Reserves (properly linked to PAT)
            results[yId]["Reserves"] = currentReserves;
            results[yId]["General reserve"] = currentReserves;
            results[yId]["Retained Earnings"] = currentReserves;

            totalNetWorth = shareCapital + currentReserves;

        }

        results[yId]["Net worth"] = totalNetWorth;
        results[yId]["Net Worth"] = totalNetWorth; // Alias
        results[yId]["Total Net Worth"] = totalNetWorth; // Alias

        // F. TOTAL LIABILITIES (Sum ALL liability-type groups for accurate CFS-BS alignment)
        // CRITICAL: We must exclude Net Worth groups here since we add totalNetWorth separately
        // Otherwise we double-count Share Capital, General Reserve, etc.
        const allLiabilityRowsSum = sumAllGroupsByPageType(yId, 'liability',
            // Exclude these system_tags
            ['total_liabilities', 'total_assets', 'net_worth', 'net_worth_total', 'reserves_surplus', 'shareholders_equity'],
            // Exclude these row names (calculated/injected separately)
            ['provision for taxes', 'term loans', 'term loan', 'existing working capital', 'proposed working capital',
                'share capital', 'ordinary share capital', 'general reserve', 'capital', 'drawings', 'retained earnings',
                'reserves & surplus', 'capital reserve', 'share premium'],
            results[yId]
        );

        // Total = All non-equity liability rows + Calculated injections + Net Worth
        // Net Worth is handled separately (includes Share Capital + Reserves cascade)
        const totalLiabilities = allLiabilityRowsSum + taxDetails.total + loanOutstanding + wcLiabilityExisting + wcLiabilityProposed + totalNetWorth;

        results[yId]["Total liabilities"] = totalLiabilities;
        results[yId]["Total Liabilities"] = totalLiabilities; // Alias
        results[yId]["Total Liabilities and Net Worth"] = totalLiabilities; // For BS display
        results[yId]["_debug_allLiabilityRowsSum"] = allLiabilityRowsSum; // Debug: raw sum from groups
        results[yId]["_debug_taxInjection"] = taxDetails.total;
        results[yId]["_debug_loanInjection"] = loanOutstanding;
        results[yId]["_debug_wcInjection"] = wcLiabilityExisting + wcLiabilityProposed;
        results[yId]["_debug_netWorthInjection"] = totalNetWorth;


        // ========================================
        // 3. CASH FLOW STATEMENT (METADATA-BASED INDIRECT METHOD)
        // ========================================
        // IMPORTANT: Calculate Cash Flow FIRST, then use closing cash for Balance Sheet

        // === A. OPERATING ACTIVITIES ===
        // Start with PAT (Source)
        let cashFromOperating = pat;
        results[yId]["Net profit/Profit/Loss after tax"] = pat;

        // Add back non-cash expenses
        results[yId]["Add: Depreciation"] = depreciation;
        cashFromOperating += depreciation;

        // Add back ALL interest that was deducted to reach PAT (will be paid in financing section)
        // totalInterest includes: Term Loan + WC (existing + proposed) + Other Interest
        results[yId]["Add: Term Loan Interest"] = termLoanInterest;
        results[yId]["Add: Working Capital Interest"] = wcInterestExisting + wcInterestProposed;
        results[yId]["Add: Other Interest"] = otherInterest;
        cashFromOperating += totalInterest; // Use totalInterest (not cfsTotalInterest) to capture all

        // === METADATA-DRIVEN WORKING CAPITAL CHANGES ===
        // Iterate through each BS group/row and calculate individual deltas
        // Store each delta for display in Preview
        const operatingDeltas = [];
        const investingDeltas = [];
        const financingDeltas = [];

        // Helper: Get CFS bucket for a row
        // Priority: 1) Skip special rows, 2) row.system_tag, 3) row-name fallback, 4) group's cf_bucket
        const getRowCFBucket = (row, groupCfBucket) => {
            const lowerName = row.name.toLowerCase();

            // Skip Cash & Bank (it's the result, not a source)
            if (row.system_tag === 'cash_bank' ||
                (lowerName.includes('cash') && (lowerName.includes('bank') || lowerName.includes('hand')))) {
                return 'skip';
            }

            // Skip rows managed via PAT (Reserves) - their delta is captured via PAT in Operating
            if (row.system_tag === 'retained_earnings' || row.system_tag === 'general_reserve') {
                return 'skip';
            }

            // =============== LLP/PROPRIETORSHIP SPECIAL HANDLING ===============
            // For LLP/Proprietorship, skip "Capital" delta because:
            // - Capital in Year 2+ is just the previous year's Net Worth flowing through
            // - It's an accounting entry, NOT a cash movement
            // - If we count Capital delta AND PAT, we would double-count
            if (isLlpOrProprietorship) {
                // Skip Capital row - not a cash movement (it's previous year's Net Worth)
                if (lowerName === 'capital' || row.system_tag === 'capital' || lowerName === "partner's capital") {
                    return 'skip';
                }

                // Skip Drawings - handled explicitly in Financing section (line ~1131)
                // If we don't skip, it gets counted in delta loop AND explicit section = double-counting
                if (lowerName === 'drawings' || row.system_tag === 'drawings') {
                    return 'skip';
                }

                // Skip General Reserve for LLP - it's just current year PAT, already in Operating
                if (lowerName.includes('general reserve')) {
                    return 'skip';
                }
            }
            // =====================================================================

            // Skip Interest rows - they are handled explicitly (add-back in Operating, outflow in Financing)
            // This prevents double-counting interest in the delta loop
            if (lowerName.includes('interest') && !lowerName.includes('interest coverage')) {
                return 'skip';
            }

            if (row.system_tag) {
                // Financing items captured via delta loop
                if (['wc_borrowing', 'drawings', 'share_capital', 'unsecured_loan', 'term_loan'].includes(row.system_tag)) {
                    return 'financing';
                }
                if (['gross_block', 'capital_wip', 'net_block', 'accum_depr'].includes(row.system_tag)) {
                    // Skip gross_block, net_block, and accum_depr:
                    // - gross_block/net_block: handled via explicit purchaseFA
                    // - accum_depr: non-cash, already handled via "Add: Depreciation" in Operating
                    if (row.system_tag === 'gross_block' || row.system_tag === 'net_block' || row.system_tag === 'accum_depr') {
                        return 'skip';
                    }
                    return 'investing'; // Only capital_wip reaches here
                }
                if (row.system_tag === 'dtl') {

                    // Financing items - ALL captured via delta loop:
                    if (lowerName.includes('cc limit') || lowerName.includes('od limit') ||
                        lowerName.includes('packing credit') ||
                        lowerName.includes('short term borrowing') ||
                        lowerName.includes('unsecured loan') ||
                        lowerName.includes("partner's capital") ||
                        lowerName.includes('share capital') || lowerName.includes('ordinary share capital') ||
                        lowerName.includes('bills payable') ||
                        (lowerName.includes('current maturity') && lowerName.includes('debt'))) {
                        return 'financing';
                    }
                    // Skip fixed asset items handled via explicit purchaseFA
                    if (lowerName.includes('gross block') || lowerName.includes('net block')) {
                        return 'skip';
                    }
                    // Investing items: Capital WIP, long-term investments, deposits
                    return 'investing';
                }
                // Use group's cf_bucket for everything else
                return groupCfBucket;
            }

            // If no system_tag, use group's bucket
            return groupCfBucket;
        };

        // Process all BS groups (asset and liability page_types)
        allGroups.forEach(group => {
            // Skip P&L groups (operating statement)
            if (group.page_type === 'operating') return;

            // Skip total groups, cash_equivalent groups, and reserves (managed via PAT)
            if (group.system_tag === 'total_assets' || group.system_tag === 'total_liabilities') return;
            if (group.system_tag === 'net_worth_total') return; // Calculated subtotal
            if (group.system_tag === 'reserves_surplus') return; // Captured via PAT in Operating
            if (group.cf_bucket === 'cash_equivalent' || group.cf_bucket === 'skip') return;

            // Get classification from group metadata
            const groupCfBucket = group.cf_bucket ||
                (group.system_tag?.includes('current') || group.system_tag?.includes('trade') || group.system_tag?.includes('provision') ? 'operating' :
                    group.system_tag?.includes('fixed') || group.system_tag?.includes('non_current') ? 'investing' :
                        group.system_tag?.includes('capital') || group.system_tag?.includes('borrowing') || group.system_tag?.includes('term') ? 'financing' : 'operating');


            const nature = group.nature ||
                (group.page_type === 'asset' ? 'asset' : 'liability');

            group.rows.forEach(row => {
                // Skip calculated/total/hidden rows
                if (row.is_hidden || row.is_calculated || row.is_total_row || row.name.startsWith('=')) return;

                // Get row-specific cf_bucket (may override group's bucket)
                const cfBucket = getRowCFBucket(row, groupCfBucket);

                // Skip rows that should not be in CFS (Cash & Bank, Term Loan display rows)
                if (cfBucket === 'skip') return;

                const rowNameLower = row.name.toLowerCase();
                // Skip rows handled explicitly elsewhere
                if (rowNameLower.includes('term loan') && rowNameLower.includes('excluding')) return;

                // Get current year value
                const dp = row.data.find(d => d.year_setting === yId);
                let currVal = parseFloat(dp?.value || 0);

                // CRITICAL: For Provision for Taxes, use the CALCULATED value from P&L tax
                // This ensures CFS delta matches the BS value
                if (rowNameLower.includes('provision for tax')) {
                    currVal = results[yId]["Provision for Taxes"] || taxDetails.total || currVal;
                }

                // CRITICAL: For inventory rows, use CALCULATED closing stock values from Operating Statement
                // These rows should reflect the P&L closing stock, not raw input values
                if (rowNameLower.includes('raw material') && rowNameLower.includes('domestic')) {
                    currVal = results[yId]["Raw materials Domestic"] || results[yId]["Closing Stock (Raw Materials)"] || currVal;
                }
                if (rowNameLower.includes('stock in process') || (rowNameLower.includes('wip') && !rowNameLower.includes('capital'))) {
                    currVal = results[yId]["Stock in process"] || results[yId]["Closing Stock (Work-in-Process)"] || currVal;
                }
                if (rowNameLower.includes('finished good')) {
                    currVal = results[yId]["Finished goods"] || results[yId]["Closing Stock (Finished Goods)"] || currVal;
                }

                // Get previous year value
                // CRITICAL: For Year 0, prevVal = 0 (opening balance is 0)
                // This ensures all Year 0 ending values are treated as the change
                const prevVal = prevYearResults ? (prevYearResults[row.name] || 0) : 0;

                // Store current value for next year's comparison
                results[yId][row.name] = currVal;


                // Calculate delta based on nature
                let delta;
                if (nature === 'asset') {
                    // Asset: Increase = Outflow (negative), Decrease = Inflow (positive)
                    delta = prevVal - currVal;
                } else {
                    // Liability: Increase = Inflow (positive), Decrease = Outflow (negative)
                    delta = currVal - prevVal;
                }

                // Only track non-zero deltas for display
                if (Math.abs(delta) > 0.01) {
                    const deltaItem = { name: row.name, delta: delta, bucket: cfBucket };

                    if (cfBucket === 'operating') {
                        operatingDeltas.push(deltaItem);
                    } else if (cfBucket === 'investing') {
                        investingDeltas.push(deltaItem);
                    } else if (cfBucket === 'financing') {
                        financingDeltas.push(deltaItem);
                    }

                    // Store individual delta for Preview display
                    results[yId][`Δ ${row.name}`] = delta;
                }
            });
        });

        // Sum up operating deltas
        let wcAssetChange = 0;
        let wcLiabilityChange = 0;
        operatingDeltas.forEach(item => {
            if (item.delta < 0) {
                wcAssetChange += -item.delta; // Outflows (positive display)
            } else {
                wcLiabilityChange += item.delta; // Inflows
            }
        });

        results[yId]["Less: Increase in Current Assets"] = -wcAssetChange;
        results[yId]["Increase in Current Liability"] = wcLiabilityChange;
        cashFromOperating += wcLiabilityChange - wcAssetChange;

        // Store operating deltas summary for Preview grouping
        results[yId]["_operatingDeltas"] = operatingDeltas;
        results[yId]["_investingDeltas"] = investingDeltas;
        results[yId]["_financingDeltas"] = financingDeltas;

        // === GLOBAL DELTA AUDIT ===
        // Track EVERY BS row's delta and compare to what CFS captured
        const globalDeltaAudit = [];
        const capturedRowNames = new Set([
            ...operatingDeltas.map(d => d.name),
            ...investingDeltas.map(d => d.name),
            ...financingDeltas.map(d => d.name)
        ]);

        // Iterate through ALL BS groups (assets and liabilities)
        allGroups.forEach(group => {
            if (group.page_type === 'operating') return; // Skip P&L

            const nature = group.page_type === 'asset' ? 'asset' : 'liability';

            group.rows.forEach(row => {
                if (row.is_hidden || row.is_calculated || row.is_total_row || row.name.startsWith('=')) return;

                const dp = row.data.find(d => d.year_setting === yId);
                const currVal = parseFloat(dp?.value || 0);
                const prevVal = prevYearResults ? (prevYearResults[row.name] || 0) : 0;

                // Calculate delta with correct sign convention
                let delta;
                if (nature === 'asset') {
                    delta = currVal - prevVal; // Asset increase = positive delta (but cash outflow)
                } else {
                    delta = currVal - prevVal; // Liability increase = positive delta (cash inflow)
                }

                // Determine cash flow impact (sign flip for assets)
                const cashImpact = nature === 'asset' ? -delta : delta;

                const isCaptured = capturedRowNames.has(row.name);
                const cfsBucket = isCaptured ?
                    (operatingDeltas.find(d => d.name === row.name)?.bucket ||
                        investingDeltas.find(d => d.name === row.name)?.bucket ||
                        financingDeltas.find(d => d.name === row.name)?.bucket) : 'MISSING';

                // Skip zero deltas for cleaner audit
                if (Math.abs(delta) > 0.01) {
                    globalDeltaAudit.push({
                        row: row.name,
                        group: group.name,
                        nature: nature,
                        prevVal: prevVal,
                        currVal: currVal,
                        delta: delta,
                        cashImpact: cashImpact,
                        cfsBucket: cfsBucket,
                        captured: isCaptured,
                        leak: !isCaptured && cfsBucket === 'MISSING'
                    });
                }
            });
        });

        // Calculate sum of ALL BS deltas (should equal Net Cash Flow if everything is captured)
        const totalBSDelta = globalDeltaAudit.reduce((sum, item) => sum + item.cashImpact, 0);
        const uncapturedDelta = globalDeltaAudit.filter(item => item.leak).reduce((sum, item) => sum + item.cashImpact, 0);

        // Store audit data for debugging
        results[yId]["_globalDeltaAudit"] = globalDeltaAudit;
        results[yId]["_totalBSDelta"] = totalBSDelta;
        results[yId]["_uncapturedDelta"] = uncapturedDelta;
        results[yId]["_leakedRows"] = globalDeltaAudit.filter(item => item.leak);

        results[yId]["Net Cash from Operating Activities"] = cashFromOperating;

        // === B. INVESTING ACTIVITIES ===
        // Fixed Assets (cf_bucket=investing, nature=asset): Increase = Outflow
        let purchaseFA = 0;
        if (prevYearResults) {
            // Capex = Change in Net Block + Depreciation = Gross additions
            const prevNetBlock = prevYearResults["Net block"] || 0;
            const currNetBlock = netBlock;
            purchaseFA = (currNetBlock - prevNetBlock) + depreciation;
        } else {
            // Year 0: Capex is the TOTAL Gross Block (existing + new assets)
            // This represents the total fixed asset investment at project start
            purchaseFA = grossBlock;
        }
        results[yId]["Less: Purchase/Addition of Fixed Assets"] = -purchaseFA;

        // Sum ALL investingDeltas from the loop (includes Capital WIP, Security Deposits, etc.)
        // These are already calculated with proper asset delta logic (Increase = Outflow)
        const investingDeltaSum = investingDeltas.reduce((sum, item) => sum + item.delta, 0);

        // Total Investing = CapEx (explicit) + Other Investing Deltas (from loop)
        // Note: purchaseFA is positive (outflow), so we negate it
        // investingDeltaSum already has correct sign from the loop
        let cashFromInvesting = -purchaseFA + investingDeltaSum;
        results[yId]["Net Cash from Investment Activities"] = cashFromInvesting;


        // === C. FINANCING ACTIVITIES ===
        let cashFromFinancing = 0;

        // 1. Term Loan Changes (cf_bucket=financing, nature=liability)
        let termLoanProceeds = 0;
        let termLoanRepayment = 0;
        if (prevYearResults) {
            const prevLoan = prevYearResults["Term loans (excluding installments)"] || 0;
            const currLoan = loanOutstanding;
            const loanChange = currLoan - prevLoan;
            if (loanChange > 0) {
                termLoanProceeds = loanChange;
            } else {
                termLoanRepayment = -loanChange;
            }
            cashFromFinancing += loanChange;
        } else {
            // Year 0: New loan is an inflow
            termLoanProceeds = loanOutstanding;
            cashFromFinancing += loanOutstanding;
        }
        results[yId]["Add: Proceeds from Term Loans"] = termLoanProceeds;
        results[yId]["Less: Repayment of Term Loans"] = -termLoanRepayment;
        // 2. Other Term Liabilities Change (Unsecured Loans, etc.)
        // NOTE: Now captured via financingDeltas from delta loop - DO NOT add here to avoid double-counting
        let otherTermLiabChange = 0;
        // These are calculated for display purposes only (actual flow is via delta loop)
        if (prevYearResults) {
            const prevOtherTL = (prevYearResults["Total term liability"] || prevYearResults["Total Term Liabilities"] || 0) - (prevYearResults["Term loans (excluding installments)"] || 0);
            const currOtherTL = totalTermLiabilities - loanOutstanding;
            otherTermLiabChange = currOtherTL - prevOtherTL;
            // REMOVED: cashFromFinancing += otherTermLiabChange; // Captured in delta loop
        } else {
            otherTermLiabChange = totalTermLiabilities - loanOutstanding;
            // REMOVED: cashFromFinancing += otherTermLiabChange; // Captured in delta loop
        }
        results[yId]["Add/Less: Change in Other Term Liabilities"] = otherTermLiabChange;

        // 3. Net Worth Changes (Share Capital)
        // NOTE: Now captured via financingDeltas from delta loop - DO NOT add here to avoid double-counting
        let equityChange = 0;
        // These are calculated for display purposes only (actual flow is via delta loop)
        if (prevYearResults) {
            if (isLlpOrProprietorship) {
                equityChange = 0;
            } else {
                const prevShareCap = prevYearResults["Ordinary share capital"] || prevYearResults["Share Capital"] || 0;
                const currShareCap = getVal(yId, "Ordinary share capital") || getVal(yId, "Share Capital") || 0;
                equityChange = currShareCap - prevShareCap;
            }
            // REMOVED: cashFromFinancing += equityChange; // Captured in delta loop
        } else {
            if (!isLlpOrProprietorship) {
                const initialShareCap = getVal(yId, "Ordinary share capital") || getVal(yId, "Share Capital") || 0;
                equityChange = initialShareCap;
            } else {
                const initialCapital = getVal(yId, "Capital") || shareCapital || 0;
                equityChange = initialCapital;
            }
            // REMOVED: cashFromFinancing += equityChange; // Captured in delta loop
        }
        results[yId]["Add/Less: Change in Share Capital"] = equityChange;

        // 4. Working Capital Borrowing Change (cf_bucket=financing for WC loans)
        let wcBorrowingChange = 0;
        if (prevYearResults) {
            const prevWCBorrowing = (prevYearResults["Existing Working Capital Limit"] || 0) + (prevYearResults["Proposed Working Capital Limit"] || 0);
            const currWCBorrowing = wcLiabilityExisting + wcLiabilityProposed;
            wcBorrowingChange = currWCBorrowing - prevWCBorrowing;
            cashFromFinancing += wcBorrowingChange;
        } else {
            // Year 0: WC limit is an inflow
            wcBorrowingChange = wcLiabilityExisting + wcLiabilityProposed;
            cashFromFinancing += wcBorrowingChange;
        }
        results[yId]["Add/Less: Change in WC Borrowings"] = wcBorrowingChange;

        // 5. Drawings (LLP/Proprietorship - cash outflow)
        let drawingsOutflow = 0;
        if (isLlpOrProprietorship) {
            const yearDrawings = getVal(yId, "Drawings") || 0;
            drawingsOutflow = yearDrawings;
            cashFromFinancing -= drawingsOutflow;
        }
        results[yId]["Less: Drawings"] = -drawingsOutflow;

        // 6. Dividend Paid (cash outflow)
        const dividendPaid = dividends + divTax;
        cashFromFinancing -= dividendPaid;
        results[yId]["Less: Dividend Paid"] = -dividendPaid;

        // 7. Interest Paid (cash outflow - CMA format shows separately)
        // CRITICAL: Use the EXACT same totalInterest that was added back in Operating
        // This ensures symmetric treatment: what we added back, we now subtract as actual cash outflow
        const totalInterestPaid = totalInterest; // termLoanInterest + wcInterestExisting + wcInterestProposed + otherInterest
        cashFromFinancing -= totalInterestPaid;
        results[yId]["Less: Interest Paid"] = -totalInterestPaid;
        results[yId]["Less: Term Loan Interest Paid"] = -termLoanInterest;
        results[yId]["Less: WC Interest Paid"] = -(wcInterestExisting + wcInterestProposed);
        results[yId]["Less: Other Interest Paid"] = -otherInterest;

        // 8. Add ALL financingDeltas from the loop (includes Share Capital, Packing Credit, Unsecured Loans, etc.)
        // These are captured from the BS row iteration with proper delta logic
        const financingDeltaSum = financingDeltas.reduce((sum, item) => sum + item.delta, 0);
        cashFromFinancing += financingDeltaSum;

        results[yId]["Net Cash from Financing Activities"] = cashFromFinancing;


        // === D. NET CASH FLOW ===
        const netCashFlow = cashFromOperating + cashFromInvesting + cashFromFinancing;
        results[yId]["Net Cash Flow During the Year"] = netCashFlow;

        // === E. OPENING AND CLOSING CASH (CFS IS THE SOURCE OF TRUTH) ===
        let openingCash;
        if (yearIndex === 0) {
            // Year 0: Get opening cash from user input
            openingCash = getVal(yId, "Cash & Bank Balance") || getVal(yId, "Cash in Hand") || getVal(yId, "Balance with Banks") || 0;
            // If user hasn't entered anything, start from 0
        } else {
            // Year 1+: Opening = Previous year's CFS closing cash
            openingCash = (prevYearResults && prevYearResults["Closing Cash Balance (as per CFS)"]) ||
                (prevYearResults && prevYearResults["Cash & Bank Balance"]) ||
                (prevYearResults && prevYearResults["Total Cash & Bank"]) || 0;
        }
        const closingCashCFS = openingCash + netCashFlow;
        results[yId]["Add: Opening Cash Balance"] = openingCash;
        results[yId]["Closing Cash Balance (as per CFS)"] = closingCashCFS;

        // === F. USE CFS CASH FOR BALANCE SHEET (KEY FIX) ===
        // Inject cash value to ALL possible Cash row names (old and new templates)
        // Legacy row names
        results[yId]["Cash & Bank Balance"] = closingCashCFS;
        results[yId]["Cash & bank balance"] = closingCashCFS;
        // New template row names
        results[yId]["Cash in Hand"] = closingCashCFS;  // Primary cash row
        results[yId]["Balance with Banks"] = 0;  // Set to 0, all cash shown in "Cash in Hand"
        results[yId]["Total Cash & Bank"] = closingCashCFS;  // Total for new template

        // Now calculate Total Current Assets WITH the correct cash
        const totalCurrentAssets = nonCashCurrentAssets + closingCashCFS;
        results[yId]["Total current asset"] = totalCurrentAssets;
        results[yId]["Total Current Assets"] = totalCurrentAssets;
        results[yId]["Total Operating Current Assets"] = nonCashCurrentAssets; // Excluding cash

        // Get Non-Current Assets (legacy fallback)
        const nonCurrentAssets = sumGroup(yId, "Non-Current", []) ||
            sumGroup(yId, "non_current", []) ||
            getVal(yId, "Long Term Investments") +
            getVal(yId, "Security Deposits (MSEB/Rent)") +
            getVal(yId, "Investment in Subsidy") +
            getVal(yId, "Loans & Advances (LT)") +
            getVal(yId, "Other Non-Current Assets");
        results[yId]["Total Non-Current Assets"] = nonCurrentAssets;

        // SIMPLIFIED Total Assets Calculation - Use ONLY explicitly calculated components
        // This avoids double-counting issues from complex group summing
        // Components:
        // 1. Cash: closingCashCFS (from CFS)
        // 2. Operating Current Assets: nonCashCurrentAssets (calculated earlier)
        // 3. Fixed Assets: totalFixedAssets = netBlock + capitalWIP + intangibleAssets (calculated earlier)
        // 4. Non-Current Assets: nonCurrentAssets (calculated earlier)

        const totalAssets = closingCashCFS + nonCashCurrentAssets + totalFixedAssets + nonCurrentAssets;
        results[yId]["Total Asset"] = totalAssets;
        results[yId]["Total Assets"] = totalAssets;
        results[yId]["_debug_components"] = {
            cash: closingCashCFS,
            operatingCurrentAssets: nonCashCurrentAssets,
            fixedAssets: totalFixedAssets,
            nonCurrentAssets: nonCurrentAssets
        };


        // === G. BALANCE SHEET CHECK (AUDIT ONLY - NO PLUG) ===
        // BS Check = Total Assets - Total Liabilities
        // If Three-Way Linkage is correct, this should naturally be 0
        const balanceSheetCheck = totalAssets - totalLiabilities;
        results[yId]["Balance Sheet Check"] = balanceSheetCheck;
        results[yId]["BALANCE SHEET CHECK (Assets - Liabilities)"] = balanceSheetCheck;

        // Store Cash for reference
        results[yId]["Cash & Bank Balance (as per Balance Sheet)"] = closingCashCFS;
        results[yId]["CFS Check Diff"] = balanceSheetCheck;

        // === H. RECONCILIATION DIAGNOSTIC ===
        // Compare CFS Net Cash Flow to BS Cash Change
        const bsCashChange = closingCashCFS - (prevYearResults ? (prevYearResults["Closing Cash Balance (as per CFS)"] || 0) : 0);
        const netCashFlowFromCFS = results[yId]["Net Cash Flow During the Year"] || 0;
        const cfsReconciliationDiff = bsCashChange - netCashFlowFromCFS;

        results[yId]["_bsCashChange"] = bsCashChange;
        results[yId]["_netCashFlowFromCFS"] = netCashFlowFromCFS;
        results[yId]["_cfsReconciliationDiff"] = cfsReconciliationDiff;

        // === FINAL DIAGNOSTIC SUMMARY ===
        // This can be used with console.table() in React
        results[yId]["_diagnosticSummary"] = {
            year: year.year,
            totalAssets: totalAssets,
            totalLiabilities: totalLiabilities,
            bsCheck: balanceSheetCheck,
            netCashFlow: netCashFlowFromCFS,
            bsCashChange: bsCashChange,
            leakedRowCount: results[yId]["_leakedRows"]?.length || 0,
            uncapturedDelta: results[yId]["_uncapturedDelta"] || 0
        };



        // --- KEY RATIOS ---
        // 1. Debt Equity Ratio = Total Debt / Net Worth
        const totalDebt = totalTermLiabilities + totalCurrentLiabilities;
        const debtEquityRatio = totalNetWorth !== 0 ? totalDebt / totalNetWorth : 0;

        // 2. Current Ratio = Current Assets / Current Liabilities
        const currentRatio = totalCurrentLiabilities !== 0 ? totalCurrentAssets / totalCurrentLiabilities : 0;
        results[yId]["Current ratio"] = currentRatio;

        // 3. Quick Ratio = (Current Assets - Inventory) / Current Liabilities
        const inventory = closeStockRM + getVal(yId, "Stock in process") + getVal(yId, "Finished goods");
        const quickAssets = totalCurrentAssets - inventory;
        const quickRatio = totalCurrentLiabilities !== 0 ? quickAssets / totalCurrentLiabilities : 0;
        results[yId]["Quick ratio"] = quickRatio;

        // 4. Fixed Assets Coverage Ratio = Net Worth / Fixed Assets
        const fixedAssetsCoverageRatio = totalFixedAssets !== 0 ? totalNetWorth / totalFixedAssets : 0;
        results[yId]["Fixed Assets Coverage Ratio"] = fixedAssetsCoverageRatio;

        // 5. Interest Coverage Ratio = EBIT / Interest
        // const ebit = results[yId]["Operating Profit (EBIT)"] || 0; // Already declared above
        const interestCoverageRatio = totalInterest !== 0 ? opProfit / totalInterest : 0;
        results[yId]["Interest coverage ratio"] = interestCoverageRatio;

        // 6. DSCR = (PAT + Depreciation + Interest) / (Principal + Interest)
        // const termLoanInterest = loanDataByYear[yId]?.interest || 0; // Already declared above
        const termLoanPrincipal = loanDataByYear[yId]?.principal || 0;
        const dscr = (termLoanPrincipal + termLoanInterest) !== 0
            ? (pat + depreciation + termLoanInterest) / (termLoanPrincipal + termLoanInterest)
            : 0;
        results[yId]["Debt Service Coverage Ratio (DSCR)"] = dscr;

        // 7. ROCE = EBIT / Capital Employed
        const capitalEmployed = totalNetWorth + totalTermLiabilities;
        const roce = capitalEmployed !== 0 ? (opProfit / capitalEmployed) * 100 : 0;
        results[yId]["Return on Capital Employed (ROCE)"] = roce;

        // 8. Net Profit Margin = (PAT / Revenue) * 100
        const netProfitMargin = totalRevenue !== 0 ? (pat / totalRevenue) * 100 : 0;
        results[yId]["Net profit margin"] = netProfitMargin;

        // 9. Return on Net Worth = (PAT / Net Worth) * 100
        const returnOnNetWorth = totalNetWorth !== 0 ? (pat / totalNetWorth) * 100 : 0;
        results[yId]["Return on Net worth"] = returnOnNetWorth;

        // 10. Inventory Turnover Ratio = COGS / Average Inventory
        const avgInventory = yearIndex > 0
            ? ((openStockRM + closeStockRM) / 2)
            : closeStockRM;
        const inventoryTurnoverRatio = avgInventory !== 0 ? cogs / avgInventory : 0;
        results[yId]["Inventory turnover ratio"] = inventoryTurnoverRatio;

        // 11. Fixed Asset Turnover Ratio = Revenue / Fixed Assets
        const fixedAssetTurnoverRatio = totalFixedAssets !== 0 ? totalRevenue / totalFixedAssets : 0;
        results[yId]["Fixed asset turnover ratio"] = fixedAssetTurnoverRatio;

        // 12. Asset Turnover Ratio = Revenue / Total Assets (use already calculated value)
        const assetTurnoverRatio = results[yId]["Total Asset"] !== 0 ? totalRevenue / results[yId]["Total Asset"] : 0;
        results[yId]["Asset turnover ratio"] = assetTurnoverRatio;

        // --- DIAGNOSTIC RESIDUAL AUDIT ---
        // This identifies the EXACT row causing the imbalance
        const prevTotalLiab = prevYearResults ? (prevYearResults["Total Liabilities"] || 0) : 0;
        const prevTotalAssetsNonCash = prevYearResults ?
            ((prevYearResults["Total Assets"] || 0) - (prevYearResults["Closing Cash Balance (as per CFS)"] || 0)) : 0;

        const currentTotalAssetsNonCash = totalAssets - closingCashCFS;

        // What the BS needs to explain (liability increase should fund asset increase)
        const liabMovement = totalLiabilities - prevTotalLiab;
        const assetMovement = currentTotalAssetsNonCash - prevTotalAssetsNonCash;
        const actualBsMovement = liabMovement - assetMovement;

        // What the CFS is explaining (should equal Net Cash Flow)
        const totalInterestExpensed = totalInterest; // All interest deducted in P&L
        const cfsExplanation = netCashFlow;

        // The leak is the difference
        const leakAmount = actualBsMovement - cfsExplanation;

        // Store diagnostic data
        results[yId]["_residualAudit"] = {
            yearDisplay: year.year,
            liabMovement: liabMovement,
            assetMovement: assetMovement,
            actualBsMovement: actualBsMovement,
            cfsExplanation: cfsExplanation,
            leakAmount: leakAmount,
            pat: pat,
            depreciation: depreciation,
            totalInterestExpensed: totalInterestExpensed
        };

        // Log to console for debugging
        console.log(`--- Year ${year.year} Residual Audit ---`);
        console.log(`Liability Movement: ${liabMovement}`);
        console.log(`Asset Movement (Non-Cash): ${assetMovement}`);
        console.log(`BS Needs Explanation for: ${actualBsMovement}`);
        console.log(`CFS Explains (Net Cash Flow): ${cfsExplanation}`);
        console.log(`LEAK AMOUNT: ${leakAmount}`);

        // Identify Ghost Rows - rows that changed but weren't captured in CFS
        // EXCLUDE rows that are intentionally not captured (Cash, Net Block, General Reserve, Interest)
        const ghostRows = [];
        const intentionallySkippedPatterns = [
            'cash', 'net block', 'gross block', 'general reserve', 'retained earnings',
            'interest', 'provision for tax', 'term loan'
        ];

        allGroups.forEach(g => {
            if (g.page_type === 'operating') return; // Skip P&L groups
            g.rows.forEach(r => {
                if (r.is_total_row || r.is_calculated || r.is_hidden) return;

                // Skip rows that are intentionally not captured in CFS
                const lowerName = r.name.toLowerCase();
                if (intentionallySkippedPatterns.some(p => lowerName.includes(p))) return;

                const currVal = results[yId][r.name] || 0;
                const prevVal = prevYearResults ? (prevYearResults[r.name] || 0) : 0;
                const delta = currVal - prevVal;

                if (Math.abs(delta) > 0.01) {
                    // Check if this row's delta was captured in any CFS bucket
                    const wasCaptured = [...operatingDeltas, ...investingDeltas, ...financingDeltas].some(item => item.name === r.name);
                    if (!wasCaptured) {
                        ghostRows.push({
                            rowName: r.name,
                            groupName: g.name,
                            pageType: g.page_type,
                            delta: delta,
                            currVal: currVal,
                            prevVal: prevVal
                        });
                        console.warn(`🚨 GHOST ROW FOUND: "${r.name}" in "${g.name}" changed by ${delta} but was NOT captured in CFS!`);
                    }
                }
            });
        });

        results[yId]["_ghostRows"] = ghostRows;
        if (ghostRows.length > 0) {
            console.table(ghostRows);
        }

        // CRITICAL FIX: Store for next iteration - MUST be OUTSIDE the CFS block
        // This ensures prevYearResults is always set, even if CFS calculation block doesn't run
        prevYearResults = results[yId];
    });

    return results;
};
