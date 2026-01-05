import React, { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { FullScreenLoader, Input, Select } from '@/components/common.jsx';

// --- 1. HomePage (Dashboard) ---
export function HomePage() {
    console.log("HomePage mounting...");
    const { selectReport, setAppError } = useContext(AppContext);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);

    // State for the creation form
    const [formData, setFormData] = useState({
        company_name: "",
        start_year: new Date().getFullYear(),
        // audited_years: 1, // Removed from form as per new model defaults, can be added back if needed
        total_years_in_report: 7,
        sector: "service",
    });

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.getReports();
            setReports(data);
        } catch (error) {
            console.error("Failed to fetch reports", error);
            setAppError("Could not fetch reports. Is the backend server running?");
        }
        setLoading(false);
    }, [setAppError]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCreateReport = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const newReport = await apiClient.createReport(formData);
            selectReport(newReport.id);
        } catch (error) {
            console.error("Failed to create report", error);
            setAppError("Could not create report.");
            setLoading(false);
        }
    };

    const handleDeleteReport = async (e, reportId) => {
        e.stopPropagation(); // Prevent opening the report
        if (!confirm("Are you sure you want to delete this report? This action cannot be undone.")) return;

        try {
            await apiClient.deleteReport(reportId);
            fetchReports(); // Refresh list
        } catch (error) {
            console.error("Failed to delete report", error);
            setAppError("Could not delete report.");
        }
    };

    if (loading && reports.length === 0) {
        return <FullScreenLoader text="Loading Dashboard..." />;
    }

    return (
        <div className="min-h-full p-6">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8 bg-white p-6 shadow-lg rounded-lg border border-gray-200">
                    <h2 className="text-xl font-semibold mb-4 text-gray-900">Create New Report</h2>
                    <form onSubmit={handleCreateReport} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Input label="Company Name" name="company_name" value={formData.company_name} onChange={handleChange} required placeholder="e.g., ABC Ltd." />
                        <Select label="Sector" name="sector" value={formData.sector} onChange={handleChange} required>
                            <option value="service">Service</option>
                            <option value="industry">Industry (Manufacturing)</option>
                            <option value="wholesale">Wholesale</option>
                            <option value="retail">Retailers</option>
                        </Select>
                        <Input label="First Financial Year (Starting Year of FY)" name="start_year" type="number" value={formData.start_year} onChange={handleChange} required />
                        <div>
                            <Input label="Total Years" name="total_years_in_report" type="number" min="3" max="10" value={formData.total_years_in_report} onChange={handleChange} required />
                            <p className="text-xs text-gray-500 mt-1">Including actual + provisional years</p>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-4">
                            <button type="submit" className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                                + Create and Start
                            </button>
                        </div>
                    </form>
                </div>

                <h2 className="text-xl font-semibold mb-4 text-gray-900">Existing Reports</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {reports.map((report) => (
                        <button
                            key={report.id}
                            onClick={() => selectReport(report.id)}
                            className="flex flex-col justify-between text-left p-4 bg-white shadow-lg rounded-lg hover:shadow-xl transition-shadow duration-200 border border-gray-100"
                        >
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">{report.company_name}</h3>
                                <p className="text-sm text-gray-600">{report.sector.charAt(0).toUpperCase() + report.sector.slice(1)} Sector</p>
                                <p className="text-sm text-gray-600">Base Year: {report.start_year}</p>
                            </div>
                            <div className="flex justify-between items-end mt-4">
                                <p className="text-xs text-gray-400">
                                    Created: {new Date(report.created_at).toLocaleDateString()}
                                </p>
                                <button
                                    onClick={(e) => handleDeleteReport(e, report.id)}
                                    className="text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
