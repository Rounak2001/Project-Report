import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { Input, Select, Alert } from '@/components/common.jsx';
import { useNavigate } from 'react-router-dom';
import { ExistingWCModal } from '@/components/ExistingWCModal.jsx';

// --- Helper: Formatted Date for Date Inputs ---
const toInputDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
};

const DEPRECIATION_RATES = {
    'Land': 0,
    'Building': 10,
    'Machinery': 15,
    'Computers': 40,
    'Furniture': 10,
    'Vehicle': 15,
    'Other': 15
};

// --- 3. Project & Loan Setup Page ---
export function ProjectSetupPage() {
    const { currentReport, updateCurrentReport, reloadFinancialData } = useContext(AppContext);
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        ...currentReport,
        new_loan_start_date: toInputDate(currentReport.new_loan_start_date),
        wc_requirement_type: currentReport.wc_requirement_type || 'new',
        existing_wc_limit: currentReport.existing_wc_limit || 0,
        existing_wc_interest_rate: currentReport.existing_wc_interest_rate || 10,
        proposed_wc_limit: currentReport.proposed_wc_limit || 0,
        proposed_wc_interest_rate: currentReport.proposed_wc_interest_rate || 10
    });
    const [costItems, setCostItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    // Existing WC State
    const [isWCModalOpen, setIsWCModalOpen] = useState(false);
    const [existingWCLoans, setExistingWCLoans] = useState([]);

    // New Asset Form
    const [newCost, setNewCost] = useState({ asset_type: 'Machinery', asset_name: '', amount: 0, depreciation_rate: 15.00 });

    // Load Initial Data
    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await apiClient.getProjectCosts(currentReport.id);
                // Filter to show ONLY "New Assets" (is_existing_asset = false)
                // This hides "Existing Assets" added via the Modal
                setCostItems(data.filter(item => !item.is_existing_asset));

                // Check for existing loans to sync the toggle
                const loans = await apiClient.getTermLoans(currentReport.id);
                if (loans && loans.length > 0) {
                    setFormData(prev => {
                        if (prev.has_existing_term_loan !== true) {
                            return { ...prev, has_existing_term_loan: true };
                        }
                        return prev;
                    });
                }

                // Fetch Existing WC Loans
                const wcLoans = await apiClient.getExistingWCLoans(currentReport.id);
                setExistingWCLoans(wcLoans || []);

            } catch (err) { console.error(err); }
        };
        loadData();
    }, [currentReport.id]);

    // Update formData.existing_wc_limit when existingWCLoans changes
    useEffect(() => {
        if (existingWCLoans.length > 0) {
            const totalLimit = existingWCLoans.reduce((sum, loan) => sum + parseFloat(loan.sanctioned_amount || 0), 0);
            setFormData(prev => ({ ...prev, existing_wc_limit: totalLimit }));
        }
    }, [existingWCLoans]);

    const handleSettingsChange = (e) => {
        const { name, value, type, checked } = e.target;
        // Radio button fix: value comes as string "true"/"false"
        let val = value;
        if (name === "has_existing_term_loan") val = value === 'true';
        else if (type === 'checkbox') val = checked;

        setFormData(prev => ({ ...prev, [name]: val }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const updated = await apiClient.updateReport(currentReport.id, formData);
            updateCurrentReport(updated);
            // Reloading financial data ensures the columns (years) are updated if start_year changed
            await reloadFinancialData(currentReport.id);
            setMessage({ type: 'success', text: 'Settings saved!' });
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to save settings.' });
        }
        setLoading(false);
        setTimeout(() => setMessage(null), 3000);
    };

    const handleAddAsset = async (e) => {
        e.preventDefault();
        try {
            // Logic for "Other" asset type name
            const payload = { ...newCost, report: currentReport.id, is_existing_asset: false };
            if (payload.asset_type !== 'Other') payload.asset_name = payload.asset_type;

            await apiClient.createProjectCostItem(payload);
            const updatedCosts = await apiClient.getProjectCosts(currentReport.id);
            setCostItems(updatedCosts.filter(item => !item.is_existing_asset));
            setNewCost({ asset_type: 'Machinery', asset_name: '', amount: 0, depreciation_rate: 15.00 });
        } catch (err) { console.error(err); }
    };

    const handleDeleteAsset = async (id) => {
        if (!confirm("Delete this asset?")) return;
        try {
            await apiClient.deleteProjectCostItem(id);
            const updatedCosts = await apiClient.getProjectCosts(currentReport.id);
            setCostItems(updatedCosts.filter(item => !item.is_existing_asset));
        } catch (err) { console.error(err); }
    };

    const handleWCSave = async () => {
        // Refresh the list
        const wcLoans = await apiClient.getExistingWCLoans(currentReport.id);
        setExistingWCLoans(wcLoans || []);
    };

    // Calculations
    const totalProjectCost = useMemo(() => costItems.reduce((acc, i) => acc + parseFloat(i.amount), 0), [costItems]);
    const contribution = totalProjectCost * (parseFloat(formData.new_loan_contribution_percent || 0) / 100);
    const termLoanAmount = totalProjectCost - contribution;

    const totalExistingWCLimit = existingWCLoans.reduce((sum, loan) => sum + parseFloat(loan.sanctioned_amount || 0), 0);

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8">
            <Alert type={message?.type} message={message?.text} />

            {/* --- Form 1: Project Settings --- */}
            <form onSubmit={handleSaveSettings} className="bg-white p-8 shadow rounded-lg border border-gray-200">
                <h2 className="text-xl font-semibold mb-6 text-gray-900 border-b pb-4">Project & Loan Setup</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* First Financial Year - Read Only */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">First Financial Year</label>
                        <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-900">
                            {formData.start_year}
                        </div>
                    </div>

                    {/* Total Report Years - Read Only */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Total Report Years</label>
                        <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-900">
                            {formData.total_years_in_report}
                        </div>
                    </div>

                    <Select label="Tax Regime" name="tax_regime" value={formData.tax_regime || 'domestic_22'} onChange={handleSettingsChange} className="md:col-span-2">
                        <option value="domestic_22">Domestic Company (22% + Surcharge + Cess)</option>
                        <option value="llp">LLP (30% + Surcharge + Cess)</option>
                        <option value="proprietorship">Proprietorship (New Regime Slabs)</option>
                    </Select>
                </div>

                {/* Existing Loans Toggle */}
                <div className="mb-8">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Do you have existing term loans?</label>
                    <div className="flex gap-4">
                        <label className="flex items-center"><input type="radio" name="has_existing_term_loan" value="true" checked={formData.has_existing_term_loan === true} onChange={handleSettingsChange} className="mr-2" /> Yes</label>
                        <label className="flex items-center"><input type="radio" name="has_existing_term_loan" value="false" checked={formData.has_existing_term_loan === false} onChange={handleSettingsChange} className="mr-2" /> No</label>
                    </div>
                    {formData.has_existing_term_loan && (
                        <button type="button" onClick={() => navigate(`/project-report/${currentReport.id}/existing-loans`)} className="mt-2 text-sm text-blue-600 hover:underline">Manage Existing Loans &rarr;</button>
                    )}
                </div>

                {/* New Loan Details */}
                <h3 className="text-lg font-medium text-gray-800 mb-4">New Loan / Limit Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Select label="Loan Type" name="new_loan_type" value={formData.new_loan_type} onChange={handleSettingsChange} className="md:col-span-2">
                        <option value="term">Term Loan Only</option>
                        <option value="wc">Working Capital Only</option>
                        <option value="both">Both Term Loan & Working Capital</option>
                    </Select>

                    {/* Term Loan Fields */}
                    {(formData.new_loan_type === 'term' || formData.new_loan_type === 'both') && (
                        <>
                            <div className="md:col-span-2 border-b pb-2 mb-2 mt-2 font-medium text-gray-600">Term Loan Configuration</div>
                            <Input label="Promoter Contribution (%)" name="new_loan_contribution_percent" type="number" step="0.01" value={formData.new_loan_contribution_percent} onChange={handleSettingsChange} />
                            <Input label="Interest Rate (%)" name="new_loan_interest_rate" type="number" step="0.01" value={formData.new_loan_interest_rate} onChange={handleSettingsChange} />
                            <Input label="Tenure (Years)" name="new_loan_tenure_years" type="number" value={formData.new_loan_tenure_years} onChange={handleSettingsChange} />
                            <Input label="Moratorium (Months)" name="new_loan_moratorium_months" type="number" value={formData.new_loan_moratorium_months} onChange={handleSettingsChange} />
                        </>
                    )}

                    {/* Working Capital Fields */}
                    {(formData.new_loan_type === 'wc' || formData.new_loan_type === 'both') && (
                        <>
                            <div className="md:col-span-2 border-b pb-2 mb-2 mt-2 font-medium text-gray-600">Working Capital Configuration</div>
                            <Select label="Requirement Type" name="wc_requirement_type" value={formData.wc_requirement_type} onChange={handleSettingsChange} className="md:col-span-2">
                                <option value="new">New Limit</option>
                                <option value="enhancement">Enhancement of Existing Limit</option>
                            </Select>

                            {/* Existing Limit (Only for Enhancement) */}
                            {formData.wc_requirement_type === 'enhancement' && (
                                <div className="md:col-span-2 bg-blue-50 p-4 rounded-lg border border-blue-100">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Existing Working Capital Limits</label>

                                    {existingWCLoans.length > 0 ? (
                                        <div className="mb-3">
                                            <div className="text-sm text-gray-600 mb-1">Total Existing Limit: <span className="font-bold text-gray-900">₹{totalExistingWCLimit.toLocaleString('en-IN')}</span></div>
                                            <div className="text-xs text-gray-500">{existingWCLoans.length} existing loan(s) added.</div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500 italic mb-3">No existing working capital loans added yet.</div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => setIsWCModalOpen(true)}
                                        className="text-sm bg-white border border-blue-300 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-50 shadow-sm"
                                    >
                                        Manage Existing WC Loans
                                    </button>
                                </div>
                            )}

                            {/* Proposed Limit (Always shown for WC) */}
                            <Input label={formData.wc_requirement_type === 'enhancement' ? "Additional / Proposed Limit (₹)" : "Proposed Limit (₹)"} name="proposed_wc_limit" type="number" value={formData.proposed_wc_limit} onChange={handleSettingsChange} />
                            <Input label="Proposed Interest Rate (%)" name="proposed_wc_interest_rate" type="number" step="0.01" value={formData.proposed_wc_interest_rate} onChange={handleSettingsChange} />
                        </>
                    )}

                    <div className="md:col-span-2 border-t pt-4 mt-2">
                        <Input label="Loan / Limit Start Date" name="new_loan_start_date" type="date" value={formData.new_loan_start_date} onChange={handleSettingsChange} />
                    </div>
                </div>

                <div className="mt-6 text-right">
                    <button type="submit" disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">{loading ? "Saving..." : "Save Settings"}</button>
                </div>
            </form>

            {/* --- Form 2: Details of Asset --- */}
            {(formData.new_loan_type === 'term' || formData.new_loan_type === 'both') && (
                <div className="bg-white p-8 shadow rounded-lg border border-gray-200">
                    <h2 className="text-xl font-semibold mb-6 text-gray-900 border-b pb-4">Details of Asset (Project Cost)</h2>

                    {/* Asset List */}
                    <table className="min-w-full divide-y divide-gray-200 mb-6">
                        <thead>
                            <tr>
                                <th className="text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                                <th className="text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                                <th className="text-right text-xs font-medium text-gray-500 uppercase">Depr. %</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {costItems.map(item => (
                                <tr key={item.id}>
                                    <td className="py-3 text-sm text-gray-900">{item.asset_name}</td>
                                    <td className="py-3 text-sm text-gray-900 text-right">₹{parseFloat(item.amount).toLocaleString('en-IN')}</td>
                                    <td className="py-3 text-sm text-gray-500 text-right">{item.depreciation_rate}%</td>
                                    <td className="py-3 text-right">
                                        <button onClick={() => handleDeleteAsset(item.id)} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Add Asset */}
                    <div className="bg-gray-50 p-4 rounded-lg grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <Select label="Type" value={newCost.asset_type} onChange={e => {
                            const type = e.target.value;
                            const rate = DEPRECIATION_RATES[type] !== undefined ? DEPRECIATION_RATES[type] : 15;
                            setNewCost({ ...newCost, asset_type: type, depreciation_rate: rate });
                        }}>
                            {Object.keys(DEPRECIATION_RATES).map(o => <option key={o} value={o}>{o}</option>)}
                        </Select>
                        {newCost.asset_type === 'Other' && <Input label="Name" value={newCost.asset_name} onChange={e => setNewCost({ ...newCost, asset_name: e.target.value })} />}
                        <Input label="Amount" type="number" value={newCost.amount} onChange={e => setNewCost({ ...newCost, amount: e.target.value })} />
                        <Input label="Depr %" type="number" value={newCost.depreciation_rate} onChange={e => setNewCost({ ...newCost, depreciation_rate: e.target.value })} />
                        <button onClick={handleAddAsset} className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 h-[38px]">Add</button>
                    </div>

                    {/* Summary */}
                    <div className="mt-6 border-t pt-4 text-right space-y-1">
                        <p className="text-sm text-gray-600">Total Project Cost: <span className="font-bold text-gray-900">₹{totalProjectCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></p>
                        <p className="text-sm text-gray-600">Less Promoter Contribution: <span className="font-bold text-red-600">- ₹{contribution.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></p>
                        <p className="text-lg font-bold text-blue-700">Total Loan Required: ₹{termLoanAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>
            )}

            <div className="text-right">
                <button onClick={() => navigate(`/project-report/${currentReport.id}/operating`)} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700">Continue to Operating Statement &rarr;</button>
            </div>

            <ExistingWCModal
                isOpen={isWCModalOpen}
                onClose={() => setIsWCModalOpen(false)}
                reportId={currentReport.id}
                onSave={handleWCSave}
            />
        </div>
    );
}
