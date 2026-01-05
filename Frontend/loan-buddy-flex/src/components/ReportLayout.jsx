import React, { useState, useContext } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { AppContext } from '@/pages/project-report/ProjectReportApp';

// --- Reusable SVG Icons ---
const IconHome = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
const IconBriefcase = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>;
const IconChevronDown = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>;
const IconGrid = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18M12 3v18" /></svg>;
const IconList = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></svg>;
const IconEye = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>;
const IconFileText = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>;

/**
 * A horizontal navigation link component
 */
function HorizontalNavItem({ to, icon, children, end = false }) {
  const baseClasses = "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors";
  const activeClasses = "bg-blue-100 text-blue-700";
  const inactiveClasses = "text-gray-700 hover:bg-gray-100 hover:text-gray-900";

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `${baseClasses} ${isActive ? activeClasses : inactiveClasses}`
      }
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="whitespace-nowrap">{children}</span>
    </NavLink>
  );
}

/**
 * Dropdown menu component for grouped navigation items
 */
function DropdownMenu({ icon, label, children }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 rounded-md transition-colors"
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="whitespace-nowrap">{label}</span>
        <IconChevronDown className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Dropdown menu item component
 */
function DropdownItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${isActive
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-700 hover:bg-gray-50'
        }`
      }
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </NavLink>
  );
}

/**
 * The main layout with horizontal navigation
 */
function ReportLayout({ children }) {
  const { reportId } = useParams();
  const { currentReport } = useContext(AppContext);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Horizontal Navigation Bar */}
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Left: Brand/Logo */}
            <div className="flex items-center gap-6">
              <NavLink
                to="/project-report/"
                className="text-lg font-bold text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                CMA Report
              </NavLink>

              {/* Navigation Menu Items */}
              {reportId && (
                <div className="hidden lg:flex items-center gap-1">
                  <HorizontalNavItem to="/project-report/" icon={<IconHome />} end>
                    Home
                  </HorizontalNavItem>

                  <DropdownMenu icon={<IconBriefcase />} label="Company Setup">
                    <DropdownItem to={`/project-report/${reportId}/company`} icon={<IconFileText />}>
                      Company Details
                    </DropdownItem>
                    <DropdownItem to={`/project-report/${reportId}/project-setup`} icon={<IconFileText />}>
                      Project & Loan
                    </DropdownItem>
                    <DropdownItem to={`/project-report/${reportId}/existing-loans`} icon={<IconFileText />}>
                      Existing Loans
                    </DropdownItem>
                  </DropdownMenu>

                  <HorizontalNavItem to={`/project-report/${reportId}/operating`} icon={<IconFileText />}>
                    Operating Statement
                  </HorizontalNavItem>

                  <HorizontalNavItem to={`/project-report/${reportId}/assets`} icon={<IconFileText />}>
                    Assets
                  </HorizontalNavItem>

                  <HorizontalNavItem to={`/project-report/${reportId}/liabilities`} icon={<IconFileText />}>
                    Liabilities
                  </HorizontalNavItem>

                  <DropdownMenu icon={<IconList />} label="Management">
                    <DropdownItem to={`/project-report/${reportId}/manage-items`} icon={<IconFileText />}>
                      Manage Items
                    </DropdownItem>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {/* Center: Company Name */}
            {currentReport && (
              <div className="hidden md:block text-sm font-semibold text-gray-800">
                {currentReport.company_name}
              </div>
            )}

            {/* Right: Preview & Download */}
            {reportId && (
              <div className="flex items-center gap-2">
                <NavLink
                  to={`/project-report/${reportId}/preview`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-blue-600 hover:bg-blue-50'
                    }`
                  }
                >
                  <IconEye />
                  <span className="hidden sm:inline">Preview</span>
                </NavLink>
                <NavLink
                  to={`/project-report/${reportId}/download`}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  <IconDownload />
                  <span className="hidden sm:inline">Download</span>
                </NavLink>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content Area - Full Width */}
      <main className="flex-1 overflow-y-auto">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}

export default ReportLayout;