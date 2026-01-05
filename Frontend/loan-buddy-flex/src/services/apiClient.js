import { getCookie } from './utils'; // Assuming you have a utils.js for getCookie

// Get the CSRF token from cookies
// Make sure you have a getCookie function in a utils.js file
// or add it to the bottom of this file.
const csrftoken = getCookie('csrftoken');

// Define the base URL for your Django API
// Use environment variable for production, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

/**
 * A helper function for making API requests.
 * It automatically handles JSON, adds the CSRF token, and manages errors.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-CSRFToken': csrftoken, // Add CSRF token for POST/PUT/DELETE
    ...options.headers,
  };

  const config = {
    ...options,
    headers: headers,
  };

  if (options.body) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { message: response.statusText };
      }
      console.error('API Error:', response.status, errorData);
      throw new Error(errorData.message || 'An API error occurred');
    }

    // Handle 204 No Content (e.g., for DELETE)
    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Network or fetch error:', error);
    throw error;
  }
}

/**
 * Your complete API client object
 */
export const apiClient = {
  // --- Report & Project Setup ---
  getReports: () => {
    return request('/reports/', { method: 'GET' });
  },
  createReport: (reportData) => {
    return request('/reports/', { method: 'POST', body: reportData });
  },
  getReport: (id) => {
    return request(`/reports/${id}/`, { method: 'GET' });
  },
  updateReport: (id, reportData) => {
    return request(`/reports/${id}/`, { method: 'PUT', body: reportData });
  },
  deleteReport: (id) => {
    return request(`/reports/${id}/`, { method: 'DELETE' });
  },

  // --- Existing Term Loans ---
  getTermLoans: (reportId) => {
    return request(`/term-loans/?report=${reportId}`, { method: 'GET' });
  },
  createTermLoan: (loanData) => {
    return request('/term-loans/', { method: 'POST', body: loanData });
  },
  deleteTermLoan: (loanId) => {
    return request(`/term-loans/${loanId}/`, { method: 'DELETE' });
  },
  // ADDED: Function to update an existing loan
  updateTermLoan: (loanId, loanData) => {
    return request(`/term-loans/${loanId}/`, { method: 'PUT', body: loanData });
  },

  // --- Project Cost Items ---
  getProjectCosts: (reportId) => {
    return request(`/project-costs/?report=${reportId}`, { method: 'GET' });
  },
  createProjectCostItem: (itemData) => {
    return request('/project-costs/', { method: 'POST', body: itemData });
  },
  deleteProjectCostItem: (itemId) => {
    return request(`/project-costs/${itemId}/`, { method: 'DELETE' });
  },
  updateProjectCostItem: (itemId, itemData) => {
    return request(`/project-costs/${itemId}/`, { method: 'PUT', body: itemData });
  },

  // --- NEW: Financial Grid APIs ---

  /**
   * Gets the dynamic year columns for the report.
   * e.g., [ { "id": 1, "year": 2024, "year_display": "2024-2025", "year_type": "Actual" }, ... ]
   */
  getYearSettings: (reportId) => {
    return request(`/year-settings/?report=${reportId}`, { method: 'GET' });
  },

  /**
   * Gets the nested groups, rows, and data for a specific page.
   * e.g., /api/groups/?report=1&page_type=operating
   */
  getGroups: (reportId, pageType) => {
    return request(`/groups/?report=${reportId}&page_type=${pageType}`, { method: 'GET' });
  },

  /**
   * Creates a new "head" (FinancialRow) on the "Manage Items" page.
   * e.g., { "group": 5, "name": "New Custom Expense", "display_order": 99 }
   */
  createRow: (rowData) => {
    return request('/rows/', { method: 'POST', body: rowData });
  },

  /**
   * Deletes a "head" (FinancialRow).
   */
  deleteRow: (rowId) => {
    return request(`/rows/${rowId}/`, { method: 'DELETE' });
  },

  /**
   * Updates a "head" (FinancialRow) - used for hide/show functionality.
   */
  updateRow: (rowId, rowData) => {
    return request(`/rows/${rowId}/`, { method: 'PATCH', body: rowData });
  },

  /**
   * Saves the value of a single cell in the grid.
   */
  saveCell: (cellData) => {
    // cellData = { report_id, row_id, year_setting_id, value }
    return request('/data/save_cell/', { method: 'POST', body: cellData });
  },

  /**
   * Saves multiple cells in the grid in a single batch request.
   */
  saveMultipleCells: (batchData) => {
    // batchData = { report_id, cells: [ { row_id, year_setting_id, value }, ... ] }
    return request('/data/save_multiple_cells/', { method: 'POST', body: batchData });
  },

  /**
   * Runs the "GO" button projection automation on the backend.
   */
  runProjection: (rowId, projectionData) => {
    // projectionData = { base_year, base_value, percentage }
    return request(`/rows/${rowId}/run_projection/`, { method: 'POST', body: projectionData });
  },

  // --- Loan Schedule APIs ---

  /**
   * Gets loan schedules for a report.
   * Returns loan configuration with nested year summaries.
   */
  getLoanSchedules: (reportId) => {
    return request(`/loan-schedules/?report=${reportId}`, { method: 'GET' });
  },

  /**
   * Creates a new loan schedule.
   * Backend automatically generates year summaries based on EMI calculation.
   */
  createLoanSchedule: (loanData) => {
    return request('/loan-schedules/', { method: 'POST', body: loanData });
  },

  /**
   * Updates an existing loan schedule.
   * Backend regenerates year summaries automatically.
   */
  updateLoanSchedule: (loanId, loanData) => {
    return request(`/loan-schedules/${loanId}/`, { method: 'PUT', body: loanData });
  },

  /**
   * Deletes a loan schedule.
   */
  deleteLoanSchedule: (loanId) => {
    return request(`/loan-schedules/${loanId}/`, { method: 'DELETE' });
  },

  // --- Existing WC Loans ---
  getExistingWCLoans: (reportId) => {
    return request(`/existing-wc-loans/?report=${reportId}`, { method: 'GET' });
  },
  createExistingWCLoan: (loanData) => {
    return request('/existing-wc-loans/', { method: 'POST', body: loanData });
  },
  deleteExistingWCLoan: (loanId) => {
    return request(`/existing-wc-loans/${loanId}/`, { method: 'DELETE' });
  },

  // --- Drawings (LLP/Proprietorship) ---
  getDrawings: (reportId, yearSettingId = null) => {
    let url = `/drawings/?report=${reportId}`;
    if (yearSettingId) url += `&year_setting=${yearSettingId}`;
    return request(url, { method: 'GET' });
  },
  createDrawing: (drawingData) => {
    return request('/drawings/', { method: 'POST', body: drawingData });
  },
  deleteDrawing: (drawingId) => {
    return request(`/drawings/${drawingId}/`, { method: 'DELETE' });
  },
  updateDrawing: (drawingId, drawingData) => {
    return request(`/drawings/${drawingId}/`, { method: 'PUT', body: drawingData });
  },

  // --- PDF Download ---
  downloadReportPDF: async (reportId) => {
    const url = `${API_BASE_URL}/reports/${reportId}/download-pdf/`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-CSRFToken': csrftoken,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }

      return await response.blob();
    } catch (error) {
      console.error('PDF download error:', error);
      throw error;
    }
  }
};

