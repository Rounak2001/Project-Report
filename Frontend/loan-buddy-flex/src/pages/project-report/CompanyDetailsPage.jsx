import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { Input, Textarea, Alert } from '@/components/common.jsx';
import { useNavigate } from 'react-router-dom';

// --- 2. Company Details Page ---
export function CompanyDetailsPage() {
    const { currentReport, updateCurrentReport } = useContext(AppContext);
    const [formData, setFormData] = useState(currentReport);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (currentReport) setFormData(currentReport);
    }, [currentReport]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        try {
            const updatedReport = await apiClient.updateReport(currentReport.id, formData);
            updateCurrentReport(updatedReport);
            setMessage({ type: 'success', text: 'Saved successfully!' });
        } catch (error) {
            console.error("Failed to save", error);
            setMessage({ type: 'error', text: 'Failed to save. Please try again.' });
        }
        setLoading(false);
        setTimeout(() => setMessage(null), 3000);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <form onSubmit={handleSubmit} className="bg-white p-8 shadow-lg rounded-lg border border-gray-200">
                <h2 className="text-xl font-semibold mb-6 text-gray-900 border-b pb-4">Company Details</h2>
                <Alert type={message?.type} message={message?.text} />

                <div className="space-y-6">
                    {/* Company Name - Read Only */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-md text-gray-900">
                            {currentReport?.company_name || 'N/A'}
                        </div>
                    </div>

                    {/* Sector - Read Only */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Sector</label>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-md text-gray-900">
                            {currentReport?.sector ?
                                currentReport.sector.charAt(0).toUpperCase() + currentReport.sector.slice(1)
                                : 'N/A'}
                        </div>
                    </div>

                    {/* Address - Editable */}
                    <Textarea
                        label="Address"
                        name="address"
                        rows="3"
                        value={formData.address || ''}
                        onChange={handleChange}
                    />

                    {/* GST Number - Editable */}
                    <Input
                        label="GST Number"
                        name="gst_number"
                        value={formData.gst_number || ''}
                        onChange={handleChange}
                    />

                    <div className="pt-6 flex justify-end space-x-3">
                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-6 py-2 text-base font-medium text-white shadow-sm hover:bg-blue-700 disabled:bg-gray-400"
                        >
                            {loading ? "Saving..." : "Save"}
                        </button>
                        <button
                            type="button"
                            onClick={async (e) => { await handleSubmit(e); navigate(`/project-report/${currentReport.id}/project-setup`); }}
                            className="inline-flex items-center justify-center rounded-md border border-blue-600 bg-white px-6 py-2 text-base font-medium text-blue-600 shadow-sm hover:bg-blue-50"
                        >
                            Next: Project Setup →
                        </button>
                    </div>
                </div>
            </form>
        </div >
    );
}
