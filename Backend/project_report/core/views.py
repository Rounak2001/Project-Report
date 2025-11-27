from rest_framework import viewsets, permissions, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import serializers
from django.contrib.auth.models import User
from django.db import models # Import this for F() expressions
from .models import (
    FinancialReport, TermLoan, ProjectCostItem, 
    ReportYearSetting, FinancialGroup, FinancialRow, FinancialData,
    LoanSchedule, LoanYearSummary
)
from .serializers import (
    FinancialReportSerializer, TermLoanSerializer, ProjectCostItemSerializer,
    ReportYearSettingSerializer, FinancialGroupSerializer, FinancialRowSerializer,
    FinancialDataSerializer, LoanScheduleSerializer, LoanYearSummarySerializer
)
import datetime

# --- Helper Function (Stays outside the class) ---
# We use this to auto-assign a user since we have no authentication
def get_first_user():
    """Get the first user in the database, typically the admin."""
    user = User.objects.first()
    if not user:
        # This will create an admin user if none exist.
        user = User.objects.create_superuser('admin', 'admin@example.com', 'password')
    return user

# --- Helper function to get the current financial year (Stays outside the class) ---
def _get_financial_year_start(for_date):
    """
    Calculates the starting year of the Indian Financial Year
    for a given date (e.g., 2025-11-18 -> 2025).
    """
    if for_date.month >= 4: # April (4) or later
        return for_date.year
    else: # Jan, Feb, March
        return for_date.year - 1


# --- 2. Term Loan ViewSet (This was missing) ---
class TermLoanViewSet(viewsets.ModelViewSet):
    queryset = TermLoan.objects.all()
    serializer_class = TermLoanSerializer
    # permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = TermLoan.objects.all()
        report_id = self.request.query_params.get('report')
        if report_id:
            return queryset.filter(report_id=report_id)
        return queryset

    def perform_create(self, serializer):
        report_id = self.request.data.get('report')
        if not report_id:
            raise serializers.ValidationError({"report": "Report ID is required."})
        
        report = FinancialReport.objects.get(id=report_id)
        # We need to pass the 'user' because the model requires it
        serializer.save(report=report, user=report.user)


# --- 3. Project Cost Item ViewSet (This was missing) ---
class ProjectCostItemViewSet(viewsets.ModelViewSet):
    queryset = ProjectCostItem.objects.all()
    serializer_class = ProjectCostItemSerializer
    # permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ProjectCostItem.objects.all()
        report_id = self.request.query_params.get('report')
        if report_id:
            return queryset.filter(report_id=report_id)
        return queryset

    def perform_create(self, serializer):
        report_id = self.request.data.get('report')
        if not report_id:
            raise serializers.ValidationError({"report": "Report ID is required."})
        
        report = FinancialReport.objects.get(id=report_id)
        serializer.save(report=report, user=report.user)
# --- API for "Company Details" & "Project Setup" ---
class FinancialReportViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Financial Reports.
    Handles main report settings, company details, and project setup.
    """
    queryset = FinancialReport.objects.all()
    serializer_class = FinancialReportSerializer
    # permission_classes = [permissions.IsAuthenticated] # Auth is OFF

    def get_queryset(self):
        """
        FOR NOW: It returns all reports, as auth is off.
        """
        return FinancialReport.objects.all()

    def perform_create(self, serializer):
        """
        Automatically assign the first user as the owner when a new report
        is created. This is where we will trigger the automation.
        """
        user = get_first_user()
        report = serializer.save(user=user)
        
        # --- !! THIS IS THE AUTOMATION !! ---
        # After saving, automatically create the default financial structure
        self._create_default_year_settings(report)
        self._create_default_financial_structure(report) # This calls the router function below

    def update(self, request, *args, **kwargs):
        """
        This is the "Sector-Switching" logic.
        When a user saves this form (e.g., PUT or PATCH),
        we check if the 'sector' field has changed.
        """
        report = self.get_object()
        new_sector = request.data.get('sector')
        
        # Check if the sector has changed
        if new_sector and new_sector != report.sector:
            print(f"Report {report.id} sector changing to {new_sector}.")
            # 1. Update the report object with the new sector first
            partial = kwargs.pop('partial', False)
            serializer = self.get_serializer(report, data=request.data, partial=partial)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)

            # 2. !! AUTOMATION !!
            # Now, delete the old structure and create the new one
            print(f"Regenerating financial structure for {new_sector}...")
            self._create_default_financial_structure(report)
            
            return Response(serializer.data)
        
        # If the sector did not change, just do a normal update
        return super().update(request, *args, **kwargs)

    
    # --- !! ALL AUTOMATION LOGIC IS NOW INSIDE THE CLASS !! ---
    
    def _create_default_year_settings(self, report):
        """
        AUTOMATION: Creates the dynamic year columns based on
        the Indian Financial Year (April 1 - March 31).
        """
        today = datetime.date.today() # e.g., 2025-11-18
        current_fy_start_year = _get_financial_year_start(today) # This will be 2025
        
        ReportYearSetting.objects.filter(report=report).delete()
        years_to_create = []
        
        for i in range(report.total_years_in_report):
            year = report.start_year + i # e.g., 2024
            
            if year < current_fy_start_year:
                year_type = "Actual"
            elif year == current_fy_start_year:
                year_type = "Provisional"
            else:
                year_type = "Projected"
                
            years_to_create.append(
                ReportYearSetting(
                    report=report,
                    year=year,
                    year_display=f"{year}-{year+1}", # "2024-2025"
                    year_type=year_type
                )
            )
        ReportYearSetting.objects.bulk_create(years_to_create)

    def _create_default_financial_structure(self, report):
        """
        AUTOMATION: This is the "Router" function.
        It creates the pre-built template of Groups and Rows
        based on the report's selected industry sector.
        """
        sector = report.sector
        # Clear all old groups and rows before creating new ones
        FinancialGroup.objects.filter(report=report).delete() 

        # Route to the correct template
        if sector == 'service':
            self._create_service_template(report)
        elif sector == 'wholesale':
            self._create_wholesale_template(report)
        elif sector == 'retail':
            self._create_retail_template(report)
        else:
            # Default to industry/manufacturing
            self._create_industry_template(report)

    def _create_industry_template(self, report):
            """ Template for Industry/Manufacturing sector. """
            # === 1. Operating Statement (Retaining previous structure) ===
            
            # --- Revenue Group ---
            g_revenue = FinancialGroup.objects.create(report=report, name="Revenue", page_type="operating", order=10)
            FinancialRow.objects.create(group=g_revenue, name="Domestic Sales", order=10)
            FinancialRow.objects.create(group=g_revenue, name="Export Sales", order=20)
            FinancialRow.objects.create(group=g_revenue, name="Total Revenue", order=30, is_calculated=True, is_total_row=True)

            # --- COGS Group ---
            g_cogs = FinancialGroup.objects.create(report=report, name="Cost of Goods Sold (COGS)", page_type="operating", order=20)
            FinancialRow.objects.create(group=g_cogs, name="Opening Stock (Raw Materials)", order=10)
            FinancialRow.objects.create(group=g_cogs, name="Purchases (Raw Materials)", order=20)
            FinancialRow.objects.create(group=g_cogs, name="Freight-in", order=30)
            FinancialRow.objects.create(group=g_cogs, name="Closing Stock (Raw Materials)", order=40)
            FinancialRow.objects.create(group=g_cogs, name="Direct Labor / Wages", order=50)
            FinancialRow.objects.create(group=g_cogs, name="Factory Overheads", order=60)
            FinancialRow.objects.create(group=g_cogs, name="Opening Stock (Work-in-Process)", order=70)
            FinancialRow.objects.create(group=g_cogs, name="Closing Stock (Work-in-Process)", order=80)
            FinancialRow.objects.create(group=g_cogs, name="Opening Stock (Finished Goods)", order=90)
            FinancialRow.objects.create(group=g_cogs, name="Closing Stock (Finished Goods)", order=100)
            FinancialRow.objects.create(group=g_cogs, name="= Cost of Goods Sold", order=110, is_calculated=True, is_total_row=True)

            # --- Selling, General & Administrative Expenses (SGA) ---
            g_sga = FinancialGroup.objects.create(report=report, name="Selling, General & Administrative Expenses", page_type="operating", order=30)
            FinancialRow.objects.create(group=g_sga, name="Salaries (Admin & Sales)", order=10)
            FinancialRow.objects.create(group=g_sga, name="Marketing & Advertising", order=20)
            FinancialRow.objects.create(group=g_sga, name="Office Rent & Utilities", order=30)
            FinancialRow.objects.create(group=g_sga, name="Depreciation (Office Equipment)", order=40)
            FinancialRow.objects.create(group=g_sga, name="Freight-out", order=50)
            FinancialRow.objects.create(group=g_sga, name="Working Capital Interest", order=60)
            FinancialRow.objects.create(group=g_sga, name="Term Loan Interest", order=70, is_calculated=True)
            FinancialRow.objects.create(group=g_sga, name="Selling, General, and Admn. Exp. Total", order=80, is_calculated=True, is_total_row=True)
            
            # --- Taxes & Profit Appropriation ---
            g_taxes = FinancialGroup.objects.create(report=report, name="Taxes and Profit Appropriation", page_type="operating", order=40)
            FinancialRow.objects.create(group=g_taxes, name="Profit Before Tax", order=10, is_calculated=True)
            FinancialRow.objects.create(group=g_taxes, name="Provision for taxes", order=20)
            FinancialRow.objects.create(group=g_taxes, name="Provision for deferred tax", order=30)
            FinancialRow.objects.create(group=g_taxes, name="Prior year adjustment", order=40)
            FinancialRow.objects.create(group=g_taxes, name="Profit After Tax (PAT)", order=50, is_calculated=True)
            FinancialRow.objects.create(group=g_taxes, name="Equity / Dividend Paid Amount", order=60)
            FinancialRow.objects.create(group=g_taxes, name="Dividend Tax including Surcharge", order=70)
            FinancialRow.objects.create(group=g_taxes, name="Dividend Rate (%)", order=80)

            
            # === 2. Balance Sheet - Assets (Updated) ===
            
            # --- Current Assets ---
            g_ca = FinancialGroup.objects.create(report=report, name="Current Assets", page_type="asset", order=10)
            FinancialRow.objects.create(group=g_ca, name="Cash & Bank Balance", order=10)
            FinancialRow.objects.create(group=g_ca, name="Receivables", order=20)
            FinancialRow.objects.create(group=g_ca, name="Export receivables", order=30)
            FinancialRow.objects.create(group=g_ca, name="Instalments of deferred receivables", order=40)
            FinancialRow.objects.create(group=g_ca, name="Raw materials Domestic", order=50)
            FinancialRow.objects.create(group=g_ca, name="Raw materials Imported", order=60)
            FinancialRow.objects.create(group=g_ca, name="Stock in process", order=70)
            FinancialRow.objects.create(group=g_ca, name="Finished goods", order=80)
            FinancialRow.objects.create(group=g_ca, name="Spare Parts (Domestic)", order=90)
            FinancialRow.objects.create(group=g_ca, name="Spare parts( imported)", order=100)
            FinancialRow.objects.create(group=g_ca, name="Advance to supplier of RM & spares", order=110)
            FinancialRow.objects.create(group=g_ca, name="Advance of payment of taxes", order=120)
            FinancialRow.objects.create(group=g_ca, name="Short Term loan", order=130)
            FinancialRow.objects.create(group=g_ca, name="Total Current Assets", order=140, is_calculated=True, is_total_row=True)

            # --- Fixed Assets ---
            g_fa = FinancialGroup.objects.create(report=report, name="Fixed assets", page_type="asset", order=20)
            FinancialRow.objects.create(group=g_fa, name="Gross block", order=10, is_calculated=True)
            FinancialRow.objects.create(group=g_fa, name="Investment in Subsidy", order=20)
            FinancialRow.objects.create(group=g_fa, name="Other Investment", order=30)
            FinancialRow.objects.create(group=g_fa, name="Advances to suppliers of capital goods", order=40)
            FinancialRow.objects.create(group=g_fa, name="Cash collatral", order=50)
            FinancialRow.objects.create(group=g_fa, name="Intangible assets /patents", order=60)
            FinancialRow.objects.create(group=g_fa, name="Total Fixed Assets", order=70, is_calculated=True, is_total_row=True)
            
            # --- Total Assets Row ---
            g_total_assets = FinancialGroup.objects.create(report=report, name="Total Assets", page_type="asset", order=99)
            FinancialRow.objects.create(group=g_total_assets, name="Total Assets", order=10, is_calculated=True, is_total_row=True)


            # === 3. Balance Sheet - Liabilities (Updated) ===
            
            # --- Net Worth ---
            g_nw = FinancialGroup.objects.create(report=report, name="Net Worth", page_type="liability", order=10)
            FinancialRow.objects.create(group=g_nw, name="Ordinary share capital", order=10)
            FinancialRow.objects.create(group=g_nw, name="Share premium", order=20)
            FinancialRow.objects.create(group=g_nw, name="General reserve", order=30)
            FinancialRow.objects.create(group=g_nw, name="Revaluation Reserves", order=40)
            FinancialRow.objects.create(group=g_nw, name="Other reserve", order=50)
            FinancialRow.objects.create(group=g_nw, name="Deffered Tax liability", order=60)
            FinancialRow.objects.create(group=g_nw, name="Total Net Worth", order=70, is_calculated=True, is_total_row=True)

            # --- Term Liabilities ---
            g_tl = FinancialGroup.objects.create(report=report, name="Term liabilities", page_type="liability", order=20)
            FinancialRow.objects.create(group=g_tl, name="Preference Shares", order=10)
            FinancialRow.objects.create(group=g_tl, name="Term loans (excluding installments for 1 year)", order=20, is_calculated=True)
            FinancialRow.objects.create(group=g_tl, name="Sales tax deferred credit", order=30)
            FinancialRow.objects.create(group=g_tl, name="Other liabilities", order=40)
            FinancialRow.objects.create(group=g_tl, name="Unsecured Loan", order=50)
            FinancialRow.objects.create(group=g_tl, name="Total Term Liabilities", order=60, is_calculated=True, is_total_row=True)
            
            # --- Current Liabilities ---
            g_cl = FinancialGroup.objects.create(report=report, name="Current liabilities", page_type="liability", order=30)
            FinancialRow.objects.create(group=g_cl, name="From Applicant bank", order=10)
            FinancialRow.objects.create(group=g_cl, name="From Other bank", order=20)
            FinancialRow.objects.create(group=g_cl, name="Short term borrowing from others", order=30)
            FinancialRow.objects.create(group=g_cl, name="Sundry creditors", order=40)
            FinancialRow.objects.create(group=g_cl, name="Advance payment from Customer / dealer", order=50)
            FinancialRow.objects.create(group=g_cl, name="Provision for Taxes", order=60)
            FinancialRow.objects.create(group=g_cl, name="Dividend Payable", order=70)
            FinancialRow.objects.create(group=g_cl, name="Other statutory liabilities", order=80)
            FinancialRow.objects.create(group=g_cl, name="Deposits/ instalments of term loans", order=90)
            FinancialRow.objects.create(group=g_cl, name="Other Current liabilities(due in 1 year)", order=100)
            FinancialRow.objects.create(group=g_cl, name="Creditors for capital Good", order=110)
            FinancialRow.objects.create(group=g_cl, name="Liability for expense", order=120)
            FinancialRow.objects.create(group=g_cl, name="Liabilities for other expense", order=130)
            FinancialRow.objects.create(group=g_cl, name="Liability for capital goods", order=140)
            FinancialRow.objects.create(group=g_cl, name="Total Current Liabilities", order=150, is_calculated=True, is_total_row=True)
            
            # --- Total Liabilities and Net Worth Row ---
            g_total_liab = FinancialGroup.objects.create(report=report, name="Total Liabilities and Net Worth", page_type="liability", order=99)
            FinancialRow.objects.create(group=g_total_liab, name="Total Liabilities and Net Worth", order=10, is_calculated=True, is_total_row=True)
            
    def _create_service_template(self, report):
        """ Template for Service sector businesses. """
        # === 1. Operating Statement ===
        g_revenue = FinancialGroup.objects.create(report=report, name="Revenue", page_type="operating", order=10)
        FinancialRow.objects.create(group=g_revenue, name="Service Revenue", order=10)
        FinancialRow.objects.create(group=g_revenue, name="Consulting Fees", order=20)
        FinancialRow.objects.create(group=g_revenue, name="Subscription (SaaS) Revenue", order=30)
        FinancialRow.objects.create(group=g_revenue, name="Total Revenue", order=40, is_calculated=True, is_total_row=True)

        g_cor = FinancialGroup.objects.create(report=report, name="Cost of Revenue (COR)", page_type="operating", order=20)
        FinancialRow.objects.create(group=g_cor, name="Salaries - Billable Staff", order=10)
        FinancialRow.objects.create(group=g_cor, name="Subcontractor Costs", order=20)
        FinancialRow.objects.create(group=g_cor, name="Cloud Hosting & Infrastructure Costs", order=30)
        FinancialRow.objects.create(group=g_cor, name="Project-Specific Software Licenses", order=40)
        FinancialRow.objects.create(group=g_cor, name="Total Cost of Revenue", order=50, is_calculated=True, is_total_row=True)
        
        g_sga = FinancialGroup.objects.create(report=report, name="Selling, General & Administrative Expenses", page_type="operating", order=30)
        FinancialRow.objects.create(group=g_sga, name="Salaries - Sales & Admin", order=10)
        FinancialRow.objects.create(group=g_sga, name="Marketing & Advertising", order=20)
        FinancialRow.objects.create(group=g_sga, name="Rent & Utilities (Office)", order=30)
        FinancialRow.objects.create(group=g_sga, name="Travel & Entertainment", order=40)
        FinancialRow.objects.create(group=g_sga, name="Professional Fees (Legal, Accounting)", order=50)

        # === 2. Balance Sheet - Assets ===
        g_ca = FinancialGroup.objects.create(report=report, name="Current Assets", page_type="asset", order=10)
        FinancialRow.objects.create(group=g_ca, name="Cash & Bank Balance", order=10)
        FinancialRow.objects.create(group=g_ca, name="Accounts Receivable (from clients)", order=20)
        FinancialRow.objects.create(group=g_ca, name="Work in Progress (Unbilled Revenue)", order=30)
        FinancialRow.objects.create(group=g_ca, name="Prepaid Expenses", order=40)
        FinancialRow.objects.create(group=g_ca, name="Total Current Assets", order=50, is_calculated=True, is_total_row=True)

        g_fa = FinancialGroup.objects.create(report=report, name="Fixed Assets", page_type="asset", order=20)
        FinancialRow.objects.create(group=g_fa, name="Laptops & Computers", order=10)
        FinancialRow.objects.create(group=g_fa, name="Office Furniture", order=20)
        FinancialRow.objects.create(group=g_fa, name="Leasehold Improvements", order=30)
        FinancialRow.objects.create(group=g_fa, name="Total Fixed Assets", order=40, is_calculated=True, is_total_row=True)

        # === 3. Balance Sheet - Liabilities ===
        g_nw = FinancialGroup.objects.create(report=report, name="Net Worth", page_type="liability", order=10)
        FinancialRow.objects.create(group=g_nw, name="Share Capital", order=10)
        FinancialRow.objects.create(group=g_nw, name="Reserves & Surplus", order=20)
        FinancialRow.objects.create(group=g_nw, name="Total Net Worth", order=30, is_calculated=True, is_total_row=True)
        
        g_tl = FinancialGroup.objects.create(report=report, name="Term Liabilities", page_type="liability", order=20)
        FinancialRow.objects.create(group=g_tl, name="Long-term Loans", order=10, is_calculated=True)
        FinancialRow.objects.create(group=g_tl, name="Total Term Liabilities", order=20, is_calculated=True, is_total_row=True)

        g_cl = FinancialGroup.objects.create(report=report, name="Current Liabilities", page_type="liability", order=30)
        FinancialRow.objects.create(group=g_cl, name="Accounts Payable", order=10)
        FinancialRow.objects.create(group=g_cl, name="Accrued Expenses (Payroll, Rent)", order=20)
        FinancialRow.objects.create(group=g_cl, name="Deferred Revenue (Pre-payments from clients)", order=30)
        FinancialRow.objects.create(group=g_cl, name="Short-term Loans", order=40)
        FinancialRow.objects.create(group=g_cl, name="Total Current Liabilities", order=50, is_calculated=True, is_total_row=True)
        

    def _create_wholesale_template(self, report):
        """ Template for Wholesale sector businesses. """
        # === 1. Operating Statement ===
        g_revenue = FinancialGroup.objects.create(report=report, name="Revenue", page_type="operating", order=10)
        FinancialRow.objects.create(group=g_revenue, name="Wholesale Revenue", order=10)
        FinancialRow.objects.create(group=g_revenue, name="Total Revenue", order=20, is_calculated=True, is_total_row=True)

        g_cogs = FinancialGroup.objects.create(report=report, name="Cost of Goods Sold (COGS)", page_type="operating", order=20)
        FinancialRow.objects.create(group=g_cogs, name="Opening Inventory", order=10)
        FinancialRow.objects.create(group=g_cogs, name="Purchases (Stock-in-Trade)", order=20)
        FinancialRow.objects.create(group=g_cogs, name="Freight-in", order=30)
        FinancialRow.objects.create(group=g_cogs, name="Closing Inventory", order=40)
        FinancialRow.objects.create(group=g_cogs, name="= Cost of Goods Sold", order=50, is_calculated=True, is_total_row=True)

        g_sga = FinancialGroup.objects.create(report=report, name="Selling, General & Administrative Expenses", page_type="operating", order=30)
        FinancialRow.objects.create(group=g_sga, name="Warehouse Rent & Utilities", order=10)
        FinancialRow.objects.create(group=g_sga, name="Warehouse Staff Salaries", order=20)
        FinancialRow.objects.create(group=g_sga, name="Logistics & Freight-out", order=30)
        FinancialRow.objects.create(group=g_sga, name="Sales Team Salaries & Commission", order=40)

        # === 2. Balance Sheet - Assets ===
        g_ca = FinancialGroup.objects.create(report=report, name="Current Assets", page_type="asset", order=10)
        FinancialRow.objects.create(group=g_ca, name="Cash & Bank Balance", order=10)
        FinancialRow.objects.create(group=g_ca, name="Accounts Receivable", order=20)
        FinancialRow.objects.create(group=g_ca, name="Inventory", order=30)
        FinancialRow.objects.create(group=g_ca, name="Total Current Assets", order=40, is_calculated=True, is_total_row=True)

        g_fa = FinancialGroup.objects.create(report=report, name="Fixed Assets", page_type="asset", order=20)
        FinancialRow.objects.create(group=g_fa, name="Warehouse Property", order=10)
        FinancialRow.objects.create(group=g_fa, name="Warehouse Equipment (Racking, Forklifts)", order=20)
        FinancialRow.objects.create(group=g_fa, name="Delivery Trucks", order=30)
        FinancialRow.objects.create(group=g_fa, name="Office Equipment", order=40)
        FinancialRow.objects.create(group=g_fa, name="Total Fixed Assets", order=50, is_calculated=True, is_total_row=True)

        # === 3. Balance Sheet - Liabilities ===
        g_nw = FinancialGroup.objects.create(report=report, name="Net Worth", page_type="liability", order=10)
        FinancialRow.objects.create(group=g_nw, name="Share Capital", order=10)
        FinancialRow.objects.create(group=g_nw, name="Reserves & Surplus", order=20)
        FinancialRow.objects.create(group=g_nw, name="Total Net Worth", order=30, is_calculated=True, is_total_row=True)
        
        g_tl = FinancialGroup.objects.create(report=report, name="Term Liabilities", page_type="liability", order=20)
        FinancialRow.objects.create(group=g_tl, name="Long-term Loans (Warehouse Mortgage)", order=10, is_calculated=True)
        FinancialRow.objects.create(group=g_tl, name="Total Term Liabilities", order=20, is_calculated=True, is_total_row=True)

        g_cl = FinancialGroup.objects.create(report=report, name="Current Liabilities", page_type="liability", order=30)
        FinancialRow.objects.create(group=g_cl, name="Accounts Payable (to Suppliers)", order=10)
        FinancialRow.objects.create(group=g_cl, name="Line of Credit (Inventory)", order=20, is_calculated=True)
        FinancialRow.objects.create(group=g_cl, name="Total Current Liabilities", order=30, is_calculated=True, is_total_row=True)


    def _create_retail_template(self, report):
        """ Template for Retail sector businesses. """
        # (This is very similar to Wholesale, so we can just call that function)
        # You can customize this later if needed
        self._create_wholesale_template(report)

# --- (End of FinancialReportViewSet) ---


# --- API for the Financial Grids (Groups, Rows, Data) ---
# (These are separate ViewSets)

class ReportYearSettingViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint to get the list of year columns for a report.
    e.g., /api/year-settings/?report=1
    """
    queryset = ReportYearSetting.objects.all()
    serializer_class = ReportYearSettingSerializer
    # permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        Filter year settings based on the 'report' query parameter.
        """
        queryset = ReportYearSetting.objects.all().order_by('year')
        report_id = self.request.query_params.get('report')
        
        if not report_id:
            return queryset.none()

        # --- TEST CODE (no auth) ---
        return queryset.filter(report_id=report_id)


class FinancialGroupViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint to get the full, nested financial structure for a report page.
    This is what your "Operating Statement", "Assets", and "Liabilities"
    pages will call.
    
    e.g., /api/groups/?report=1&page_type=operating
    """
    queryset = FinancialGroup.objects.all()
    serializer_class = FinancialGroupSerializer
    # permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        Filter groups based on the 'report' and 'page_type' query parameters.
        We also prefetch all related rows and their data points for efficiency.
        """
        queryset = FinancialGroup.objects.prefetch_related(
            'rows__data__year_setting'
        ).order_by('order') # Order groups
        
        report_id = self.request.query_params.get('report')
        page_type = self.request.query_params.get('page_type')

        if not report_id or not page_type:
            return queryset.none() # Must specify a report and page
        
        # --- TEST CODE (no auth) ---
        return queryset.filter(report_id=report_id, page_type=page_type)


class FinancialRowViewSet(viewsets.ModelViewSet):
    """
    API endpoint for the "Manage Items" page.
    Handles creating, deleting, and updating (hiding) "heads".
    Also handles the "Run Projection" automation.
    
    We limit this to only the methods we need.
    """
    queryset = FinancialRow.objects.all()
    serializer_class = FinancialRowSerializer
    # permission_classes = [permissions.IsAuthenticated]
    # We allow create, update (for is_hidden), and destroy.
    # We do *not* allow listing all rows in one go.
    http_method_names = ['post', 'put', 'patch', 'delete', 'head', 'options']

    
    def perform_create(self, serializer):
        """
        When creating a new row, mark it as 'is_custom = True'.
        Insert before the total row in the same group.
        """
        group_id = self.request.data.get('group')
        if not group_id:
            raise serializers.ValidationError({"group": "Group ID is required."})
        
        try:
            group = FinancialGroup.objects.get(id=group_id)
        except FinancialGroup.DoesNotExist:
             raise serializers.ValidationError({"group": "Invalid Group ID."})
        
        # This is your "add above total" logic
        # Find the total row in this group to insert before it
        total_row = group.rows.filter(is_total_row=True).first()
        if total_row:
            # New row's order is one less than the total row
            new_order = total_row.order
            # Push all rows from this point down by 10
            group.rows.filter(order__gte=new_order).update(
                order=models.F('order') + 10
            )
        else:
            # No total row, just add at the end
            last_row = group.rows.order_by('-order').first()
            new_order = (last_row.order + 10) if last_row else 10
        
        serializer.save(group=group, is_custom=True, order=new_order)

    # The "Hide/Show" feature is handled by the default 'update' and 'partial_update'
    # The frontend will just send a PATCH request to /api/rows/123/
    # with the body: { "is_hidden": true }
    # ModelViewSet handles this automatically.

    @action(detail=True, methods=['post'])
    def run_projection(self, request, pk=None):
        """
        This is the "GO" button automation.
        It calculates and saves all projected values for a single row.
        
        Expected POST data:
        {
            "base_year": 2024,
            "base_value": 10000,
            "percentage": 10.0
        }
        """
        row = self.get_object()
        report = row.group.report
        
        try:
            base_year = int(request.data.get('base_year'))
            base_value = float(request.data.get('base_value'))
            percentage = float(request.data.get('percentage')) / 100.0
        except (ValueError, TypeError, AttributeError):
            return Response(
                {"error": "Invalid base_year, base_value, or percentage."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get all year columns *after* the base year
        projected_years = ReportYearSetting.objects.filter(
            report=report, 
            year__gt=base_year 
        ).order_by('year')

        current_value = base_value
        for year_setting in projected_years:
            # This is the "on-the-go" calculation logic, but on the backend
            current_value = current_value * (1 + percentage)
            
            # Save this new value to the database
            FinancialData.objects.update_or_create(
                row=row,
                year_setting=year_setting,
                defaults={'value': round(current_value, 2)} # Round to 2 decimal places
            )

        return Response(
            {"status": f"Projection for '{row.name}' complete."},
            status=status.HTTP_200_OK
        )


class FinancialDataViewSet(viewsets.GenericViewSet):
    """
    API endpoint for saving a single cell in the grid.
    We only need the 'save_cell' action.
    """
    queryset = FinancialData.objects.all()
    serializer_class = FinancialDataSerializer # Used for response
    # permission_classes = [permissions.IsAuthenticated]
    
    @action(detail=False, methods=['post'])
    def save_cell(self, request):
        """
        This is the "on-the-go" save logic for your grid.
        
        Expected POST data:
        {
            "report_id": 1,
            "row_id": 123,
            "year_setting_id": 456,
            "value": 50000
        }
        """
        try:
            report = FinancialReport.objects.get(id=request.data.get('report_id'))
            row = FinancialRow.objects.get(id=request.data.get('row_id'))
            year_setting = ReportYearSetting.objects.get(id=request.data.get('year_setting_id'))
            value = request.data.get('value', 0)
            
        except (FinancialReport.DoesNotExist, FinancialRow.DoesNotExist, ReportYearSetting.DoesNotExist, ValueError):
            return Response(
                {"error": "Invalid report, row, or year."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # This command is the core of the app:
        # It finds the cell and updates it, or creates it if it doesn't exist.
        data_point, created = FinancialData.objects.update_or_create(
            row=row,
            year_setting=year_setting,
            defaults={'value': value}
        )
        
        # --- Handle Automatic Stock Adjustments ---
        # This logic is based on your 'views.py'
        
        # Check if this row is a "closing" stock row
        closing_row_names = [
            "Closing Stock (Raw Materials)", 
            "Closing Stock (Work-in-Process)", 
            "Closing Stock (Finished Goods)",
            "Closing Inventory" # For Retail/Wholesale
        ]
        
        if row.name in closing_row_names:
            # This is a closing stock row. We need to update ALL future years' opening stock.
            
            # 1. Find the corresponding "opening" row name
            opening_row_name = row.name.replace("Closing", "Opening")
            
            # 2. Find the "opening" row object
            try:
                opening_row = FinancialRow.objects.get(
                    group=row.group, 
                    name=opening_row_name
                )
            except FinancialRow.DoesNotExist:
                 # No matching opening row, continue with normal save
                 pass
            else:
                # 3. Find ALL future year settings
                future_year_settings = ReportYearSetting.objects.filter(
                    report=report,
                    year__gt=year_setting.year
                ).order_by('year')
                
                # 4. Update opening stock for all future years
                for future_year in future_year_settings:
                    FinancialData.objects.update_or_create(
                        row=opening_row,
                        year_setting=future_year,
                        defaults={'value': value}
                    )
        
        # Also populate opening stock from previous year's closing stock on startup
        self._populate_opening_stocks(report)
        
        # Auto-calculate totals for the group after saving
        self._calculate_group_totals(row.group, report)
        
        return Response(
            {"status": "Cell saved", "id": data_point.id, "value": data_point.value},
            status=status.HTTP_200_OK
        )
    
    def _calculate_group_totals(self, group, report):
        """Calculate and save totals for all total rows in a group"""
        total_rows = group.rows.filter(is_total_row=True)
        
        for total_row in total_rows:
            # Get all non-total, non-calculated rows in this group
            item_rows = group.rows.filter(is_total_row=False, is_calculated=False)
            
            # Calculate totals for each year
            for year_setting in report.year_settings.all():
                total_value = 0
                for item_row in item_rows:
                    try:
                        data_point = FinancialData.objects.get(row=item_row, year_setting=year_setting)
                        row_value = float(data_point.value)
                        
                        # Special calculation rules
                        if (total_row.name == "= Cost of Goods Sold" and 
                            ('Closing Stock' in item_row.name or 'Closing Inventory' in item_row.name)):
                            # Subtract closing stock for COGS calculation
                            total_value -= row_value
                        elif total_row.name == "Total Assets":
                            # For Total Assets, sum all asset group totals
                            if item_row.is_total_row:
                                total_value += row_value
                        elif total_row.name == "Total Liabilities and Net Worth":
                            # For Total Liabilities, sum all liability group totals
                            if item_row.is_total_row:
                                total_value += row_value
                        else:
                            # Normal addition for all other totals
                            total_value += row_value
                            
                    except FinancialData.DoesNotExist:
                        pass  # No data for this row/year combination
                
                # Save the calculated total
                FinancialData.objects.update_or_create(
                    row=total_row,
                    year_setting=year_setting,
                    defaults={'value': total_value}
                )
    
    def _populate_opening_stocks(self, report):
        """Populate opening stocks from previous year's closing stocks"""
        opening_stock_names = [
            "Opening Stock (Raw Materials)",
            "Opening Stock (Work-in-Process)", 
            "Opening Stock (Finished Goods)",
            "Opening Inventory"
        ]
        
        closing_stock_names = [
            "Closing Stock (Raw Materials)",
            "Closing Stock (Work-in-Process)", 
            "Closing Stock (Finished Goods)",
            "Closing Inventory"
        ]
        
        # Get all year settings ordered by year
        year_settings = list(report.year_settings.all().order_by('year'))
        
        for i, opening_name in enumerate(opening_stock_names):
            closing_name = closing_stock_names[i]
            
            try:
                # Find opening and closing rows
                opening_rows = FinancialRow.objects.filter(
                    group__report=report,
                    name=opening_name
                )
                closing_rows = FinancialRow.objects.filter(
                    group__report=report,
                    name=closing_name
                )
                
                for opening_row in opening_rows:
                    for closing_row in closing_rows:
                        # For each year (except first), copy closing stock from previous year
                        for j in range(1, len(year_settings)):
                            current_year = year_settings[j]
                            previous_year = year_settings[j-1]
                            
                            try:
                                # Get previous year's closing stock
                                closing_data = FinancialData.objects.get(
                                    row=closing_row,
                                    year_setting=previous_year
                                )
                                
                                # Set current year's opening stock
                                FinancialData.objects.update_or_create(
                                    row=opening_row,
                                    year_setting=current_year,
                                    defaults={'value': closing_data.value}
                                )
                            except FinancialData.DoesNotExist:
                                pass  # No closing stock data for previous year
                                
            except FinancialRow.DoesNotExist:
                pass  # Row doesn't exist in this report
# --- Loan Schedule ViewSet ---
class LoanScheduleViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Loan Schedules.
    Handles CRUD operations for loan configurations and year summaries.
    """
    queryset = LoanSchedule.objects.all()
    serializer_class = LoanScheduleSerializer
    
    def get_queryset(self):
        queryset = LoanSchedule.objects.prefetch_related('year_summaries__year_setting').all()
        report_id = self.request.query_params.get('report')
        if report_id:
            return queryset.filter(report_id=report_id)
        return queryset
    
    def perform_create(self, serializer):
        """Create loan schedule and generate year summaries"""
        loan_schedule = serializer.save()
        
        # Generate year summaries after creating loan schedule
        self._generate_year_summaries(loan_schedule)
        
    def perform_update(self, serializer):
        """Update loan schedule and regenerate year summaries"""
        loan_schedule = serializer.save()
        
        # Delete old summaries and regenerate
        LoanYearSummary.objects.filter(loan_schedule=loan_schedule).delete()
        self._generate_year_summaries(loan_schedule)
    
    def _generate_year_summaries(self, loan_schedule):
        """
        Generate annual summaries for the loan schedule.
        This uses the EMI calculation logic to create month-by-month schedule
        and then aggregates to annual summaries.
        """
        from decimal import Decimal
        
        report = loan_schedule.report
        year_settings = report.year_settings.all().order_by('year')
        
       # Calculate monthly rate
        monthly_rate = float(loan_schedule.interest_rate) / 100 / 12
        
        # Calculate EMI (for repayment period)
        repayment_months = loan_schedule.tenure_months - loan_schedule.moratorium_months
        
        if repayment_months > 0 and monthly_rate > 0:
            # EMI formula: P × r × (1+r)^n / [(1+r)^n - 1]
            principal = float(loan_schedule.loan_amount)
            emi = principal * monthly_rate * pow(1 + monthly_rate, repayment_months) / (pow(1 + monthly_rate, repayment_months) - 1)
        elif repayment_months > 0:
            # Zero interest rate
            emi = float(loan_schedule.loan_amount) / repayment_months
        else:
            emi = 0
        
        # Generate monthly schedule
        opening_balance = float(loan_schedule.loan_amount)
        monthly_schedule = []
        
        for period in range(1, loan_schedule.tenure_months + 1):
            interest = opening_balance * monthly_rate
            
            if period <= loan_schedule.moratorium_months:
                # Moratorium period: interest-only
                principal_payment = 0
                payment = interest
            elif loan_schedule.repayment_method == 'BULLET':
                # Bullet: interest-only, principal at end
                principal_payment = opening_balance if period == loan_schedule.tenure_months else 0
                payment = interest + principal_payment
            else:
                # EMI method
                principal_payment = emi - interest
                payment = emi
            
            closing_balance = opening_balance - principal_payment
            
            monthly_schedule.append({
                'period': period,
                'opening': opening_balance,
                'interest': interest,
                'principal': principal_payment,
                'payment': payment,
                'closing': closing_balance
            })
            
            opening_balance = closing_balance
        
        # Aggregate to annual summaries
        start_year_index = list(year_settings).index(loan_schedule.start_year)
        month_index = 0
        
        summaries_to_create = []
        
        for idx, year_setting in enumerate(year_settings):
            if idx < start_year_index:
                # Loan hasn't started yet
                continue
            
            if month_index >= len(monthly_schedule):
                # Loan is fully repaid
                break
            
            months_in_year = min(12, len(monthly_schedule) - month_index)
            
            year_opening = monthly_schedule[month_index]['opening']
            year_interest = sum(m['interest'] for m in monthly_schedule[month_index:month_index + months_in_year])
            year_principal = sum(m['principal'] for m in monthly_schedule[month_index:month_index + months_in_year])
            year_closing = monthly_schedule[month_index + months_in_year - 1]['closing']
            avg_emi = sum(m['payment'] for m in monthly_schedule[month_index:month_index + months_in_year]) / months_in_year if months_in_year > 0 else 0
            
            summaries_to_create.append(LoanYearSummary(
                loan_schedule=loan_schedule,
                year_setting=year_setting,
                opening_balance=Decimal(str(round(year_opening, 2))),
                annual_interest=Decimal(str(round(year_interest, 2))),
                annual_principal=Decimal(str(round(year_principal, 2))),
                closing_balance=Decimal(str(round(year_closing, 2))),
                calculated_emi=Decimal(str(round(avg_emi, 2)))
            ))
            
            month_index += months_in_year
        
        # Bulk create all summaries
        LoanYearSummary.objects.bulk_create(summaries_to_create)
