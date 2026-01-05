import React, { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { Modal, Input } from '@/components/common.jsx';
import { generateLoanSchedule, aggregateAllYears } from '../../services/loanCalculations.js';

// --- 4. Existing Loans Page ---
export function ExistingLoansPage() {
    const { currentReport } = useContext(AppContext);
    const [loans, setLoans] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newLoan, setNewLoan] = useState({
        loan_name: 'Existing Loan',
        start_date: '',
        original_amount: 0,
        interest_rate: 10,
        tenure_months: 60,
        repayment_method: 'EMI',
        // Legacy fields (calculated or manual override)
        outstanding_amount: 0,
        emi: 0,
        remaining_tenure_years: 0
    });
    const [schedule, setSchedule] = useState([]);
    const [showSchedule, setShowSchedule] = useState(false);

    const [editingLoanId, setEditingLoanId] = useState(null);

    const fetchLoans = useCallback(async () => {
        const data = await apiClient.getTermLoans(currentReport.id);
        setLoans(data);
    }, [currentReport.id]);

    useEffect(() => { fetchLoans(); }, [fetchLoans]);

    // Auto-calculate schedule when inputs change
    useEffect(() => {
        if (newLoan.original_amount > 0 && newLoan.tenure_months > 0 && newLoan.start_date) {
            const generatedSchedule = generateLoanSchedule({
                loanAmount: parseFloat(newLoan.original_amount),
                interestRate: parseFloat(newLoan.interest_rate),
                tenureMonths: parseInt(newLoan.tenure_months),
                moratoriumMonths: 0, // Assuming no moratorium for existing loans for now
                repaymentMethod: newLoan.repayment_method,
                startDate: newLoan.start_date
            });
            setSchedule(generatedSchedule);

            // Auto-fill legacy fields based on current status (approximate)
            // Ideally we find the balance as of the report start date
            // For now, just setting EMI from the first installment
            if (generatedSchedule.length > 0) {
                setNewLoan(prev => ({ ...prev, emi: generatedSchedule[0].payment }));
            }
        }
    }, [newLoan.original_amount, newLoan.interest_rate, newLoan.tenure_months, newLoan.start_date, newLoan.repayment_method]);

    const handleEdit = (loan) => {
        setEditingLoanId(loan.id);
        setNewLoan({
            loan_name: loan.loan_name,
            start_date: loan.start_date,
            original_amount: loan.original_amount,
            interest_rate: loan.interest_rate,
            tenure_months: loan.tenure_months,
            repayment_method: loan.repayment_method || 'EMI',
            outstanding_amount: loan.outstanding_amount,
            emi: loan.emi,
            remaining_tenure_years: loan.remaining_tenure_years
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();

        // 1. Generate Schedule (if not already)
        let finalSchedule = schedule;
        if (finalSchedule.length === 0) {
            finalSchedule = generateLoanSchedule({
                loanAmount: parseFloat(newLoan.original_amount),
                interestRate: parseFloat(newLoan.interest_rate),
                tenureMonths: parseInt(newLoan.tenure_months),
                moratoriumMonths: 0,
                repaymentMethod: newLoan.repayment_method,
                startDate: newLoan.start_date
            });
        }

        // 2. Aggregate by Year
        // We need the year settings to map correctly
        const yearSettings = await apiClient.getYearSettings(currentReport.id);
        const yearlySummary = aggregateAllYears(finalSchedule, yearSettings);

        // 3. Prepare Payload
        // We calculate outstanding amount based on the start of the report
        let calculatedOutstanding = 0;
        let calculatedRemainingTenure = 0;

        // We NO LONGER filter validSummaries by year_id !== null
        // We want to save ALL summaries, even future ones.
        const validSummaries = yearlySummary;

        // Find the summary for the first report year to get the correct opening balance
        const startYearId = yearSettings.length > 0 ? yearSettings[0].id : null;
        const startYearSummary = validSummaries.find(s => s.year_id === startYearId);

        if (startYearSummary) {
            calculatedOutstanding = startYearSummary.opening_balance;
        }

        if (validSummaries.length > 0) {
            // Rough estimate of remaining tenure based on years with balance > 0
            calculatedRemainingTenure = Math.ceil(validSummaries.filter(y => y.closing_balance > 0).length);
        }

        const payload = {
            ...newLoan,
            report: currentReport.id,
            outstanding_amount: calculatedOutstanding, // Update with calculated value
            remaining_tenure_years: calculatedRemainingTenure,
            yearly_summary: validSummaries.map(s => ({
                year_setting_id: s.year_id, // Can be null now
                year_label: s.year_label,   // Added year_label
                opening_balance: s.opening_balance,
                annual_interest: s.annual_interest,
                annual_principal: s.annual_principal,
                closing_balance: s.closing_balance,
                calculated_emi: s.payment || 0
            }))
        };

        if (editingLoanId) {
            await apiClient.updateTermLoan(editingLoanId, payload);
        } else {
            await apiClient.createTermLoan(payload);
        }

        setIsModalOpen(false);
        setEditingLoanId(null);
        fetchLoans();
    };

    const handleDelete = async (id) => {
        if (confirm("Delete?")) { await apiClient.deleteTermLoan(id); fetchLoans(); }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Existing Term Loans</h2>
                <button onClick={() => {
                    setEditingLoanId(null);
                    setNewLoan({
                        loan_name: 'Existing Loan',
                        start_date: '',
                        original_amount: 0,
                        interest_rate: 10,
                        tenure_months: 60,
                        repayment_method: 'EMI',
                        outstanding_amount: 0,
                        emi: 0,
                        remaining_tenure_years: 0
                    });
                    setSchedule([]);
                    setIsModalOpen(true);
                }} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">+ Add Loan</button>
            </div>

            <div className="grid gap-4">
                {loans.map(loan => (
                    <div key={loan.id} className="bg-white p-4 shadow rounded border border-gray-200 flex justify-between items-center">
                        <div>
                            <h3 className="font-bold">{loan.loan_name}</h3>
                            <p className="text-sm text-gray-600">Original: ₹{parseFloat(loan.original_amount || 0).toLocaleString('en-IN')} | Start: {loan.start_date}</p>
                            <p className="text-xs text-gray-500">{loan.tenure_months} Months @ {loan.interest_rate}%</p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => handleEdit(loan)} className="text-blue-600 hover:text-blue-800">Edit</button>
                            <button onClick={() => handleDelete(loan.id)} className="text-red-500 hover:text-red-700">Delete</button>
                        </div>
                    </div>
                ))}
                {loans.length === 0 && <p className="text-gray-500 text-center py-8">No existing loans found.</p>}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingLoanId ? "Edit Loan" : "Add Existing Loan"}>
                <form onSubmit={handleSave} className="space-y-4">
                    <Input label="Bank/Loan Name" value={newLoan.loan_name} onChange={e => setNewLoan({ ...newLoan, loan_name: e.target.value })} required />

                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Start Date" type="date" value={newLoan.start_date} onChange={e => setNewLoan({ ...newLoan, start_date: e.target.value })} required />
                        <Input label="Original Amount" type="number" value={newLoan.original_amount} onChange={e => setNewLoan({ ...newLoan, original_amount: e.target.value })} required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Interest Rate (%)" type="number" step="0.01" value={newLoan.interest_rate} onChange={e => setNewLoan({ ...newLoan, interest_rate: e.target.value })} required />
                        <Input label="Tenure (Months)" type="number" value={newLoan.tenure_months} onChange={e => setNewLoan({ ...newLoan, tenure_months: e.target.value })} required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Repayment Method</label>
                        <select
                            value={newLoan.repayment_method}
                            onChange={e => setNewLoan({ ...newLoan, repayment_method: e.target.value })}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="EMI">Reducing Balance (EMI)</option>
                            <option value="BULLET">Bullet Repayment</option>
                        </select>
                    </div>

                    {/* Schedule Preview Toggle */}
                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={() => setShowSchedule(!showSchedule)}
                            className="text-blue-600 text-sm hover:underline"
                        >
                            {showSchedule ? 'Hide Schedule' : 'Show Schedule Preview'}
                        </button>
                    </div>

                    {/* Schedule Table */}
                    {showSchedule && schedule.length > 0 && (
                        <div className="mt-4 max-h-60 overflow-y-auto border rounded">
                            <table className="min-w-full text-xs text-left">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-2 py-1">Month</th>
                                        <th className="px-2 py-1">Date</th>
                                        <th className="px-2 py-1">EMI</th>
                                        <th className="px-2 py-1">Interest</th>
                                        <th className="px-2 py-1">Principal</th>
                                        <th className="px-2 py-1">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {schedule.map((row, idx) => (
                                        <tr key={idx} className="border-t">
                                            <td className="px-2 py-1">{row.period}</td>
                                            <td className="px-2 py-1">
                                                {row.date ? new Date(row.date).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-2 py-1">{Math.round(row.payment)}</td>
                                            <td className="px-2 py-1">{Math.round(row.interest)}</td>
                                            <td className="px-2 py-1">{Math.round(row.principal)}</td>
                                            <td className="px-2 py-1">{Math.round(row.closing)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 mt-4">{editingLoanId ? "Update Loan" : "Save Loan"}</button>
                </form>
            </Modal>
        </div>
    );
}
