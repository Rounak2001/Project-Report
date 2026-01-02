import os
import django
import sys

# Setup Django environment
sys.path.append('/home/rounak-patel/Desktop/web_coding/project-report-maker/Fineline/Backend/project_report')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project_report.settings')
django.setup()

from core.models import ReportYearSetting, FinancialReport

def cleanup_report_21():
    print("Cleaning up Report 21...")
    try:
        report = FinancialReport.objects.get(id=21)
        print(f"Report: {report.company_name}, Start Year: {report.start_year}, Total Years: {report.total_years_in_report}")
        
        # Calculate valid end year
        # Start year is an integer e.g. 2024
        # If total years is 4: 2024, 2025, 2026, 2027.
        # So valid years are < start_year + total_years
        
        valid_end_year = report.start_year + report.total_years_in_report
        print(f"Valid years are strictly less than: {valid_end_year}")
        
        extra_settings = ReportYearSetting.objects.filter(report=report, year__gte=valid_end_year)
        count = extra_settings.count()
        
        if count > 0:
            print(f"Found {count} extra year settings to delete:")
            for s in extra_settings:
                print(f" - {s.year} ({s.year_display})")
            
            # Delete
            extra_settings.delete()
            print("Deletion complete.")
        else:
            print("No extra year settings found.")
            
    except FinancialReport.DoesNotExist:
        print("Report 21 not found.")

if __name__ == "__main__":
    cleanup_report_21()
