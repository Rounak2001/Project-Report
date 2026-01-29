"""
SQLite-based cleanup script to fix duplicate Drawings rows.
Run with: python3 cleanup_drawings_sqlite.py
"""

import sqlite3

# Connect to the database
conn = sqlite3.connect('db.sqlite3')
cursor = conn.cursor()

print("=== Finding Duplicate Drawings Rows ===")

# Find all Drawings rows
cursor.execute("""
    SELECT r.id, r.name, r.group_id, g.name as group_name, g.report_id
    FROM core_financialrow r
    JOIN core_financialgroup g ON r.group_id = g.id
    WHERE LOWER(r.name) = 'drawings'
    ORDER BY r.group_id, r.id
""")

drawings_rows = cursor.fetchall()
print(f"Found {len(drawings_rows)} Drawings rows total:")

for row in drawings_rows:
    row_id, row_name, group_id, group_name, report_id = row
    
    # Count data points for this row
    cursor.execute("SELECT COUNT(*) FROM core_financialdata WHERE row_id = ?", (row_id,))
    data_count = cursor.fetchone()[0]
    
    print(f"  Row ID {row_id}: '{row_name}' in group '{group_name}' (Report {report_id}) - {data_count} data points")

if len(drawings_rows) <= 1:
    print("\n✓ No duplicates to clean up!")
    conn.close()
    exit()

# Group by report_id
from collections import defaultdict
by_report = defaultdict(list)
for row in drawings_rows:
    row_id, row_name, group_id, group_name, report_id = row
    cursor.execute("SELECT COUNT(*) FROM core_financialdata WHERE row_id = ?", (row_id,))
    data_count = cursor.fetchone()[0]
    by_report[report_id].append((row_id, data_count, group_name))

print("\n=== Cleanup Plan ===")
for report_id, rows in by_report.items():
    if len(rows) > 1:
        print(f"\nReport {report_id}: Found {len(rows)} Drawings rows")
        # Keep the one with most data
        rows.sort(key=lambda x: x[1], reverse=True)
        keep_id = rows[0][0]
        print(f"  KEEPING Row ID {keep_id} (has {rows[0][1]} data points)")
        
        for row_id, data_count, group_name in rows[1:]:
            print(f"  DELETE Row ID {row_id} (has {data_count} data points)")

# Ask for confirmation
confirm = input("\nType 'yes' to proceed with cleanup: ")
if confirm.lower() != 'yes':
    print("Cancelled.")
    conn.close()
    exit()

# Perform cleanup
print("\n=== Executing Cleanup ===")
for report_id, rows in by_report.items():
    if len(rows) > 1:
        rows.sort(key=lambda x: x[1], reverse=True)
        keep_id = rows[0][0]
        
        for row_id, data_count, group_name in rows[1:]:
            # Delete data first (foreign key)
            cursor.execute("DELETE FROM core_financialdata WHERE row_id = ?", (row_id,))
            # Delete the row
            cursor.execute("DELETE FROM core_financialrow WHERE id = ?", (row_id,))
            print(f"  Deleted Row ID {row_id}")

conn.commit()
print("\n✓ Cleanup complete!")

# Verify
cursor.execute("""
    SELECT COUNT(*) FROM core_financialrow WHERE LOWER(name) = 'drawings'
""")
remaining = cursor.fetchone()[0]
print(f"Remaining Drawings rows: {remaining}")

conn.close()
