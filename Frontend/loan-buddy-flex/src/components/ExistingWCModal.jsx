import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/apiClient.js';

export function ExistingWCModal({ isOpen, onClose, reportId, onSave }) {
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newLoan, setNewLoan] = useState({
        bank_name: '',
        sanctioned_amount: '',
        interest_rate: 10.00
    });

    useEffect(() => {
        if (isOpen && reportId) {
            loadLoans();
        }
    }, [isOpen, reportId]);

    const loadLoans = async () => {
        setLoading(true);
        try {
            const data = await apiClient.getExistingWCLoans(reportId);
            setLoans(data);
        } catch (error) {
            console.error("Failed to load WC loans:", error);
        }
        setLoading(false);
    };

    const handleAdd = async () => {
        if (!newLoan.bank_name || !newLoan.sanctioned_amount) return;

        try {
            await apiClient.createExistingWCLoan({
                ...newLoan,
                report: reportId
            });
            setNewLoan({
                bank_name: '',
                sanctioned_amount: '',
                interest_rate: 10.00
            });
            await loadLoans();
            onSave(); // Trigger parent update
        } catch (error) {
            console.error("Failed to add loan:", error);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Delete this loan?")) return;
        try {
            await apiClient.deleteExistingWCLoan(id);
            await loadLoans();
            onSave(); // Trigger parent update
        } catch (error) {
            console.error("Failed to delete loan:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">Manage Existing Working Capital Loans</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {/* Add New Loan Form */}
                    <div className="bg-blue-50 p-4 rounded-lg mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Bank Name</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={newLoan.bank_name}
                                onChange={e => setNewLoan({ ...newLoan, bank_name: e.target.value })}
                                placeholder="e.g. HDFC Bank"
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Limit Amount</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 text-sm"
                                value={newLoan.sanctioned_amount}
                                onChange={e => setNewLoan({ ...newLoan, sanctioned_amount: e.target.value })}
                                placeholder="Amount"
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Interest Rate %</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 text-sm"
                                value={newLoan.interest_rate}
                                onChange={e => setNewLoan({ ...newLoan, interest_rate: e.target.value })}
                                placeholder="%"
                            />
                        </div>
                        <div className="md:col-span-1">
                            <button
                                onClick={handleAdd}
                                className="w-full bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 text-sm font-bold"
                            >
                                Add Loan
                            </button>
                        </div>
                    </div>

                    {/* Loan List */}
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">Loading loans...</div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bank</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Limit</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                                    <th className="px-4 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {loans.map(loan => (
                                    <tr key={loan.id}>
                                        <td className="px-4 py-2 text-sm text-gray-900 font-medium">{loan.bank_name}</td>
                                        <td className="px-4 py-2 text-sm text-right font-mono">₹{parseFloat(loan.sanctioned_amount).toLocaleString('en-IN')}</td>
                                        <td className="px-4 py-2 text-sm text-right">{loan.interest_rate}%</td>
                                        <td className="px-4 py-2 text-right">
                                            <button
                                                onClick={() => handleDelete(loan.id)}
                                                className="text-red-500 hover:text-red-700 text-sm"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {loans.length === 0 && (
                                    <tr>
                                        <td colSpan="4" className="px-4 py-8 text-center text-gray-500 italic">
                                            No existing working capital loans added.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="p-6 border-t bg-gray-50 text-right">
                    <button
                        onClick={onClose}
                        className="bg-gray-800 text-white px-6 py-2 rounded hover:bg-gray-900"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
