import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/apiClient.js';

const DEPRECIATION_RATES = {
    'Land': 0,
    'Building': 10,
    'Machinery': 15,
    'Computers': 40,
    'Furniture': 10,
    'Vehicle': 15,
    'Other': 15
};

export function AssetBreakdownModal({ isOpen, onClose, reportId, yearSettings, onSave }) {
    const [assets, setAssets] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [newAsset, setNewAsset] = useState({
        asset_type: 'Machinery',
        asset_name: '',
        amount: 0,
        depreciation_rate: 15.00,
        purchase_year: '', // This will store the ID of the year setting
        is_existing_asset: true, // Default to existing if first year is selected
        is_second_half_purchase: false
    });

    useEffect(() => {
        if (isOpen && reportId) {
            loadAssets();
        }
    }, [isOpen, reportId]);

    // Set default purchase year to the first year (start of project) when yearSettings load
    useEffect(() => {
        if (yearSettings && yearSettings.length > 0 && !newAsset.purchase_year) {
            const sortedYears = [...yearSettings].sort((a, b) => a.year - b.year);
            setNewAsset(prev => ({
                ...prev,
                purchase_year: sortedYears[0].id,
                is_existing_asset: true
            }));
        }
    }, [yearSettings]);

    const loadAssets = async () => {
        setLoading(true);
        try {
            const data = await apiClient.getProjectCosts(reportId);
            setAssets(data);
        } catch (error) {
            console.error("Failed to load assets:", error);
        }
        setLoading(false);
    };

    const handleAdd = async () => {
        if (!newAsset.asset_name || !newAsset.amount) return;

        try {
            if (editingId) {
                await apiClient.updateProjectCostItem(editingId, {
                    ...newAsset,
                    report: reportId
                });
            } else {
                await apiClient.createProjectCostItem({
                    ...newAsset,
                    report: reportId
                });
            }

            // Reset form
            setNewAsset(prev => ({
                ...prev,
                asset_name: '',
                amount: 0
            }));
            setEditingId(null); // Clear editing state

            await loadAssets();
            onSave(); // Trigger parent update (re-calculation)
        } catch (error) {
            console.error("Failed to save asset:", error);
        }
    };

    const handleEdit = (asset) => {
        setEditingId(asset.id);
        setNewAsset({
            asset_type: asset.asset_type,
            asset_name: asset.asset_name,
            amount: asset.amount,
            depreciation_rate: asset.depreciation_rate,
            purchase_year: asset.purchase_year ? parseInt(asset.purchase_year) : '',
            is_existing_asset: asset.is_existing_asset,
            is_second_half_purchase: asset.is_second_half_purchase
        });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setNewAsset(prev => ({
            ...prev,
            asset_name: '',
            amount: 0
        }));
    };

    const handleDelete = async (id) => {
        if (!confirm("Delete this asset?")) return;
        try {
            await apiClient.deleteProjectCostItem(id);
            await loadAssets();
            onSave(); // Trigger parent update
        } catch (error) {
            console.error("Failed to delete asset:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">Manage Existing Assets & Assets to Buy</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {/* Add New Asset Form */}
                    <div className="bg-blue-50 p-4 rounded-lg mb-6 grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                            <select
                                className="w-full border rounded p-2 text-sm"
                                value={newAsset.asset_type}
                                onChange={e => {
                                    const type = e.target.value;
                                    const rate = DEPRECIATION_RATES[type] !== undefined ? DEPRECIATION_RATES[type] : 15;
                                    setNewAsset({ ...newAsset, asset_type: type, depreciation_rate: rate });
                                }}
                            >
                                {Object.keys(DEPRECIATION_RATES).map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={newAsset.asset_name}
                                onChange={e => setNewAsset({ ...newAsset, asset_name: e.target.value })}
                                placeholder="e.g. Lathe Machine"
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Purchase Year</label>
                            <select
                                className="w-full border rounded p-2 text-sm"
                                value={newAsset.purchase_year}
                                onChange={e => {
                                    const selectedYearId = parseInt(e.target.value);
                                    const sortedYears = [...yearSettings].sort((a, b) => a.year - b.year);
                                    const startYearId = sortedYears[0].id;
                                    setNewAsset({
                                        ...newAsset,
                                        purchase_year: selectedYearId,
                                        is_existing_asset: selectedYearId === startYearId
                                    });
                                }}
                            >
                                {yearSettings.map(y => (
                                    <option key={y.id} value={y.id}>{y.year_display}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-2 flex items-center pt-6">
                            <label className="flex items-center space-x-2 text-sm text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newAsset.is_second_half_purchase}
                                    onChange={e => setNewAsset({ ...newAsset, is_second_half_purchase: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>Purchased after Oct 2? (Half Depr.)</span>
                            </label>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 text-sm"
                                value={newAsset.amount}
                                onChange={e => setNewAsset({ ...newAsset, amount: e.target.value })}
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Depr. %</label>
                            <div className="flex">
                                <input
                                    type="number"
                                    className="w-full border rounded-l p-2 text-sm"
                                    value={newAsset.depreciation_rate}
                                    onChange={e => setNewAsset({ ...newAsset, depreciation_rate: e.target.value })}
                                />
                                <button
                                    onClick={handleAdd}
                                    className="bg-blue-600 text-white px-3 py-2 rounded-r hover:bg-blue-700 text-sm font-bold"
                                >
                                    {editingId ? 'Update' : 'Add'}
                                </button>
                                {editingId && (
                                    <button
                                        onClick={handleCancelEdit}
                                        className="bg-gray-300 text-gray-700 px-3 py-2 rounded-r hover:bg-gray-400 text-sm font-bold ml-1"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Asset List */}
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">Loading assets...</div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchase Year</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Depr. %</th>
                                    <th className="px-4 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {assets.map(asset => {
                                    const yearObj = yearSettings.find(y => y.id === asset.purchase_year);
                                    const yearDisplay = yearObj ? yearObj.year_display : 'Start of Project';

                                    return (
                                        <tr key={asset.id}>
                                            <td className="px-4 py-2 text-sm text-gray-900">
                                                <div className="font-medium">{asset.asset_name}</div>
                                                <div className="text-xs text-gray-500">{asset.asset_type}</div>
                                                {asset.is_existing_asset ? (
                                                    <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded mt-1">Existing</span>
                                                ) : (
                                                    <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded mt-1">New Purchase</span>
                                                )}
                                                {asset.is_second_half_purchase && (
                                                    <span className="ml-2 inline-block bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded mt-1" title="Half Depreciation in Purchase Year">½ Depr</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-600">{yearDisplay}</td>
                                            <td className="px-4 py-2 text-sm text-right font-mono">₹{parseFloat(asset.amount).toLocaleString('en-IN')}</td>
                                            <td className="px-4 py-2 text-sm text-right">{asset.depreciation_rate}%</td>
                                            <td className="px-4 py-2 text-right">
                                                <button
                                                    onClick={() => handleDelete(asset.id)}
                                                    className="text-red-500 hover:text-red-700 text-sm"
                                                >
                                                    Delete
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(asset)}
                                                    className="text-blue-500 hover:text-blue-700 text-sm ml-3"
                                                >
                                                    Edit
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {assets.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="px-4 py-8 text-center text-gray-500 italic">
                                            No assets added yet. Add one above.
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
