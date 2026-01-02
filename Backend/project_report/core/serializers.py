from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    FinancialReport, TermLoan, ProjectCostItem, 
    ReportYearSetting, FinancialGroup, FinancialRow, FinancialData,
    LoanSchedule, LoanYearSummary, TermLoanYearSummary, ExistingWorkingCapitalLoan,
    Drawing
)
import datetime

# --- We will auto-assign the first user (admin) for now ---
# This is a helper function to get that user
def get_first_user():
    return User.objects.first()

# --- Serializer for the Year/Column Headers ---
# This reads the "ReportYearSetting" model
class ReportYearSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportYearSetting
        fields = ['id', 'year', 'year_display', 'year_type']

# --- Serializer for the main Report object ---
# This reads and writes to the FinancialReport model
# Used by the "Company Details" and "Project Setup" pages
class FinancialReportSerializer(serializers.ModelSerializer):
    # We will set the user from the view, so it's read-only here
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = FinancialReport
        # We list all the fields from your models.py
        fields = [
            'id', 
            'user', # Make sure 'user' is in the list
            'company_name', 
            'address', 
            'gst_number', 
            'sector',
            'start_year', 
            'total_years_in_report',
            'tax_regime', # Added tax_regime
            'has_existing_term_loan',
            'new_loan_type', 
            'new_loan_contribution_percent', 
            'new_loan_interest_rate',
            'new_loan_tenure_years', 
            'new_loan_moratorium_months', 
            'new_loan_start_date',
            'wc_requirement_type',
            'existing_wc_limit',
            'existing_wc_interest_rate',
            'proposed_wc_limit',
            'proposed_wc_interest_rate',
            'created_at',
            'updated_at',
            # 'year_settings' # We will get this from its own endpoint
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']

# --- Serializer for Term Loan Year Summary ---
class TermLoanYearSummarySerializer(serializers.ModelSerializer):
    year_setting = ReportYearSettingSerializer(read_only=True)
    year_setting_id = serializers.PrimaryKeyRelatedField(
        queryset=ReportYearSetting.objects.all(),
        source='year_setting',
        write_only=True,
        required=False, # Now optional
        allow_null=True
    )
    
    class Meta:
        model = TermLoanYearSummary
        fields = [
            'id', 'year_setting', 'year_setting_id', 'year_label', # Added year_label
            'opening_balance', 'annual_interest', 'annual_principal', 
            'closing_balance', 'calculated_emi'
        ]

# --- Serializer for the "Existing Term Loans" list (UPDATED) ---
class TermLoanSerializer(serializers.ModelSerializer):
    # This ensures that when creating a loan, the report ID is tied
    # to the currently active report, but isn't required from the user.
    report = serializers.PrimaryKeyRelatedField(
        queryset=FinancialReport.objects.all(), 
        required=False
    )
    # We will set the user from the view
    user = serializers.PrimaryKeyRelatedField(read_only=True)
    
    # Nested summaries
    year_summaries = TermLoanYearSummarySerializer(many=True, read_only=True)

    class Meta:
        model = TermLoan
        # UPDATED fields to match your new requirements
        fields = [
            'id', 
            'report',
            'user',
            'loan_name', 
            'start_date',
            'original_amount',
            'tenure_months',
            'repayment_method',
            'outstanding_amount',
            'interest_rate', 
            'emi', 
            'remaining_tenure_years',
            'year_summaries'
        ]

# --- Serializer for the "Project Cost (Details of Asset)" list ---
class ProjectCostItemSerializer(serializers.ModelSerializer):
    report = serializers.PrimaryKeyRelatedField(
        queryset=FinancialReport.objects.all(), 
        required=False
    )
    # We will set the user from the view
    user = serializers.PrimaryKeyRelatedField(read_only=True)
    
    class Meta:
        model = ProjectCostItem
        fields = [
            'id', 
            'report', 
            'user',
            'asset_type', 
            'asset_name', 
            'amount', 
            'depreciation_rate',
            'purchase_year',
            'is_existing_asset',
            'is_second_half_purchase'
        ]

# --- "Cell Value" / Data Model Serializer ---
# This reads the "FinancialData" model
class FinancialDataSerializer(serializers.ModelSerializer):
    # We send the 'year_setting' ID so the frontend knows which column this value belongs to
    # We use PrimaryKeyRelatedField for efficiency.
    year_setting = serializers.PrimaryKeyRelatedField(read_only=True)
    
    class Meta:
        model = FinancialData
        fields = ['id', 'year_setting', 'value']


# --- "Line Item" / Row Model Serializer (UPDATED) ---
# This reads the "FinancialRow" model
# It's "nested" - it will automatically find and include all
# "cell values" (FinancialData) that belong to this row.
class FinancialRowSerializer(serializers.ModelSerializer):
    # This is the "nesting" part.
    # 'data' is the related_name we set in models.py
    data = FinancialDataSerializer(many=True, read_only=True)

    class Meta:
        model = FinancialRow
        fields = [
            'id', 
            'group', 
            'name', 
            'order', 
            'is_custom', 
            'is_calculated', 
            'is_total_row',
            'is_hidden', # <-- THIS IS THE NEW FIELD
            'data' # This will contain the list of cell values
        ]
        # 'is_hidden' is NOT read_only, so the frontend can update it.
        read_only_fields = ['group', 'is_custom', 'is_calculated', 'is_total_row']


# --- "Big Head" / Group Model Serializer ---
# This is the main serializer your frontend will use.
# It reads the "FinancialGroup" model
# It automatically nests all "FinancialRow"s (sorted by display_order)
# that belong to this group.
class FinancialGroupSerializer(serializers.ModelSerializer):
    # This is the "nesting" part.
    # 'rows' is the related_name we set in models.py
    # We sort this by 'order' to match your "above total" logic
    rows = FinancialRowSerializer(many=True, read_only=True)

    class Meta:
        model = FinancialGroup
        fields = [
            'id', 
            'name', 
            'page_type', 
            'order',
            'cf_bucket',    # Cash flow activity bucket
            'nature',       # Direction of cash impact
            'system_tag',   # Unique logic identifier
            'rows' # This will contain the list of rows (which contain their data)
        ]





# --- Serializer for Loan Year Summary ---
class LoanYearSummarySerializer(serializers.ModelSerializer):
    year_setting = ReportYearSettingSerializer(read_only=True)
    
    class Meta:
        model = LoanYearSummary
        fields = [
            'id', 'year_setting', 'year_label', # Added year_label
            'opening_balance', 'annual_interest',
            'annual_principal', 'closing_balance', 'calculated_emi'
        ]

# --- Serializer for Loan Schedule ---
class LoanScheduleSerializer(serializers.ModelSerializer):
    year_summaries = LoanYearSummarySerializer(many=True, read_only=True)
    start_year = ReportYearSettingSerializer(read_only=True)
    start_year_id = serializers.PrimaryKeyRelatedField(
        queryset=ReportYearSetting.objects.all(),
        source='start_year',
        write_only=True
    )
    
    class Meta:
        model = LoanSchedule
        fields = [
            'id', 'report', 'loan_amount', 'interest_rate', 
            'tenure_months', 'moratorium_months', 'repayment_method',
            'start_year', 'start_year_id', 'created_at', 'year_summaries',
            'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

# --- Serializer for Existing Working Capital Loans ---
class ExistingWorkingCapitalLoanSerializer(serializers.ModelSerializer):
    report = serializers.PrimaryKeyRelatedField(
        queryset=FinancialReport.objects.all(), 
        required=False
    )
    
    class Meta:
        model = ExistingWorkingCapitalLoan
        fields = ['id', 'report', 'bank_name', 'sanctioned_amount', 'interest_rate']


# --- Serializer for Drawings (LLP/Proprietorship) ---
class DrawingSerializer(serializers.ModelSerializer):
    report = serializers.PrimaryKeyRelatedField(
        queryset=FinancialReport.objects.all(), 
        required=False
    )
    year_setting = serializers.PrimaryKeyRelatedField(
        queryset=ReportYearSetting.objects.all()
    )
    
    class Meta:
        model = Drawing
        fields = ['id', 'report', 'year_setting', 'name', 'amount']