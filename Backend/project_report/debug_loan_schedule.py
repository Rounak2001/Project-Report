import os
import django
import sys

# Setup Django environment
sys.path.append('/home/rounak-patel/Desktop/web_coding/project-report-maker/Fineline/Backend/project_report')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project_report.settings')
django.setup()

from core.models import LoanSchedule, LoanYearSummary

def check_loan_schedules():
    print("Checking Loan Schedules...")
    schedules = LoanSchedule.objects.all()
    
    if not schedules.exists():
        print("No loan schedules found.")
        return

    for schedule in schedules:
        print(f"\nLoan Schedule ID: {schedule.id}, Amount: {schedule.loan_amount}")
        summaries = schedule.year_summaries.all().order_by('id') # Order by ID to see insertion order
        print(f"Total Summaries: {summaries.count()}")
        
        for summary in summaries:
            print(f"  - Year Label: {summary.year_label}, Year Setting: {summary.year_setting}, Opening: {summary.opening_balance}")

if __name__ == "__main__":
    check_loan_schedules()
