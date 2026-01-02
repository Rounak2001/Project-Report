"""
Main URL Configuration for your Django project.
"""
from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter

# Import all the ViewSets from your 'core' app's views.py
from core.views import (
    FinancialReportViewSet,
    TermLoanViewSet,
    ProjectCostItemViewSet,
    ReportYearSettingViewSet,
    FinancialGroupViewSet,
    FinancialRowViewSet,
    FinancialDataViewSet,
    LoanScheduleViewSet,
    ExistingWorkingCapitalLoanViewSet,
    DrawingViewSet,
    download_report_pdf  # Add PDF download view
)

# This is the "magic" that automatically creates all the API routes
# for GET, POST, PUT, DELETE, etc.
router = DefaultRouter()

# We use basename='...' to prevent naming conflicts
router.register(r'reports', FinancialReportViewSet, basename='financialreport')
router.register(r'term-loans', TermLoanViewSet, basename='termloan')
router.register(r'project-costs', ProjectCostItemViewSet, basename='projectcostitem')
router.register(r'year-settings', ReportYearSettingViewSet, basename='reportyearsetting')
router.register(r'groups', FinancialGroupViewSet, basename='financialgroup')
router.register(r'rows', FinancialRowViewSet, basename='financialrow')
router.register(r'data', FinancialDataViewSet, basename='financialdata')
router.register(r'loan-schedules', LoanScheduleViewSet, basename='loanschedule')
router.register(r'existing-wc-loans', ExistingWorkingCapitalLoanViewSet, basename='existingwcloan')
router.register(r'drawings', DrawingViewSet, basename='drawing')

urlpatterns = [
    # PDF download endpoint
    path('reports/<int:report_id>/download-pdf/', download_report_pdf, name='download-report-pdf'),
    # This one line includes all the API routes we just registered
    path('', include(router.urls)),
]