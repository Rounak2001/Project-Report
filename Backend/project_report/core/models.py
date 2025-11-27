import datetime
from django.db import models
from django.contrib.auth.models import User
from django.utils.timezone import now

# --- Helper: Get default user ---
def get_default_user():
    return User.objects.first()

# --- 1. The Main Report (Project) ---
class FinancialReport(models.Model):
    SECTOR_CHOICES = [
        ('service', 'Service'),
        ('industry', 'Industry (Manufacturing)'),
        ('wholesale', 'Wholesale'),
        ('retail', 'Retailers'),
    ]
    
    LOAN_CHOICES = [
        ('term', 'Term Loan Only'),
        ('wc', 'Working Capital Only'),
        ('both', 'Both Term Loan & Working Capital'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reports")
    company_name = models.CharField(max_length=255, default="Untitled Report")
    address = models.TextField(blank=True, null=True)
    gst_number = models.CharField(max_length=15, blank=True, null=True)
    sector = models.CharField(max_length=20, choices=SECTOR_CHOICES, default='service')
    
    # Report Settings
    start_year = models.IntegerField(default=datetime.date.today().year)
    # Note: removed audited_years as per your previous simplified request, 
    # but if you need it, you can add it back. 
    # Using total_years_in_report for the grid.
    total_years_in_report = models.IntegerField(default=7, help_text="Total columns (e.g., 2 Actual + 5 Projected)")
    
    # Loan Settings
    has_existing_term_loan = models.BooleanField(default=False)
    new_loan_type = models.CharField(max_length=10, choices=LOAN_CHOICES, default='term')
    
    # New Term Loan Settings
    new_loan_contribution_percent = models.DecimalField(max_digits=5, decimal_places=2, default=20.0)
    new_loan_interest_rate = models.DecimalField(max_digits=5, decimal_places=2, default=10.0)
    new_loan_tenure_years = models.IntegerField(default=5)
    new_loan_moratorium_months = models.IntegerField(default=6)
    
    # --- FIX IS HERE: Use datetime.date.today instead of now ---
    new_loan_start_date = models.DateField(default=datetime.date.today)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.company_name} (ID: {self.id})"

# --- 2. Existing Term Loans ---
class TermLoan(models.Model):
    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="existing_term_loans")
    user = models.ForeignKey(User, on_delete=models.CASCADE) # Added user for permission consistency
    loan_name = models.CharField(max_length=100, default="Existing Loan")
    
    # Updated fields based on your requirement
    outstanding_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=0, 
        help_text="Loan outstanding at audited year"
    )
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2, default=10.00)
    emi = models.DecimalField(
        max_digits=14, decimal_places=2, default=0, 
        help_text="Monthly EMI"
    )
    remaining_tenure_years = models.IntegerField(
        default=5, 
        help_text="How many more years to complete the loan?"
    )

    def __str__(self):
        return self.loan_name

# --- 3. New Project Cost ---
class ProjectCostItem(models.Model):
    ASSET_TYPE_CHOICES = [
        ('Land', 'Land'),
        ('Building', 'Building'),
        ('Machinery', 'Machinery'),
        ('Computers', 'Computers'),
        ('Furniture', 'Furniture'),
        ('Racks', 'Racks'),
        ('Electrification', 'Electrification'),
        ('Vehicle', 'Vehicle'),
        ('Software', 'Software'),
        ('A/c', 'A/c'),
        ('Other', 'Other investment'),
    ]

    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="project_cost_items")
    user = models.ForeignKey(User, on_delete=models.CASCADE) # Added user for permission consistency
    asset_type = models.CharField(max_length=50, choices=ASSET_TYPE_CHOICES, default='Machinery')
    asset_name = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    depreciation_rate = models.DecimalField(max_digits=5, decimal_places=2, default=10.0)
    purchase_year = models.ForeignKey('ReportYearSetting', null=True, blank=True, on_delete=models.SET_NULL)
    is_existing_asset = models.BooleanField(default=False)
    is_second_half_purchase = models.BooleanField(default=False)

    def __str__(self):
        return self.asset_name

# --- 4. Financial Groups ---
class FinancialGroup(models.Model):
    PAGE_CHOICES = [
        ('operating', 'Operating Statement'),
        ('asset', 'Assets'),
        ('liability', 'Liabilities'),
    ]
    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="groups")
    name = models.CharField(max_length=100)
    page_type = models.CharField(max_length=20, choices=PAGE_CHOICES)
    order = models.IntegerField(default=0)
    is_custom = models.BooleanField(default=False)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.name} ({self.page_type})"

# --- 5. Financial Rows ---
class FinancialRow(models.Model):
    group = models.ForeignKey(FinancialGroup, on_delete=models.CASCADE, related_name="rows")
    name = models.CharField(max_length=100)
    order = models.IntegerField(default=0)
    is_custom = models.BooleanField(default=False)      
    is_calculated = models.BooleanField(default=False) 
    is_total_row = models.BooleanField(default=False) # Added is_total_row
    is_hidden = models.BooleanField(default=False) # Added is_hidden
    
    # Unique key for automation (e.g. 'total_sales', 'gross_profit')
    calculation_key = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.name

# --- 6. Report Year Settings ---
class ReportYearSetting(models.Model):
    YEAR_TYPE_CHOICES = [
        ('Actual', 'Actual'),
        ('Provisional', 'Provisional'),
        ('Projected', 'Projected'),
    ]
    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="year_settings")
    year = models.IntegerField()
    year_display = models.CharField(max_length=20) # e.g. "2024-2025"
    year_type = models.CharField(max_length=20, choices=YEAR_TYPE_CHOICES)

    class Meta:
        ordering = ['year']

    def __str__(self):
        return f"{self.year} ({self.year_type})"

# --- 7. Financial Data ---
class FinancialData(models.Model):
    row = models.ForeignKey(FinancialRow, on_delete=models.CASCADE, related_name="data")
    year_setting = models.ForeignKey(ReportYearSetting, on_delete=models.CASCADE, related_name="data_points") # Changed from 'year' integer to FK
    value = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        unique_together = ('row', 'year_setting')

    def __str__(self):
        return f"{self.row.name} - {self.value}"

# --- 8. Loan Schedule ---
class LoanSchedule(models.Model):
    """Stores loan configuration for repayment schedule"""
    REPAYMENT_METHOD_CHOICES = [
        ('EMI', 'Reducing Balance (EMI)'),
        ('BULLET', 'Bullet Repayment'),
        ('CUSTOM', 'Custom Schedule'),
    ]
    
    report = models.ForeignKey(FinancialReport, on_delete=models.CASCADE, related_name="loan_schedules")
    loan_amount = models.DecimalField(max_digits=15, decimal_places=2, help_text="Total loan amount")
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2, help_text="Annual interest rate (%)")
    tenure_months = models.IntegerField(help_text="Total loan tenure in months")
    moratorium_months = models.IntegerField(default=0, help_text="Moratorium period (interest-only, no principal)")
    repayment_method = models.CharField(max_length=20, choices=REPAYMENT_METHOD_CHOICES, default='EMI')
    start_year = models.ForeignKey(ReportYearSetting, on_delete=models.CASCADE, related_name="loan_schedules_started")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Loan Schedule for {self.report.company_name} - ₹{self.loan_amount}"

class LoanYearSummary(models.Model):
    """Annual aggregates for financial statement integration"""
    loan_schedule = models.ForeignKey(LoanSchedule, on_delete=models.CASCADE, related_name="year_summaries")
    year_setting = models.ForeignKey(ReportYearSetting, on_delete=models.CASCADE, related_name="loan_summaries")
    
    # Financial statement values
    opening_balance = models.DecimalField(max_digits=15, decimal_places=2, help_text="Opening loan balance")
    annual_interest = models.DecimalField(max_digits=15, decimal_places=2, help_text="Interest expense for P&L")
    annual_principal = models.DecimalField(max_digits=15, decimal_places=2, help_text="Principal repayment for Cash Flow")
    closing_balance = models.DecimalField(max_digits=15, decimal_places=2, help_text="Closing loan balance for Balance Sheet")
    
    # Optional: Store calculated EMI for UI display
    calculated_emi = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, help_text="Monthly EMI amount")
    
    class Meta:
        unique_together = ['loan_schedule', 'year_setting']
        ordering = ['year_setting__year']
    
    def __str__(self):
        return f"{self.loan_schedule.report.company_name} - {self.year_setting.year_display}"