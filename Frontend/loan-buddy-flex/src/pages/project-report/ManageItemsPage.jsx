import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AppContext } from './ProjectReportApp.jsx';
import { apiClient } from '@/services/apiClient.js';
import { Input, Select } from '@/components/common.jsx';

// Helper to get CFS label and color for a group
const getCFSInfo = (cfBucket) => {
    switch (cfBucket) {
        case 'operating': return { label: 'Operating', color: 'text-blue-600', bg: 'bg-blue-50' };
        case 'investing': return { label: 'Investing', color: 'text-purple-600', bg: 'bg-purple-50' };
        case 'financing': return { label: 'Financing', color: 'text-green-600', bg: 'bg-green-50' };
        case 'cash_equivalent': return { label: 'Cash (Anchor)', color: 'text-amber-600', bg: 'bg-amber-50' };
        case 'skip': return { label: 'System', color: 'text-gray-500', bg: 'bg-gray-50' };
        default: return { label: 'Other', color: 'text-gray-600', bg: 'bg-gray-50' };
    }
};

// --- 5. Manage Items Page (Hide/Show + Add Custom) ---
export function ManageItemsPage() {
    const { currentReport, reloadFinancialData, operatingGroups, assetGroups, liabilityGroups } = useContext(AppContext);
    const [pageType, setPageType] = useState('operating');
    const [groupId, setGroupId] = useState('');
    const [rowName, setRowName] = useState('');

    const groups = useMemo(() => {
        if (pageType === 'operating') return operatingGroups;
        if (pageType === 'asset') return assetGroups;
        return liabilityGroups;
    }, [pageType, operatingGroups, assetGroups, liabilityGroups]);

    // Filter out total groups for selection (users shouldn't add to totals)
    const selectableGroups = useMemo(() =>
        groups.filter(g => !g.system_tag?.includes('total') && g.cf_bucket !== 'skip'),
        [groups]
    );

    // Automatically select first selectable group
    useEffect(() => {
        if (selectableGroups.length > 0) setGroupId(selectableGroups[0].id);
    }, [selectableGroups]);

    // Get selected group's CFS info
    const selectedGroup = useMemo(() =>
        selectableGroups.find(g => g.id === parseInt(groupId)) || selectableGroups[0],
        [selectableGroups, groupId]
    );
    const selectedCFS = selectedGroup ? getCFSInfo(selectedGroup.cf_bucket) : null;

    const handleAddRow = async (e) => {
        e.preventDefault();
        if (!groupId) return;
        try {
            await apiClient.createRow({ group: groupId, name: rowName });
            setRowName('');
            await reloadFinancialData(currentReport.id);
        } catch (err) { console.error(err); }
    };

    const handleDeleteRow = async (id) => {
        if (!confirm("Delete this item?")) return;
        await apiClient.deleteRow(id);
        await reloadFinancialData(currentReport.id);
    };

    const handleToggleHidden = async (row) => {
        try {
            await apiClient.updateRow(row.id, { is_hidden: !row.is_hidden });
            await reloadFinancialData(currentReport.id);
        } catch (err) { console.error("Failed to toggle visibility", err); }
    };

    return (
        <div className="p-8 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Add New */}
            <div className="bg-white p-6 shadow rounded border h-fit">
                <h3 className="font-bold text-lg mb-4">Add New Head</h3>
                <form onSubmit={handleAddRow} className="space-y-4">
                    <Select label="Page" value={pageType} onChange={e => setPageType(e.target.value)}>
                        <option value="operating">Operating Statement</option>
                        <option value="asset">Assets</option>
                        <option value="liability">Liabilities</option>
                    </Select>
                    <Select label="Subgroup (CFS Category)" value={groupId} onChange={e => setGroupId(e.target.value)}>
                        {selectableGroups.map(g => {
                            const cfs = getCFSInfo(g.cf_bucket);
                            return (
                                <option key={g.id} value={g.id}>
                                    {g.name} → {cfs.label}
                                </option>
                            );
                        })}
                    </Select>
                    {selectedCFS && (
                        <div className={`px-3 py-2 rounded text-sm ${selectedCFS.bg} ${selectedCFS.color}`}>
                            <strong>CFS Classification:</strong> {selectedCFS.label} Activities
                        </div>
                    )}
                    <Input label="New Head Name" value={rowName} onChange={e => setRowName(e.target.value)} required />
                    <button type="submit" className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">+ Add Item</button>
                </form>
            </div>

            {/* Right: Manage List */}
            <div className="lg:col-span-2 bg-white p-6 shadow rounded border">
                <h3 className="font-bold text-lg mb-4">Manage Existing Items</h3>
                <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                    {groups.map(group => {
                        const cfs = getCFSInfo(group.cf_bucket);
                        return (
                            <div key={group.id} className="border rounded">
                                <div className={`${cfs.bg} px-4 py-2 font-semibold text-sm flex justify-between items-center`}>
                                    <span className="text-gray-700">{group.name}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${cfs.color} bg-white`}>{cfs.label}</span>
                                </div>
                                <ul className="divide-y">
                                    {group.rows.map(row => (
                                        <li key={row.id} className={`px-4 py-2 flex justify-between items-center ${row.is_hidden ? 'bg-gray-50 opacity-60' : ''}`}>
                                            <span className="text-sm">{row.name} {row.is_hidden && "(Hidden)"}</span>
                                            <div>
                                                {row.is_custom ? (
                                                    <button onClick={() => handleDeleteRow(row.id)} className="text-red-500 text-xs hover:underline">Delete</button>
                                                ) : (
                                                    <button onClick={() => handleToggleHidden(row)} className="text-blue-500 text-xs hover:underline">
                                                        {row.is_hidden ? "Show" : "Hide"}
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
