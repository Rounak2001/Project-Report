
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
        import datetime
        
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
        # Logic: 
        # 1. Determine which Financial Year the loan starts in.
        # 2. Determine the month offset within that FY.
        
        loan_start_date = report.new_loan_start_date
        
        # Find the start year setting
        start_year_setting = loan_schedule.start_year
        fy_start_year = start_year_setting.year # e.g. 2024 for FY 24-25
        
        # Calculate offset in months from April 1st of the FY Start Year
        # FY starts April 1st.
        fy_start_date = datetime.date(fy_start_year, 4, 1)
        
        # Calculate difference in months
        # (Year Diff * 12) + (Month Diff)
        # Note: loan_start_date should ideally be >= fy_start_date
        
        months_diff = (loan_start_date.year - fy_start_date.year) * 12 + (loan_start_date.month - fy_start_date.month)
        
        # Ensure non-negative offset (if loan date is before FY start, treat as 0 or handle error? Assuming valid input)
        start_offset = max(0, months_diff)
        
        start_year_index = list(year_settings).index(start_year_setting)
        schedule_index = 0 # Index in monthly_schedule
        
        summaries_to_create = []
        
        for idx, year_setting in enumerate(year_settings):
            if idx < start_year_index:
                # Loan hasn't started yet
                continue
            
            if schedule_index >= len(monthly_schedule):
                # Loan is fully repaid
                # Create zero entries for remaining years? Or just stop?
                # Usually better to have entries with 0 balance
                summaries_to_create.append(LoanYearSummary(
                    loan_schedule=loan_schedule,
                    year_setting=year_setting,
                    opening_balance=Decimal('0.00'),
                    annual_interest=Decimal('0.00'),
                    annual_principal=Decimal('0.00'),
                    closing_balance=Decimal('0.00'),
                    calculated_emi=Decimal('0.00')
                ))
                continue
            
            # Determine how many months of the loan fall into this FY
            if idx == start_year_index:
                # First year: Available months = 12 - start_offset
                months_in_fy = max(0, 12 - start_offset)
            else:
                # Subsequent years: Full 12 months
                months_in_fy = 12
            
            # But we can't take more than what's left in the schedule
            months_to_take = min(months_in_fy, len(monthly_schedule) - schedule_index)
            
            if months_to_take > 0:
                year_slice = monthly_schedule[schedule_index : schedule_index + months_to_take]
                
                year_opening = year_slice[0]['opening']
                year_interest = sum(m['interest'] for m in year_slice)
                year_principal = sum(m['principal'] for m in year_slice)
                year_closing = year_slice[-1]['closing']
                avg_emi = sum(m['payment'] for m in year_slice) / months_to_take
                
                summaries_to_create.append(LoanYearSummary(
                    loan_schedule=loan_schedule,
                    year_setting=year_setting,
                    opening_balance=Decimal(str(round(year_opening, 2))),
                    annual_interest=Decimal(str(round(year_interest, 2))),
                    annual_principal=Decimal(str(round(year_principal, 2))),
                    closing_balance=Decimal(str(round(year_closing, 2))),
                    calculated_emi=Decimal(str(round(avg_emi, 2)))
                ))
                
                schedule_index += months_to_take
            else:
                # No months for this year (e.g. loan starts late in the year and finished?)
                 summaries_to_create.append(LoanYearSummary(
                    loan_schedule=loan_schedule,
                    year_setting=year_setting,
                    opening_balance=Decimal('0.00'),
                    annual_interest=Decimal('0.00'),
                    annual_principal=Decimal('0.00'),
                    closing_balance=Decimal('0.00'),
                    calculated_emi=Decimal('0.00')
                ))
        
        # Bulk create all summaries
        LoanYearSummary.objects.bulk_create(summaries_to_create)
