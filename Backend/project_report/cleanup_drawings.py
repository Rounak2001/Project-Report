"""
Database cleanup script to fix duplicate Drawings rows.
Run this with: python manage.py shell < cleanup_drawings.py
"""

from core.models import FinancialRow, Report

# Find all reports
reports = Report.objects.all()

for report in reports:
    print(f"\n=== Report ID: {report.id} - {report.project_name} ===")
    
    # Find all Drawings rows in this report
    drawings_rows = FinancialRow.objects.filter(
        group__report=report,
        name__iexact='Drawings'
    )
    
    if drawings_rows.count() > 1:
        print(f"  FOUND {drawings_rows.count()} duplicate Drawings rows!")
        
        # Keep the first one with most data, delete the rest
        best_row = None
        max_data_count = -1
        
        for row in drawings_rows:
            data_count = row.data.count() if hasattr(row, 'data') else 0
            print(f"    Row ID {row.id}: {data_count} data points, group: {row.group.name}")
            if data_count > max_data_count:
                max_data_count = data_count
                best_row = row
        
        if best_row:
            print(f"  KEEPING Row ID {best_row.id} with {max_data_count} data points")
            # Delete duplicates
            for row in drawings_rows:
                if row.id != best_row.id:
                    print(f"  DELETING Row ID {row.id}")
                    row.delete()
        print("  Cleanup complete for this report!")
    elif drawings_rows.count() == 1:
        print("  ✓ Only 1 Drawings row (no duplicates)")
    else:
        print("  No Drawings row found")

print("\n=== Cleanup Complete ===")
