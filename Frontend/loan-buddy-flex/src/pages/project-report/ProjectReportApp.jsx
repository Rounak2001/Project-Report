import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  useMemo,
  useCallback
} from 'react';
import {
  Routes,
  Route,
  useParams,
  useNavigate,
  Outlet
} from 'react-router-dom';
import { apiClient } from '@/services/apiClient.js';
import {
  HomePage,
  CompanyDetailsPage,
  ProjectSetupPage,
  ExistingLoansPage,
  FinancialGridPage,
  ManageItemsPage
} from './ProjectReportPages.jsx';
import { FullScreenLoader } from '@/components/common.jsx';
import ReportLayout from '@/components/ReportLayout.jsx';
import { PreviewPage } from './PreviewPage.jsx';

// Create a global context for our app
export const AppContext = createContext(null);

/**
 * This is the main entry point for the Project Report feature.
 * It handles loading the report and providing all data to its children.
 */
function ProjectReportApp() {
  const [currentReport, setCurrentReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [appError, setAppError] = useState(null);

  // UPDATED: This state now holds ALL our financial data
  const [allFinancialData, setAllFinancialData] = useState({
    yearSettings: [],
    operatingGroups: [],
    assetGroups: [],
    liabilityGroups: [],
  });

  const navigate = useNavigate();

  // UPDATED: This function now fetches EVERYTHING for the report
  const selectReport = useCallback(async (reportId, shouldNavigate = true) => {
    setLoading(true);
    setAppError(null);
    try {
      // Load ALL data for the report in one go.
      // These run in parallel for maximum speed.
      const [
        report,
        yearSettings,
        opGroups,
        asGroups,
        liGroups,
        projectCosts
      ] = await Promise.all([
        apiClient.getReport(reportId),
        apiClient.getYearSettings(reportId),
        apiClient.getGroups(reportId, 'operating'),
        apiClient.getGroups(reportId, 'asset'),
        apiClient.getGroups(reportId, 'liability'),
        apiClient.getProjectCosts(reportId)
      ]);

      setCurrentReport(report);
      setAllFinancialData({
        yearSettings,
        operatingGroups: opGroups,
        assetGroups: asGroups,
        liabilityGroups: liGroups,
        projectCosts: projectCosts || []
      });

      // Only navigate if explicitly requested (from dashboard)
      if (shouldNavigate) {
        navigate(`/project-report/${reportId}/company`);
      }
    } catch (error) {
      console.error("Error selecting report:", error);
      setAppError("Could not load report. Please try again.");
    }
    setLoading(false);
  }, [navigate]);

  // NEW: This function is called by grid pages to refresh data
  const reloadFinancialData = useCallback(async (reportId) => {
    setLoading(true);
    try {
      // Re-fetch report AND grid data to ensure everything is in sync
      const [report, yearSettings, opGroups, asGroups, liGroups, projectCosts] = await Promise.all([
        apiClient.getReport(reportId),
        apiClient.getYearSettings(reportId),
        apiClient.getGroups(reportId, 'operating'),
        apiClient.getGroups(reportId, 'asset'),
        apiClient.getGroups(reportId, 'liability'),
        apiClient.getProjectCosts(reportId)
      ]);

      setCurrentReport(report);
      setAllFinancialData({
        yearSettings,
        operatingGroups: opGroups,
        assetGroups: asGroups,
        liabilityGroups: liGroups,
        projectCosts: projectCosts || []
      });
    } catch (err) {
      console.error("Failed to reload financial data:", err);
      setAppError("Failed to reload data.");
    }
    setLoading(false);
  }, [setAppError]);

  const goToHome = () => {
    setCurrentReport(null);
    setAllFinancialData({ yearSettings: [], operatingGroups: [], assetGroups: [], liabilityGroups: [] });
    navigate('/project-report');
  };

  const updateCurrentReport = (updatedReport) => {
    setCurrentReport(updatedReport);
  };

  // UPDATED: The context value now provides all grid data
  const value = {
    loading,
    setLoading,
    appError,
    setAppError,
    // Report Data
    currentReport,
    updateCurrentReport,
    selectReport,
    goToHome,
    // Grid Data
    ...allFinancialData,
    reloadFinancialData
  };

  return (
    <AppContext.Provider value={value}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route
          path=":reportId/*"
          element={<ProtectedReportLayout />}
        />
      </Routes>
    </AppContext.Provider>
  );
}

/**
 * This component "protects" the report pages.
 * It checks if the data for the reportId in the URL is loaded.
 */
function ProtectedReportLayout() {
  const { reportId } = useParams();
  const { currentReport, selectReport, loading, appError, operatingGroups, assetGroups, liabilityGroups } = useContext(AppContext);
  const navigate = useNavigate();
  const location = window.location.pathname;

  useEffect(() => {
    // If we land on this page directly (e.g., refresh)
    // and don't have a report in context, or it's the wrong report, fetch it.
    if (!currentReport || currentReport.id !== parseInt(reportId)) {
      selectReport(reportId, false); // Don't navigate when loading from URL
    }
  }, [reportId, currentReport, selectReport]);

  // Check if user is trying to access pages out of order
  useEffect(() => {
    if (!currentReport) return;

    const isCompanyComplete = currentReport.company_name && currentReport.sector;
    const isProjectComplete = currentReport.start_year && currentReport.total_years_in_report;

    // If company details not complete, redirect to company page
    if (!isCompanyComplete && !location.includes('/company')) {
      navigate(`/project-report/${reportId}/company`);
      return;
    }

    // If project setup not complete, redirect to project setup (unless on company page)
    if (isCompanyComplete && !isProjectComplete && !location.includes('/company') && !location.includes('/project-setup')) {
      navigate(`/project-report/${reportId}/project-setup`);
      return;
    }
  }, [currentReport, location, navigate, reportId]);

  // Check if financial data is already loaded
  const hasFinancialData = operatingGroups.length > 0 || assetGroups.length > 0 || liabilityGroups.length > 0;

  if (appError) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="p-8 text-center text-red-600 bg-white shadow-lg rounded-lg">
          <h2 className="text-xl font-bold mb-4">Error</h2>
          <p>{appError}</p>
          <a href="/project-report" className="mt-4 inline-block text-blue-600 hover:underline">Go to Dashboard</a>
        </div>
      </div>
    );
  }

  // Show loader while fetching report (but not if we already have financial data)
  if ((loading || !currentReport || currentReport.id !== parseInt(reportId)) && !hasFinancialData) {
    return <FullScreenLoader text="Loading Report..." />;
  }

  // currentReport is loaded and correct, render the layout
  // The <Outlet> renders the active nested route (Company, Project, etc.)
  return (
    <ReportLayout>
      <Routes>
        <Route index element={<CompanyDetailsPage />} />
        <Route path="company" element={<CompanyDetailsPage />} />
        <Route path="project-setup" element={<ProtectedProjectSetup />} />
        <Route path="existing-loans" element={<ProtectedExistingLoans />} />

        {/* --- UPDATED: All Grid Routes --- */}
        <Route
          path="operating"
          element={<ProtectedFinancialGrid pageType="operating" title="Operating Statement" />}
        />
        <Route
          path="assets"
          element={<ProtectedFinancialGrid pageType="asset" title="Balance Sheet - Assets" />}
        />
        <Route
          path="liabilities"
          element={<ProtectedFinancialGrid pageType="liability" title="Balance Sheet - Liabilities" />}
        />
        <Route path="manage-items" element={<ProtectedManageItems />} />

        {/* TODO: Add routes for Preview, Download */}
        <Route path="preview" element={<ProtectedPreview />} />
        <Route path="download" element={<div className="p-8"><h2>PDF Download Coming Soon</h2></div>} />
      </Routes>
    </ReportLayout>
  );
}

// Protected route components
function ProtectedProjectSetup() {
  const { currentReport } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentReport && (!currentReport.company_name || !currentReport.sector)) {
      navigate(`/project-report/${currentReport.id}/company`);
    }
  }, [currentReport, navigate]);

  return <ProjectSetupPage />;
}

function ProtectedExistingLoans() {
  const { currentReport } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentReport) {
      const isCompanyComplete = currentReport.company_name && currentReport.sector;
      const isProjectComplete = currentReport.start_year && currentReport.total_years_in_report;

      if (!isCompanyComplete) {
        navigate(`/project-report/${currentReport.id}/company`);
      } else if (!isProjectComplete) {
        navigate(`/project-report/${currentReport.id}/project-setup`);
      }
    }
  }, [currentReport, navigate]);

  return <ExistingLoansPage />;
}

function ProtectedFinancialGrid({ pageType, title }) {
  const { currentReport } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentReport) {
      const isCompanyComplete = currentReport.company_name && currentReport.sector;
      const isProjectComplete = currentReport.start_year && currentReport.total_years_in_report;

      if (!isCompanyComplete) {
        navigate(`/project-report/${currentReport.id}/company`);
      } else if (!isProjectComplete) {
        navigate(`/project-report/${currentReport.id}/project-setup`);
      }
    }
  }, [currentReport, navigate]);

  return <FinancialGridPage pageType={pageType} title={title} />;
}

function ProtectedManageItems() {
  const { currentReport } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentReport) {
      const isCompanyComplete = currentReport.company_name && currentReport.sector;
      const isProjectComplete = currentReport.start_year && currentReport.total_years_in_report;

      if (!isCompanyComplete) {
        navigate(`/project-report/${currentReport.id}/company`);
      } else if (!isProjectComplete) {
        navigate(`/project-report/${currentReport.id}/project-setup`);
      }
    }
  }, [currentReport, navigate]);

  return <ManageItemsPage />;
}

function ProtectedPreview() {
  const { currentReport } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentReport) {
      const isCompanyComplete = currentReport.company_name && currentReport.sector;
      const isProjectComplete = currentReport.start_year && currentReport.total_years_in_report;

      if (!isCompanyComplete) {
        navigate(`/project-report/${currentReport.id}/company`);
      } else if (!isProjectComplete) {
        navigate(`/project-report/${currentReport.id}/project-setup`);
      }
    }
  }, [currentReport, navigate]);

  return <PreviewPage />;
}

export default ProjectReportApp;