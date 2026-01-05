import React, { useState, useEffect, useContext } from 'react';
import { apiClient } from '@/services/apiClient.js';
import { calculateEMI, generateLoanSchedule, formatCurrency, aggregateAllYears } from '@/services/loanCalculations.js';
import { AppContext } from '@/pages/project-report/ProjectReportApp.jsx';

export function LoanScheduleModal({ isOpen, onClose, reportId, yearSettings, totalLoanRequired, onSave }) {
    const { currentReport } = useContext(AppContext);
    const [loading, setLoading] = useState(false);
    const [existingSchedule, setExistingSchedule] = useState(null);
    const [loanConfig, setLoanConfig] = useState({
        loanAmount: totalLoanRequired || 0,
        interestRate: 12.0,
        tenureMonths: 60,
        moratoriumMonths: 6,
        repaymentMethod: 'EMI',
        startYearId: yearSettings?.[0]?.id || null,
        startDate: null // New field
    });
    const [monthlySchedule, setMonthlySchedule] = useState([]);
    const [showMonthlySchedule, setShowMonthlySchedule] = useState(false);
    const [viewMode, setViewMode] = useState('yearly'); // 'monthly' or 'yearly'

    // Load existing loan schedule if any, or populate from currentReport
    useEffect(() => {
        if (isOpen && reportId) {
            loadExistingSchedule();
        }
    }, [isOpen, reportId, currentReport, totalLoanRequired]); // Added dependencies to refresh when these change

    // Helper function to determine which Financial Year a date falls into
    const getFYFromDate = (dateString) => {
        if (!dateString) return null;
        const date = new Date(dateString);
        const month = date.getMonth(); // 0-indexed (0 = January, 11 = December)
        const year = date.getFullYear();

        // Financial Year runs from April (month 3) to March (month 2)
        // If month is Jan-Mar (0-2), FY started in previous calendar year
        // If month is Apr-Dec (3-11), FY started in current calendar year
        const fyStartYear = month >= 3 ? year : year - 1;

        return fyStartYear;
    };

    // Auto-update startYearId when startDate changes
    useEffect(() => {
        if (loanConfig.startDate && yearSettings && yearSettings.length > 0) {
            const fyStartYear = getFYFromDate(loanConfig.startDate);
            if (fyStartYear) {
                const matchingYearSetting = yearSettings.find(y => y.year === fyStartYear);
                if (matchingYearSetting && matchingYearSetting.id !== loanConfig.startYearId) {

                    setLoanConfig(prev => ({
                        ...prev,
                        startYearId: matchingYearSetting.id
                    }));
                }
            }
        }
    }, [loanConfig.startDate, yearSettings]);

    // Generate preview schedule when config changes
    useEffect(() => {
        if (loanConfig.loanAmount > 0 && loanConfig.tenureMonths > 0) {
            const schedule = generateLoanSchedule({
                loanAmount: loanConfig.loanAmount,
                interestRate: loanConfig.interestRate,
                tenureMonths: loanConfig.tenureMonths,
                moratoriumMonths: loanConfig.moratoriumMonths,
                repaymentMethod: loanConfig.repaymentMethod,
                startDate: loanConfig.startDate // Pass start date
            });
            setMonthlySchedule(schedule);
        }
    }, [loanConfig]);

    const loadExistingSchedule = async () => {
        setLoading(true);
        try {
            const schedules = await apiClient.getLoanSchedules(reportId);
            if (schedules && schedules.length > 0) {
                const schedule = schedules[0];
                setExistingSchedule(schedule);

                // Populate from existing schedule
                setLoanConfig({
                    loanAmount: parseFloat(schedule.loan_amount),
                    interestRate: parseFloat(schedule.interest_rate),
                    tenureMonths: schedule.tenure_months,
                    moratoriumMonths: schedule.moratorium_months,
                    repaymentMethod: schedule.repayment_method,
                    startYearId: schedule.start_year.id,
                    startDate: currentReport?.new_loan_start_date // Always take date from project setup as it's the source of truth
                });
            } else {
                setExistingSchedule(null);
                // No existing schedule, populate from currentReport
                if (currentReport) {
                    const startYearSetting = yearSettings?.find(y => y.year === currentReport.start_year) || yearSettings?.[0];
                    const config = {
                        loanAmount: totalLoanRequired || 0,
                        interestRate: parseFloat(currentReport.new_loan_interest_rate || 12),
                        tenureMonths: (parseInt(currentReport.new_loan_tenure_years || 5)) * 12,
                        moratoriumMonths: parseInt(currentReport.new_loan_moratorium_months || 6),
                        repaymentMethod: 'EMI',
                        startYearId: startYearSetting?.id || yearSettings?.[0]?.id,
                        startDate: currentReport.new_loan_start_date // Populate from Project Setup
                    };

                    setLoanConfig(config);
                }
            }
        } catch (error) {
            console.error("Failed to load loan schedule:", error);
            setExistingSchedule(null);
        }
        setLoading(false);
    };

    const handleSave = async () => {
        if (!loanConfig.loanAmount || loanConfig.loanAmount <= 0) {
            alert("Please enter a valid loan amount");
            return;
        }

        if (!loanConfig.startYearId) {
            alert("Please select a start year");
            return;
        }

        setLoading(true);
        try {
            // Generate the schedule first to get the summary
            // Generate the schedule first to get the summary
            const schedule = generateLoanSchedule({
                loanAmount: loanConfig.loanAmount,
                interestRate: loanConfig.interestRate,
                tenureMonths: loanConfig.tenureMonths,
                moratoriumMonths: loanConfig.moratoriumMonths,
                repaymentMethod: loanConfig.repaymentMethod,
                startDate: loanConfig.startDate
            });

            const yearlySummary = aggregateAllYears(schedule, yearSettings, null);

            // Align payload structure with ExistingLoansPage
            const validSummaries = yearlySummary.map(s => ({
                year_setting_id: s.year_id, // Can be null for future years
                year_label: s.year_label,
                opening_balance: s.opening_balance,
                annual_interest: s.annual_interest,
                annual_principal: s.annual_principal,
                closing_balance: s.closing_balance,
                calculated_emi: s.calculated_emi || 0
            }));

            const payload = {
                report: reportId,
                loan_amount: loanConfig.loanAmount,
                interest_rate: loanConfig.interestRate,
                tenure_months: loanConfig.tenureMonths,
                moratorium_months: loanConfig.moratoriumMonths,
                repayment_method: loanConfig.repaymentMethod,
                start_year_id: loanConfig.startYearId,
                yearly_summary: validSummaries // Include the full summary with aligned structure
            };

            if (existingSchedule) {
                await apiClient.updateLoanSchedule(existingSchedule.id, payload);
            } else {
                await apiClient.createLoanSchedule(payload);
            }

            onSave(); // Trigger parent refresh
            onClose();
        } catch (error) {
            console.error("Failed to save loan schedule:", error);
            alert("Failed to save loan schedule. Please try again.");
        }
        setLoading(false);
    };

    const handleDelete = async () => {
        if (!existingSchedule) return;
        if (!confirm("Delete this loan schedule?")) return;

        setLoading(true);
        try {
            await apiClient.deleteLoanSchedule(existingSchedule.id);
            setExistingSchedule(null);
            onSave();
            onClose();
        } catch (error) {
            console.error("Failed to delete loan schedule:", error);
            alert("Failed to delete loan schedule.");
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    const emi = loanConfig.tenureMonths > loanConfig.moratoriumMonths
        ? calculateEMI(loanConfig.loanAmount, loanConfig.interestRate, loanConfig.tenureMonths - loanConfig.moratoriumMonths)
        : 0;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">Loan Schedule Configuration</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {/* Configuration Form */}
                    <div className="bg-blue-50 p-4 rounded-lg mb-6">
                        <h3 className="font-semibold text-gray-700 mb-4">Loan Configuration</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Loan Amount (₹)
                                    {totalLoanRequired > 0 && <span className="text-xs text-gray-500 ml-1">(from Project Cost)</span>}
                                </label>
                                <input
                                    type="number"
                                    className="w-full border rounded p-2"
                                    value={loanConfig.loanAmount}
                                    onChange={e => setLoanConfig({ ...loanConfig, loanAmount: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Interest Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    className="w-full border rounded p-2"
                                    value={loanConfig.interestRate}
                                    onChange={e => setLoanConfig({ ...loanConfig, interestRate: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tenure (Months)</label>
                                <input
                                    type="number"
                                    className="w-full border rounded p-2"
                                    value={loanConfig.tenureMonths}
                                    onChange={e => setLoanConfig({ ...loanConfig, tenureMonths: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Moratorium (Months)</label>
                                <input
                                    type="number"
                                    className="w-full border rounded p-2"
                                    value={loanConfig.moratoriumMonths}
                                    onChange={e => setLoanConfig({ ...loanConfig, moratoriumMonths: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Repayment Method</label>
                                <select
                                    className="w-full border rounded p-2"
                                    value={loanConfig.repaymentMethod}
                                    onChange={e => setLoanConfig({ ...loanConfig, repaymentMethod: e.target.value })}
                                >
                                    <option value="EMI">EMI (Reducing Balance)</option>
                                    <option value="BULLET">Bullet Repayment</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Year</label>
                                <select
                                    className="w-full border rounded p-2"
                                    value={loanConfig.startYearId || ''}
                                    onChange={e => setLoanConfig({ ...loanConfig, startYearId: parseInt(e.target.value) })}
                                >
                                    {yearSettings?.map(y => (
                                        <option key={y.id} value={y.id}>{y.year_display}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Loan Start Date
                                    <span className="text-xs text-gray-500 ml-1">(from Project Setup)</span>
                                </label>
                                <input
                                    type="date"
                                    className="w-full border rounded p-2 bg-gray-100 text-gray-600 cursor-not-allowed"
                                    value={loanConfig.startDate || ''}
                                    readOnly
                                    title="To change this date, go to Project Setup page"
                                />
                            </div>
                        </div>

                        {/* Calculated EMI Display */}
                        {emi > 0 && (
                            <div className="mt-4 p-3 bg-white rounded border border-blue-200">
                                <span className="text-sm font-medium text-gray-700">Calculated Monthly EMI: </span>
                                <span className="text-lg font-bold text-blue-600">₹{formatCurrency(emi)}</span>
                            </div>
                        )}
                    </div>

                    {/* Schedule Preview Toggle */}
                    <div className="mb-4 flex items-center justify-between">
                        <div className="flex space-x-4">
                            <button
                                onClick={() => setShowMonthlySchedule(!showMonthlySchedule)}
                                className="text-blue-600 hover:text-blue-800 font-medium text-sm flex items-center"
                            >
                                {showMonthlySchedule ? '▼ Hide' : '▶ Show'} Schedule Preview
                            </button>

                            {showMonthlySchedule && (
                                <div className="flex bg-gray-100 rounded p-1">
                                    <button
                                        onClick={() => setViewMode('monthly')}
                                        className={`px-3 py-1 text-xs rounded ${viewMode === 'monthly' ? 'bg-white shadow text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        Monthly
                                    </button>
                                    <button
                                        onClick={() => setViewMode('yearly')}
                                        className={`px-3 py-1 text-xs rounded ${viewMode === 'yearly' ? 'bg-white shadow text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        Year Wise
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Schedule Table */}
                    {showMonthlySchedule && monthlySchedule.length > 0 && (
                        <div className="overflow-x-auto border rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Period</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Opening</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Interest</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Principal</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Payment</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase sticky top-0 bg-gray-50">Closing</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {viewMode === 'monthly' ? (
                                        // MONTHLY VIEW
                                        monthlySchedule.map(month => {
                                            // Try to format period if it's just a number
                                            let displayPeriod = month.period;
                                            if (typeof month.period === 'number') {
                                                const startYearObj = yearSettings?.find(y => y.id === loanConfig.startYearId);
                                                const startYear = startYearObj ? parseInt(startYearObj.year) : new Date().getFullYear();
                                                const totalMonths = month.period - 1;
                                                const yearsToAdd = Math.floor(totalMonths / 12);
                                                const monthIndex = totalMonths % 12;
                                                const monthNames = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
                                                // If month is Jan-Mar, it's next calendar year
                                                const calendarYear = monthIndex >= 9 ? startYear + yearsToAdd + 1 : startYear + yearsToAdd;
                                                displayPeriod = `${monthNames[monthIndex]} ${calendarYear}`;
                                            }

                                            return (
                                                <tr key={month.period} className="hover:bg-gray-50">
                                                    <td className="px-3 py-2">{displayPeriod}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(month.opening)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(month.interest)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(month.principal)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-semibold">₹{formatCurrency(month.payment)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(month.closing)}</td>
                                                </tr>
                                            );
                                        })
                                    ) : (
                                        // YEARLY VIEW
                                        (() => {
                                            // If we have an existing schedule with year_summaries, use those directly
                                            if (existingSchedule?.year_summaries && existingSchedule.year_summaries.length > 0) {
                                                // Sort summaries by year
                                                const sortedSummaries = [...existingSchedule.year_summaries].sort((a, b) => {
                                                    const getStartYear = (lbl) => {
                                                        if (!lbl) return 0;
                                                        const match = lbl.match(/(\d{4})/);
                                                        return match ? parseInt(match[1]) : 0;
                                                    };
                                                    const labelA = a.year_label || a.year_setting?.year_display || "";
                                                    const labelB = b.year_label || b.year_setting?.year_display || "";
                                                    return getStartYear(labelA) - getStartYear(labelB);
                                                });

                                                return sortedSummaries.map(summary => (
                                                    <tr key={summary.id || summary.year_setting?.id || Math.random()} className="hover:bg-blue-50 font-medium">
                                                        <td className="px-3 py-2 text-blue-800">{summary.year_label || summary.year_setting?.year_display || 'Year'}</td>
                                                        <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(parseFloat(summary.opening_balance))}</td>
                                                        <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(parseFloat(summary.annual_interest))}</td>
                                                        <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(parseFloat(summary.annual_principal))}</td>
                                                        <td className="px-3 py-2 text-right font-mono font-bold">₹{formatCurrency(parseFloat(summary.calculated_emi) * 12)}</td>
                                                        <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(parseFloat(summary.closing_balance))}</td>
                                                    </tr>
                                                ));
                                            }

                                            // Otherwise, aggregate from monthly schedule
                                            const yearlyData = [];
                                            let currentYear = null;
                                            let yearSummary = null;

                                            const startYearObj = yearSettings?.find(y => y.id === loanConfig.startYearId);
                                            const baseYear = startYearObj ? parseInt(startYearObj.year) : new Date().getFullYear();

                                            monthlySchedule.forEach((month) => {
                                                let fyLabel;

                                                if (typeof month.period === 'number') {
                                                    // Period is 1, 2, 3...
                                                    // Assuming starts from April of baseYear
                                                    const fyStart = baseYear + Math.floor((month.period - 1) / 12);
                                                    fyLabel = `FY ${fyStart}-${(fyStart + 1).toString().slice(-2)}`;
                                                } else {
                                                    // Period is string "Apr 2024"
                                                    const periodParts = month.period.split(' ');
                                                    const monthName = periodParts[0];
                                                    const year = parseInt(periodParts[1]);

                                                    // Standard month names: Jan=0, ..., Dec=11
                                                    const standardMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                                    const monthIndex = standardMonths.indexOf(monthName);

                                                    let fyStart = year;
                                                    if (monthIndex >= 0 && monthIndex <= 2) { // Jan, Feb, Mar
                                                        fyStart = year - 1;
                                                    }
                                                    fyLabel = `FY ${fyStart}-${(fyStart + 1).toString().slice(-2)}`;
                                                }

                                                if (currentYear !== fyLabel) {
                                                    if (yearSummary) yearlyData.push(yearSummary);
                                                    currentYear = fyLabel;
                                                    yearSummary = {
                                                        period: fyLabel,
                                                        opening: month.opening, // Opening of first month
                                                        interest: 0,
                                                        principal: 0,
                                                        payment: 0,
                                                        closing: 0
                                                    };
                                                }

                                                yearSummary.interest += month.interest;
                                                yearSummary.principal += month.principal;
                                                yearSummary.payment += month.payment;
                                                yearSummary.closing = month.closing; // Closing of last month
                                            });
                                            if (yearSummary) yearlyData.push(yearSummary);

                                            return yearlyData.map(year => (
                                                <tr key={year.period} className="hover:bg-blue-50 font-medium">
                                                    <td className="px-3 py-2 text-blue-800">{year.period}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(year.opening)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(year.interest)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(year.principal)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold">₹{formatCurrency(year.payment)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">₹{formatCurrency(year.closing)}</td>
                                                </tr>
                                            ));
                                        })()
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t bg-gray-50 flex justify-between">
                    <div>
                        {existingSchedule && (
                            <button
                                onClick={handleDelete}
                                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                                disabled={loading}
                            >
                                Delete Schedule
                            </button>
                        )}
                    </div>
                    <div className="space-x-2">
                        <button
                            onClick={onClose}
                            className="bg-gray-300 text-gray-700 px-6 py-2 rounded hover:bg-gray-400"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
                            disabled={loading}
                        >
                            {loading ? 'Saving...' : existingSchedule ? 'Update Schedule' : 'Create Schedule'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
