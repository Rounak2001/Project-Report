"""
PDF Generation Service for CMA Report
Generates professional bank-ready PDF reports using HTML templates
"""

from io import BytesIO
from django.template.loader import render_to_string
from django.http import HttpResponse
from decimal import Decimal

# Try to import PDF engines in order of preference
PDF_ENGINE = None

try:
    from weasyprint import HTML, CSS
    PDF_ENGINE = 'weasyprint'
except ImportError:
    pass

if not PDF_ENGINE:
    try:
        import pdfkit
        PDF_ENGINE = 'pdfkit'
    except ImportError:
        pass

if not PDF_ENGINE:
    try:
        from xhtml2pdf import pisa
        PDF_ENGINE = 'xhtml2pdf'
    except ImportError:
        pass


def format_indian_currency(value):
    """Format value as Indian currency (₹ X,XX,XXX)"""
    if value is None:
        return "₹0"
    
    try:
        num = float(value)
    except (ValueError, TypeError):
        return "₹0"
    
    is_negative = num < 0
    num = abs(num)
    
    # Format with Indian number system
    if num >= 10000000:  # Crore
        formatted = f"{num/10000000:.2f} Cr"
    elif num >= 100000:  # Lakh
        formatted = f"{num/100000:.2f} L"
    else:
        # Standard Indian format
        s = f"{num:,.0f}"
        # Convert western format to Indian format
        parts = s.split(',')
        if len(parts) > 1:
            last_three = parts[-1]
            rest = ','.join(parts[:-1]).replace(',', '')
            if rest:
                # Group by 2 for Indian system
                indian_groups = []
                while len(rest) > 2:
                    indian_groups.insert(0, rest[-2:])
                    rest = rest[:-2]
                if rest:
                    indian_groups.insert(0, rest)
                formatted = ','.join(indian_groups) + ',' + last_three
            else:
                formatted = last_three
        else:
            formatted = s
    
    prefix = "-₹" if is_negative else "₹"
    return f"{prefix}{formatted}"


def format_ratio(value, suffix=''):
    """Format ratio values with 2 decimal places"""
    if value is None:
        return "0.00" + suffix
    try:
        return f"{float(value):.2f}{suffix}"
    except (ValueError, TypeError):
        return "0.00" + suffix


def get_ratio_status(value, good_fn, warn_fn):
    """Determine status (good/warn/bad) for a ratio value"""
    try:
        v = float(value) if value is not None else 0
        if good_fn(v):
            return 'good'
        elif warn_fn(v):
            return 'warn'
        else:
            return 'bad'
    except:
        return 'bad'


def prepare_rows_from_groups(groups, year_settings, page_type='operating'):
    """Prepare rows from actual database groups for template"""
    rows = []
    
    for group in groups:
        # Add group header
        rows.append({
            'type': 'subheader', 
            'label': group.name, 
            'values': [''] * len(year_settings)
        })
        
        for row in group.rows.all().order_by('order'):
            if row.is_hidden:
                continue
            
            # Get values for all years
            values = []
            for year in year_settings:
                data_point = row.data.filter(year_setting_id=year['id']).first()
                if data_point and data_point.value is not None:
                    values.append(format_indian_currency(float(data_point.value)))
                else:
                    values.append('₹0')
            
            # Determine row type based on row properties
            if row.is_total_row:
                row_type = 'grandtotal' if 'total' in row.name.lower() and ('asset' in row.name.lower() or 'liabilities' in row.name.lower() or 'net worth' in row.name.lower()) else 'total'
            elif row.is_calculated:
                row_type = 'total'
            else:
                row_type = 'item'
            
            rows.append({
                'type': row_type,
                'label': row.name,
                'values': values,
                'indent': 1 if not row.is_total_row and not row.is_calculated else 0
            })
    
    return rows


def prepare_operating_rows(operating_groups, year_settings):
    """Prepare operating statement rows from actual groups"""
    return prepare_rows_from_groups(operating_groups, year_settings, 'operating')


def prepare_asset_rows(asset_groups, year_settings):
    """Prepare asset rows from actual groups"""
    return prepare_rows_from_groups(asset_groups, year_settings, 'asset')


def prepare_liability_rows(liability_groups, year_settings):
    """Prepare liability rows from actual groups"""
    return prepare_rows_from_groups(liability_groups, year_settings, 'liability')


def prepare_cashflow_rows(calculations, year_settings):
    """Prepare cash flow statement rows"""
    rows = []
    cf_years = year_settings[1:] if len(year_settings) > 1 else year_settings
    
    # Operating Activities
    rows.append({'type': 'header', 'label': 'A. Cash Flow from Operating Activities', 'values': [''] * len(cf_years)})
    
    cf_items = [
        ('CF_PAT', 'Profit After Tax'),
        ('CF_Add_Depreciation', 'Add: Depreciation'),
        ('CF_Add_Interest', 'Add: Interest Costs'),
    ]
    for key, label in cf_items:
        values = [format_indian_currency(calculations.get(y['id'], {}).get(key, 0)) for y in cf_years]
        rows.append({'type': 'item', 'label': label, 'values': values, 'indent': 1})
    
    values = [format_indian_currency(calculations.get(y['id'], {}).get('CF_Operating_Total', 0)) for y in cf_years]
    rows.append({'type': 'total', 'label': 'Net Cash from Operating Activities', 'values': values})
    
    # Investing Activities
    rows.append({'type': 'header', 'label': 'B. Cash Flow from Investing Activities', 'values': [''] * len(cf_years)})
    values = [format_indian_currency(calculations.get(y['id'], {}).get('CF_Investing_Fixed_Assets', 0)) for y in cf_years]
    rows.append({'type': 'item', 'label': 'Fixed Assets (Capex)', 'values': values, 'indent': 1})
    
    values = [format_indian_currency(calculations.get(y['id'], {}).get('CF_Investing_Total', 0)) for y in cf_years]
    rows.append({'type': 'total', 'label': 'Net Cash from Investing Activities', 'values': values})
    
    # Financing Activities
    rows.append({'type': 'header', 'label': 'C. Cash Flow from Financing Activities', 'values': [''] * len(cf_years)})
    values = [format_indian_currency(calculations.get(y['id'], {}).get('CF_Financing_Interest_Paid', 0)) for y in cf_years]
    rows.append({'type': 'item', 'label': 'Interest & Finance Costs Paid', 'values': values, 'indent': 1})
    
    values = [format_indian_currency(calculations.get(y['id'], {}).get('CF_Financing_Total', 0)) for y in cf_years]
    rows.append({'type': 'total', 'label': 'Net Cash from Financing Activities', 'values': values})
    
    # Net Cash Flow
    rows.append({'type': 'grandtotal', 'label': 'Net Cash Flow (A + B + C)', 
                 'values': [format_indian_currency(calculations.get(y['id'], {}).get('CF_Net_Cash_Flow', 0)) for y in cf_years]})
    
    rows.append({'type': 'item', 'label': 'Opening Cash Balance', 
                 'values': [format_indian_currency(calculations.get(y['id'], {}).get('CF_Opening_Cash', 0)) for y in cf_years]})
    
    rows.append({'type': 'grandtotal', 'label': 'Closing Cash Balance', 
                 'values': [format_indian_currency(calculations.get(y['id'], {}).get('CF_Closing_Cash', 0)) for y in cf_years]})
    
    return rows, cf_years


def prepare_ratio_categories(calculations, year_settings):
    """Prepare ratio categories with values and status"""
    
    ratio_definitions = [
        {
            'name': 'A. Liquidity Ratios (Short-Term Health)',
            'ratios': [
                {'key': 'Current Ratio', 'name': 'Current Ratio', 'ideal': '> 1.33', 'suffix': ':1',
                 'good_fn': lambda v: v >= 1.33, 'warn_fn': lambda v: v >= 1.0},
                {'key': 'Quick Ratio', 'name': 'Quick Ratio', 'ideal': '> 1.0', 'suffix': ':1',
                 'good_fn': lambda v: v >= 1.0, 'warn_fn': lambda v: v >= 0.7},
                {'key': 'Net Working Capital (NWC)', 'name': 'Net Working Capital', 'ideal': 'Positive', 'suffix': '',
                 'good_fn': lambda v: v > 0, 'warn_fn': lambda v: v >= -10000, 'is_currency': True},
            ]
        },
        {
            'name': 'B. Solvency / Leverage Ratios',
            'ratios': [
                {'key': 'Debt-to-Equity Ratio (DER)', 'name': 'Debt-to-Equity Ratio', 'ideal': '< 2.0', 'suffix': ':1',
                 'good_fn': lambda v: v <= 2.0, 'warn_fn': lambda v: v <= 3.0},
                {'key': 'TOL/TNW', 'name': 'TOL/TNW', 'ideal': '< 3.0', 'suffix': ':1',
                 'good_fn': lambda v: v <= 3.0, 'warn_fn': lambda v: v <= 4.0},
                {'key': 'Interest Coverage Ratio (ISCR)', 'name': 'Interest Coverage (ISCR)', 'ideal': '> 2.0x', 'suffix': 'x',
                 'good_fn': lambda v: v >= 2.0, 'warn_fn': lambda v: v >= 1.5},
                {'key': 'Debt Service Coverage Ratio (DSCR)', 'name': 'DSCR', 'ideal': '> 1.2x', 'suffix': 'x',
                 'good_fn': lambda v: v >= 1.2, 'warn_fn': lambda v: v >= 1.0},
            ]
        },
        {
            'name': 'C. Profitability Ratios',
            'ratios': [
                {'key': 'Gross Profit Margin (%)', 'name': 'Gross Profit Margin', 'ideal': 'Trend ↑', 'suffix': '%',
                 'good_fn': lambda v: v > 0, 'warn_fn': lambda v: v >= -5},
                {'key': 'Operating Profit Margin (%)', 'name': 'Operating Profit Margin', 'ideal': 'Trend ↑', 'suffix': '%',
                 'good_fn': lambda v: v > 0, 'warn_fn': lambda v: v >= -5},
                {'key': 'Net Profit Margin (%)', 'name': 'Net Profit Margin', 'ideal': 'Trend ↑', 'suffix': '%',
                 'good_fn': lambda v: v > 0, 'warn_fn': lambda v: v >= -5},
                {'key': 'Return on Capital Employed (ROCE)', 'name': 'ROCE', 'ideal': '> Cost of Debt', 'suffix': '%',
                 'good_fn': lambda v: v > 10, 'warn_fn': lambda v: v >= 5},
                {'key': 'Return on Equity (ROE)', 'name': 'ROE', 'ideal': '> 15%', 'suffix': '%',
                 'good_fn': lambda v: v >= 15, 'warn_fn': lambda v: v >= 10},
            ]
        },
        {
            'name': 'D. Turnover / Efficiency Ratios',
            'ratios': [
                {'key': 'Inventory Turnover', 'name': 'Inventory Turnover', 'ideal': 'Higher ↑', 'suffix': ' times',
                 'good_fn': lambda v: v >= 4, 'warn_fn': lambda v: v >= 2},
                {'key': 'Inventory Days', 'name': 'Inventory Days', 'ideal': 'Lower ↓', 'suffix': ' days',
                 'good_fn': lambda v: v <= 90, 'warn_fn': lambda v: v <= 120},
                {'key': 'Debtors Turnover', 'name': 'Debtors Turnover', 'ideal': 'Higher ↑', 'suffix': ' times',
                 'good_fn': lambda v: v >= 6, 'warn_fn': lambda v: v >= 4},
                {'key': 'Collection Period (Days)', 'name': 'Collection Period', 'ideal': '< 60 days', 'suffix': ' days',
                 'good_fn': lambda v: v <= 60, 'warn_fn': lambda v: v <= 90},
                {'key': 'Cash Conversion Cycle', 'name': 'Cash Conversion Cycle', 'ideal': 'Lower ↓', 'suffix': ' days',
                 'good_fn': lambda v: v <= 60, 'warn_fn': lambda v: v <= 90},
            ]
        },
    ]
    
    categories = []
    for cat_def in ratio_definitions:
        category = {'name': cat_def['name'], 'ratios': []}
        for ratio_def in cat_def['ratios']:
            ratio = {
                'name': ratio_def['name'],
                'ideal': ratio_def['ideal'],
                'values': []
            }
            for year in year_settings:
                value = calculations.get(year['id'], {}).get(ratio_def['key'], 0)
                if ratio_def.get('is_currency'):
                    display = format_indian_currency(value)
                else:
                    display = format_ratio(value, ratio_def['suffix'])
                status = get_ratio_status(value, ratio_def['good_fn'], ratio_def['warn_fn'])
                ratio['values'].append({'display': display, 'status': status})
            category['ratios'].append(ratio)
        categories.append(category)
    
    return categories


def generate_cma_report_pdf(report, year_settings, operating_groups=None, asset_groups=None, 
                             liability_groups=None, calculations=None, loan_schedules=None):
    """
    Generate CMA Report PDF using HTML template
    
    Args:
        report: FinancialReport model instance
        year_settings: List of year setting dicts [{'id': x, 'year_display': 'YYYY-YY'}]
        operating_groups: QuerySet of operating financial groups
        asset_groups: QuerySet of asset financial groups
        liability_groups: QuerySet of liability financial groups
        calculations: Dictionary of calculated values {year_id: {key: value}} - for ratios
        loan_schedules: List of loan schedule data
    
    Returns:
        BytesIO buffer containing PDF
    """
    
    # Prepare data for template using actual groups
    operating_rows = prepare_operating_rows(operating_groups, year_settings) if operating_groups else []
    asset_rows = prepare_asset_rows(asset_groups, year_settings) if asset_groups else []
    liability_rows = prepare_liability_rows(liability_groups, year_settings) if liability_groups else []
    cashflow_rows, cf_years = prepare_cashflow_rows(calculations or {}, year_settings)
    ratio_categories = prepare_ratio_categories(calculations or {}, year_settings)
    
    # Prepare loan schedule data
    formatted_loans = []
    if loan_schedules:
        for loan in loan_schedules:
            formatted_loan = {
                'name': loan.get('name', 'Loan'),
                'summaries': []
            }
            for summary in loan.get('summaries', []):
                formatted_loan['summaries'].append({
                    'year_label': summary.get('year_label', ''),
                    'opening': format_indian_currency(summary.get('opening_balance', 0)),
                    'interest': format_indian_currency(summary.get('annual_interest', 0)),
                    'principal': format_indian_currency(summary.get('annual_principal', 0)),
                    'closing': format_indian_currency(summary.get('closing_balance', 0)),
                })
            formatted_loans.append(formatted_loan)
    
    # Render HTML template
    context = {
        'report': report,
        'year_settings': year_settings,
        'operating_rows': operating_rows,
        'asset_rows': asset_rows,
        'liability_rows': liability_rows,
        'cashflow_rows': cashflow_rows,
        'cf_years': cf_years,
        'loan_schedules': formatted_loans,
        'ratio_categories': ratio_categories,
    }
    
    html_content = render_to_string('pdf/cma_report.html', context)
    
    # Convert HTML to PDF
    buffer = BytesIO()
    
    if PDF_ENGINE == 'weasyprint':
        HTML(string=html_content).write_pdf(buffer)
    elif PDF_ENGINE == 'pdfkit':
        # pdfkit uses wkhtmltopdf
        import pdfkit
        options = {
            'page-size': 'A4',
            'orientation': 'Landscape',
            'margin-top': '10mm',
            'margin-right': '10mm',
            'margin-bottom': '10mm',
            'margin-left': '10mm',
            'encoding': 'UTF-8',
            'no-outline': None,
            'enable-local-file-access': None,
        }
        pdf_bytes = pdfkit.from_string(html_content, False, options=options)
        buffer.write(pdf_bytes)
    elif PDF_ENGINE == 'xhtml2pdf':
        pisa.CreatePDF(html_content, dest=buffer)
    else:
        raise ImportError("No PDF engine available. Please install weasyprint, pdfkit (with wkhtmltopdf), or xhtml2pdf.")
    
    buffer.seek(0)
    return buffer

