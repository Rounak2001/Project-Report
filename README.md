# Fineline CMA Report & Financial Project Report Maker

A Senior Engineer's Overview, Architecture Guide, and Local Setup Instructions for Junior Developers.

---

## 📌 What is this Project For?
In commercial lending (especially in India), banks require a **Credit Monitoring Arrangement (CMA) Report** before sanctioning or renewing credit facilities (such as term loans or working capital limits).
A CMA report contains details of:
1. Past, present, and future projected financial statements (Balance Sheet, Profit & Loss/Operating Statement, Cash Flow Statement).
2. Key financial indicators and ratios (liquidity, leverage, profitability, turnover, DSCR, ISCR).
3. Detailed fund flow statements and working capital assessment.

**Fineline CMA Report Maker** (also called **Loan Buddy Flex**) is an automated web application that lets financial consultants or business owners input raw financial data and generate audit/bank-ready CMA projection reports in minutes, instead of hours in Excel.

---

## ⚙️ What the Application Does (Core Features)

1. **Company & Project Profiling**: Set up sectors (Service, Manufacturing/Industry, Wholesale, Retail) and Tax Regimes (Domestic Company 22%, LLP 30%, Proprietorship with slab-wise tax calculations).
2. **Dynamic Multi-Year Grid**: An interactive, spreadsheet-like financial grid allowing users to insert, hide, or delete rows, manage custom items, and enter values for actual, provisional, or projected years.
3. **Smart Projection Engine ("GO" Projection)**: Automatically applies compounded annual growth rates (CAGR %) from a selected base year to project future years in bulk.
4. **Automated Amortization & Loan Schedule**:
   - Supports EMI (Reducing Balance), Bullet, or Custom repayment schedules.
   - Handles moratorium periods (interest-only periods).
   - Generates detailed month-by-month schedules, aggregates them to fiscal years, and integrates opening/closing balances, principal paid, and interest directly into P&L, Balance Sheet, and Cash Flow tables.
5. **Intelligent Ratio Diagnostics**: Computes and formats ratios under Indian conventions (Lakhs/Crores, e.g., ₹ X,XX,XXX) and flags health indicators (green/amber/red status) based on standard banking guidelines (e.g. Current Ratio > 1.33).
6. **Professional PDF Exporter**: Renders the complete, landscape-oriented multi-page report matching standard CMA banking formats directly to PDF.

---

## 🛠️ The Technology Stack

### Backend (Python/Django)
- **Framework**: Django 5.2.x + Django REST Framework (DRF) 3.16.x
- **Database**: PostgreSQL (Production, managed on Neon.tech via `dj-database-url`) and SQLite (Local Development)
- **PDF Compilation**: WeasyPrint / PDFKit / xhtml2pdf (Dynamic engine detection)

### Frontend (React/Vite)
- **Build Tool**: Vite (configured on Port `8080`)
- **UI & Styling**: Tailwind CSS, Radix UI primitives, Lucide Icons, Shadcn components
- **State & Data Fetching**: TanStack React Query v5, Context API
- **Form Handling**: React Hook Form + Zod validation

---

## 📁 Repository Structure Overview

```text
Fineline/
├── Backend/
│   └── project_report/
│       ├── core/                      # Main Django App
│       │   ├── models.py              # FinancialReport, TermLoan, FinancialRow/Data, drawings, etc.
│       │   ├── views.py               # Main APIs & batch cell saving, projection trigger
│       │   ├── views_loan_schedule.py # Amortization & yearly summaries aggregator
│       │   ├── serializers.py         # DRF serializing logic (nested row/data response)
│       │   ├── pdf_service.py         # Currency formatter (Lakhs/Crores) & PDF compilers
│       │   ├── urls.py                # REST Endpoints
│       │   └── migrations/            # DB Schema version controls
│       ├── project_report/            # Django Settings & routing
│       ├── db.sqlite3                 # Local SQLite database (development default)
│       ├── .env                       # Environment credentials
│       ├── manage.py                  # Django CLI
│       └── requirements.txt           # Backend dependencies
├── Frontend/
│   └── loan-buddy-flex/
│       ├── src/
│       │   ├── services/
│       │   │   ├── apiClient.js       # Central fetch wrapper, CSRF inclusion & error handler
│       │   │   ├── financialCalculations.js # Heavy client-side P&L & Balance Sheet equations
│       │   │   └── loanCalculations.js      # EMI, Bullet & repayment logic
│       │   ├── pages/
│       │   │   └── project-report/
│       │   │       ├── ProjectReportApp.jsx # Tab Router & Master Data Sync context
│       │   │       ├── FinancialGridPage.jsx  # Complex spreadsheet grid render
│       │   │       ├── ProjectSetupPage.jsx   # Loan contribution and metadata configs
│       │   │       ├── ExistingLoansPage.jsx  # Debt schedules inputs
│       │   │       └── PreviewPage.jsx        # Print-preview template
│       │   └── components/
│       ├── package.json               # Node modules script
│       ├── bun.lockb                  # Bun dependency lock
│       ├── package-lock.json          # npm dependency lock
│       └── vite.config.js             # Vite Dev Server Config (port 8080)
```

---

## 🚀 Setup Guide for Local Development

Follow these steps to run both backend and frontend environments on your local machine.

### Prerequisites
- Python 3.10+
- Node.js 18+ or Bun
- (Optional) `wkhtmltopdf` or system libraries for `weasyprint` (needed for PDF generation).
  - *Ubuntu/Debian:* `sudo apt-get install python3-pip python3-cairo libpango-1.0-0 libpangocairo-1.0-0`

---

### 1. Backend Setup

1. **Navigate to the Backend directory:**
   ```bash
   cd Backend/project_report
   ```

2. **Create a virtual environment:**
   ```bash
   python3 -m venv venv
   ```

3. **Activate the virtual environment:**
   - **Linux/macOS:**
     ```bash
     source venv/bin/activate
     ```
   - **Windows (Git Bash):**
     ```bash
     source venv/Scripts/activate
     ```

4. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

5. **Configure Environment Variables (`.env`):**
   By default, if the `.env` file is missing or `DATABASE_URL` is empty, Django falls back to the local `db.sqlite3` database file.
   - For local development, it is highly recommended to **use SQLite** to avoid overwriting production Neon databases. To do so, you can rename `.env` to `.env.example` or comment out the `DATABASE_URL` inside the `.env` file.
   - If you need to connect to your PostgreSQL instance, create/edit the `.env` file inside `Backend/project_report/` and set:
     ```env
     DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db_name>
     ```

6. **Apply Database Migrations:**
   ```bash
   python manage.py migrate
   ```

7. **Create a Superuser (optional, for accessing `/admin`):**
   ```bash
   python manage.py createsuperuser
   ```
   Follow the prompts to enter your username, email, and password.

8. **Start the Development Server:**
   ```bash
   python manage.py runserver
   ```
   The backend API will run on `http://127.0.0.1:8000/`.

---

### 2. Frontend Setup

1. **Navigate to the Frontend directory:**
   ```bash
   cd ../../Frontend/loan-buddy-flex
   ```

2. **Install Dependencies:**
   You can use either `npm` or `bun` (recommended since `bun.lockb` is present).
   - **Using Bun:**
     ```bash
     bun install
     ```
   - **Using NPM:**
     ```bash
     npm install
     ```

3. **Start the Development Server:**
   - **Using Bun:**
     ```bash
     bun run dev
     ```
   - **Using NPM:**
     ```bash
     npm run dev
     ```
   The frontend development server will boot up and be accessible on `http://localhost:8080/`.

---

## 🔍 Verifying the System
1. Open `http://localhost:8080/` in your browser.
2. Select or create a report.
3. Configure the company name, select a sector (e.g., **Service**), choose a tax regime, and hit save.
4. Set up assets and loan details, then navigate to the **Operating Statement** or **Balance Sheet** grids.
5. Try editing cell values. Check your browser's Network tab—you should see requests to `http://localhost:8000/api/data/save_cell/` or `save_multiple_cells/` firing automatically.

---

## 💡 Senior Engineering Architecture Tips (For Juniors)

- **Grid Data Binding & Optimization**:
  - Cell updates are saved via auto-saving API calls in the React frontend.
  - The backend (`views.py`) uses a highly optimized `FinancialCalculationMixin` that batch-fetches data and runs in-memory calculations before performing `bulk_update` or `bulk_create` on `FinancialData` records. This avoids standard Django N+1 database queries.
- **Stock Flow Hook**:
  - Opening stock for year $N$ is always linked to the closing stock of year $N-1$. Editing a closing stock cell automatically triggers a waterfall recalculation in subsequent years on the backend.
- **PDF Engine Fallbacks**:
  - `pdf_service.py` is written to dynamically detect the installed PDF libraries (`weasyprint`, `pdfkit`, `xhtml2pdf`). If the PDF fails to download locally, check your system logs to see which system dependency is missing.
