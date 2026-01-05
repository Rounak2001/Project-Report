/**
 * Loan Schedule Calculation Service
 * 
 * Handles all loan-related calculations including:
 * - EMI calculation (Reducing Balance method)
 * - Monthly schedule generation
 * - Annual aggregation for financial statements
 */

/**
 * Calculate EMI (Equated Monthly Installment) using reducing balance method
 * Formula: EMI = P × r × (1+r)^n / [(1+r)^n - 1]
 * 
 * @param {number} principal - Loan amount
 * @param {number} annualRate - Annual interest rate (percentage, e.g., 12 for 12%)
 * @param {number} tenureMonths - Loan tenure in months
 * @returns {number} Monthly EMI amount
 */
export function calculateEMI(principal, annualRate, tenureMonths) {
    if (tenureMonths === 0 || principal === 0) return 0;

    const monthlyRate = (annualRate / 100) / 12;

    if (monthlyRate === 0) {
        // If interest rate is 0, EMI is simply principal divided by tenure
        return principal / tenureMonths;
    }

    const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) /
        (Math.pow(1 + monthlyRate, tenureMonths) - 1);

    return emi;
}

/**
 * Generate month-by-month loan schedule
 * 
 * @param {Object} config - Loan configuration
 * @param {number} config.loanAmount - Total loan amount
 * @param {number} config.interestRate - Annual interest rate (%)
 * @param {number} config.tenureMonths - Total loan tenure in months
 * @param {number} config.moratoriumMonths - Moratorium period (interest-only, no principal)
 * @param {string} config.repaymentMethod - 'EMI', 'BULLET', or 'CUSTOM'
 * @param {string|Date} config.startDate - Loan start date (optional, defaults to now)
 * @returns {Array} Monthly schedule array with {period, opening, interest, principal, payment, closing}
 */
export function generateLoanSchedule(config) {
    const { loanAmount, interestRate, tenureMonths, moratoriumMonths = 0, repaymentMethod = 'EMI', startDate } = config;

    const monthlyRate = (interestRate / 100) / 12;
    const schedule = [];

    let openingBalance = loanAmount;

    // Initialize date pointer
    let currentDate = startDate ? new Date(startDate) : new Date();
    // Ensure we start from the 1st of the month to avoid edge cases
    currentDate.setDate(1);

    if (repaymentMethod === 'EMI') {
        // Calculate EMI for the repayment period (after moratorium)
        const repaymentMonths = tenureMonths - moratoriumMonths;
        const emi = repaymentMonths > 0 ? calculateEMI(loanAmount, interestRate, repaymentMonths) : 0;

        for (let period = 1; period <= tenureMonths; period++) {
            const interest = openingBalance * monthlyRate;

            let principal = 0;
            let payment = interest;

            if (period > moratoriumMonths) {
                // After moratorium: EMI includes principal repayment
                principal = emi - interest;
                payment = emi;
            }

            const closingBalance = openingBalance - principal;

            // Format period label as "Mon YYYY"
            const monthName = currentDate.toLocaleString('default', { month: 'short' });
            const year = currentDate.getFullYear();
            const periodLabel = `${monthName} ${year}`;

            schedule.push({
                period: periodLabel, // e.g. "Apr 2024"
                date: new Date(currentDate), // Add date object
                periodIndex: period,
                opening: parseFloat(openingBalance.toFixed(2)),
                interest: parseFloat(interest.toFixed(2)),
                principal: parseFloat(principal.toFixed(2)),
                payment: parseFloat(payment.toFixed(2)),
                closing: parseFloat(closingBalance.toFixed(2))
            });

            openingBalance = closingBalance;
            // Move to next month
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    } else if (repaymentMethod === 'BULLET') {
        // Bullet repayment: Interest-only throughout, principal at end
        for (let period = 1; period <= tenureMonths; period++) {
            const interest = openingBalance * monthlyRate;
            const isPrincipalMonth = period === tenureMonths;
            const principal = isPrincipalMonth ? openingBalance : 0;
            const payment = interest + principal;
            const closingBalance = openingBalance - principal;

            // Format period label as "Mon YYYY"
            const monthName = currentDate.toLocaleString('default', { month: 'short' });
            const year = currentDate.getFullYear();
            const periodLabel = `${monthName} ${year}`;

            schedule.push({
                period: periodLabel,
                date: new Date(currentDate), // Add date object
                periodIndex: period,
                opening: parseFloat(openingBalance.toFixed(2)),
                interest: parseFloat(interest.toFixed(2)),
                principal: parseFloat(principal.toFixed(2)),
                payment: parseFloat(payment.toFixed(2)),
                closing: parseFloat(closingBalance.toFixed(2))
            });

            openingBalance = closingBalance;
            // Move to next month
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    }

    return schedule;
}

/**
 * Aggregate monthly schedule into annual summaries for financial statements
 * 
 * @param {Array} monthlySchedule - Monthly schedule from generateLoanSchedule
 * @param {Array} yearSettings - Array of year settings with {id, year, year_display}
 * @param {Object} startYear - Year setting where loan starts (Used only if dates are missing)
 * @returns {Object} Map of yearId -> {opening, interest, principal, closing, emi}
 */
export function aggregateByYear(monthlySchedule, yearSettings, startYear) {
    if (!monthlySchedule || monthlySchedule.length === 0) return {};

    const yearData = {};

    // Initialize all years
    yearSettings.forEach(year => {
        yearData[year.id] = {
            opening: 0,
            interest: 0,
            principal: 0,
            closing: 0,
            emi: 0,
            year_label: year.year_display
        };
    });

    // Also handle years BEYOND the projection period (for full schedule display)
    // We'll store them in a separate map or append to yearData if we can map them to IDs
    // Since we need to return a map keyed by yearId, and we might not have IDs for future years,
    // we will try to map to existing IDs if possible, or create a "yearly_summary" array in the caller.
    // BUT, this function specifically returns a map for the *financial calculations* which rely on year IDs.
    // So we only aggregate for the years present in yearSettings.

    // Helper to get FY from "Mon YYYY"
    const getFY = (periodLabel) => {
        const parts = periodLabel.split(' ');
        if (parts.length !== 2) return null;
        const month = parts[0];
        const year = parseInt(parts[1]);

        // FY starts in April.
        // Jan, Feb, Mar of Year X belong to FY (X-1)-X
        // Apr-Dec of Year X belong to FY X-(X+1)
        let fyStart = year;
        if (['Jan', 'Feb', 'Mar'].includes(month)) {
            fyStart = year - 1;
        }
        return fyStart; // Returns the start year of the FY (e.g., 2024 for FY 2024-25)
    };

    monthlySchedule.forEach(month => {
        const fyStart = getFY(month.period);
        if (fyStart !== null) {
            // Find the corresponding year ID in yearSettings
            // yearSettings usually has a 'year' property which is the FY start year (e.g. 2024)
            const yearSetting = yearSettings.find(y => parseInt(y.year) === fyStart);

            if (yearSetting) {
                const yId = yearSetting.id;
                const data = yearData[yId];

                // If this is the first entry for this year, set opening
                if (data.opening === 0 && data.interest === 0 && data.principal === 0) {
                    data.opening = month.opening;
                }

                data.interest += month.interest;
                data.principal += month.principal;
                data.payment += month.payment;
                data.closing = month.closing; // Always update closing to the latest month's closing
            }
        }
    });

    // Rounding pass
    Object.values(yearData).forEach(d => {
        d.interest = parseFloat(d.interest.toFixed(2));
        d.principal = parseFloat(d.principal.toFixed(2));
        d.closing = parseFloat(d.closing.toFixed(2));
    });

    return yearData;
}

/**
 * Aggregate monthly schedule into annual summaries for ALL years (including beyond projection)
 * Returns an array of summary objects.
 * 
 * @param {Array} monthlySchedule 
 * @param {Array} yearSettings - Used to map to existing IDs where possible
 * @param {Object} startYear - Used for base year calculation
 * @returns {Array} Array of { year_id (optional), year_label, opening, interest, principal, payment, closing }
 */
export function aggregateAllYears(monthlySchedule, yearSettings, startYear) {
    if (!monthlySchedule || monthlySchedule.length === 0) return [];

    const summaryMap = new Map(); // Key: FY Label (e.g. "FY 2024-25")

    // Helper to get FY from "Mon YYYY"
    const getFY = (periodLabel) => {
        const parts = periodLabel.split(' ');
        if (parts.length !== 2) return null;
        const month = parts[0];
        const year = parseInt(parts[1]);

        let fyStart = year;
        if (['Jan', 'Feb', 'Mar'].includes(month)) {
            fyStart = year - 1;
        }
        return `FY ${fyStart}-${(fyStart + 1).toString().slice(-2)}`;
    };

    monthlySchedule.forEach(month => {
        const fyLabel = getFY(month.period);
        if (fyLabel) {
            if (!summaryMap.has(fyLabel)) {
                summaryMap.set(fyLabel, {
                    year_label: fyLabel,
                    opening_balance: 0, // Will set from first month
                    interest: 0,
                    principal: 0,
                    payment: 0,
                    closing_balance: 0
                });
            }

            const data = summaryMap.get(fyLabel);

            // Set opening balance from the first month encountered for this FY
            if (data.opening_balance === 0 && data.interest === 0 && data.principal === 0) {
                data.opening_balance = month.opening;
            }

            data.interest += month.interest;
            data.principal += month.principal;
            data.payment += month.payment;
            data.closing_balance = month.closing; // Always update closing
        }
    });

    // Convert to array and try to match with yearSettings IDs
    const result = Array.from(summaryMap.values()).map(item => {
        // Try to find matching year ID
        // fyLabel is "FY 2024-25". yearSettings has year (2024) and year_display ("2024-2025" or similar)
        // We extract 2024 from "FY 2024-25"
        const fyStart = parseInt(item.year_label.split(' ')[1].split('-')[0]);
        const setting = yearSettings.find(y => parseInt(y.year) === fyStart);

        return {
            year_id: setting ? setting.id : null,
            year_label: item.year_label,
            start_year: fyStart, // Added for sorting
            opening_balance: parseFloat(item.opening_balance.toFixed(2)),
            annual_interest: parseFloat(item.interest.toFixed(2)),
            annual_principal: parseFloat(item.principal.toFixed(2)),
            closing_balance: parseFloat(item.closing_balance.toFixed(2)),
            calculated_emi: parseFloat((item.payment / 12).toFixed(2)) // Approximate monthly EMI from annual payment
        };
    });

    // Sort by start_year
    return result.sort((a, b) => a.start_year - b.start_year);
}

/**
 * Helper to format currency for display
 * @param {number} amount 
 * @returns {string}
 * @deprecated Use the one in common.jsx or PreviewPage if possible, but kept here for standalone usage
 */
export function formatCurrency(amount) {
    return parseFloat(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}
