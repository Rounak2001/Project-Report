import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import "jspdf-autotable";

export const AmortizationSchedule = ({ principal, interestRate, tenure, emi, interestType = "reducing", desiredEMI, showPrepayment = false }) => {
  const calculateAmortization = () => {
    const monthlyRate = interestRate / 12 / 100;
    let balance = principal;
    const monthlySchedule = [];
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Start from next month
    const currentDate = new Date();
    let month = 1;
    
    const maxMonths = Math.ceil(tenure * 12);
    while (balance > 1 && month <= maxMonths) {
      let interestPayment, principalPayment;
      
      if (interestType === "fixed") {
        const totalInterest = (principal * interestRate * tenure) / 100;
        const totalMonths = tenure * 12;
        interestPayment = totalInterest / totalMonths;
        principalPayment = principal / totalMonths;
      } else {
        interestPayment = balance * monthlyRate;
        principalPayment = emi - interestPayment;
      }
      
      // Final payment: pay remaining balance
      if (principalPayment >= balance) {
        principalPayment = balance;
      }
      
      balance = balance - principalPayment;
      
      // Extra EMI at end of each year for prepayment schedule
      if (showPrepayment && interestType === "reducing" && month % 12 === 0 && balance > emi) {
        balance -= emi;
      }
      
      // Calculate actual date for this payment (start from next month)
      const paymentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + month, 1);
      
      monthlySchedule.push({
        monthNumber: month,
        monthName: monthNames[paymentDate.getMonth()],
        year: paymentDate.getFullYear(),
        actualYear: Math.ceil(month / 12),
        principal: principalPayment,
        interest: interestPayment,
        totalPayment: principalPayment + interestPayment,
        balance: balance
      });
      
      month++;
      if (balance <= 0) break;
    }
    
    // Group by calendar years
    const yearlySchedule = [];
    const yearsWithPayments = [...new Set(monthlySchedule.map(m => m.year))];
    
    for (const year of yearsWithPayments) {
      const yearMonths = monthlySchedule.filter(m => m.year === year);
      
      const yearlyPrincipal = yearMonths.reduce((sum, m) => sum + m.principal, 0);
      const yearlyInterest = yearMonths.reduce((sum, m) => sum + m.interest, 0);
      const yearEndBalance = yearMonths[yearMonths.length - 1].balance;
      
      yearlySchedule.push({
        year,
        principal: Math.round(yearlyPrincipal),
        interest: Math.round(yearlyInterest),
        totalPayment: Math.round(yearlyPrincipal + yearlyInterest),
        balance: Math.round(yearEndBalance),
        monthlyDetails: yearMonths.map(m => ({
          month: m.monthName,
          principal: Math.round(m.principal),
          interest: Math.round(m.interest),
          totalPayment: Math.round(m.totalPayment),
          balance: Math.round(m.balance),
          emi: Math.round(m.totalPayment)
        }))
      });
    }
    
    return yearlySchedule;
  };

  const downloadSchedule = () => {
    try {
      const schedule = calculateAmortization();
      const doc = new jsPDF();
      
      // Header with watermark
      doc.setFontSize(16);
      doc.text('Loan Buddy - EMI Calculator', 20, 20);
      doc.setFontSize(10);
      doc.text('Website: https://your-website.com', 20, 30);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 35);
      
      // Loan summary
      doc.setFontSize(12);
      doc.text('Loan Summary', 20, 50);
      doc.setFontSize(10);
      doc.text(`Principal: Rs ${principal.toLocaleString()}`, 20, 60);
      doc.text(`Interest Rate: ${interestRate}% p.a.`, 20, 65);
      doc.text(`Tenure: ${tenure} years`, 20, 70);
      doc.text(`Monthly EMI: Rs ${Math.round(emi).toLocaleString()}`, 20, 75);
      
      // Prepare table data
      const tableData = [];
      schedule.forEach(year => {
        year.monthlyDetails.forEach(month => {
          tableData.push([
            `${month.month} ${year.year}`,
            `Rs ${month.principal.toLocaleString()}`,
            `Rs ${month.interest.toLocaleString()}`,
            `Rs ${month.totalPayment.toLocaleString()}`,
            `Rs ${month.balance.toLocaleString()}`
          ]);
        });
      });
      
      // Add table
      doc.autoTable({
        head: [['Month', 'Principal Paid', 'Interest Charged', 'Total Payment', 'Balance']],
        body: tableData,
        startY: 85,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 128, 185] }
      });
      
      // Footer disclaimer
      const finalY = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(8);
      doc.text('Disclaimer: This is an estimated calculation. Actual loan terms may vary.', 20, finalY);
      doc.text('For accurate information, please consult with your financial institution.', 20, finalY + 5);
      
      doc.save('loan-amortization-schedule.pdf');
      toast.success("PDF downloaded successfully!");
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  const schedule = calculateAmortization();

  return (
    <Card className="shadow-[var(--shadow-medium)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Amortization Schedule ({schedule.length > 0 ? schedule[schedule.length-1].year : 0} years)
            {showPrepayment && <span className="text-sm font-normal text-muted-foreground">(With Prepayment)</span>}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={downloadSchedule} className="gap-2">
            <Download className="w-4 h-4" />
            Download
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <Accordion type="multiple" className="w-full">
            {schedule.map((yearData) => (
              <AccordionItem key={yearData.year} value={`year-${yearData.year}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span className="font-semibold text-sm">{yearData.year} ({yearData.monthlyDetails.length} months)</span>
                    <div className="flex gap-8 text-xs text-muted-foreground">
                      <div className="text-right min-w-[120px]">
                        <span className="block">Principal</span>
                        <span className="font-medium">₹{yearData.principal.toLocaleString()}</span>
                      </div>
                      <div className="text-right min-w-[120px]">
                        <span className="block">Interest</span>
                        <span className="font-medium">₹{yearData.interest.toLocaleString()}</span>
                      </div>
                      <div className="text-right min-w-[120px]">
                        <span className="block">Balance</span>
                        <span className="font-medium">₹{yearData.balance.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-center">Month</TableHead>
                          <TableHead className="text-right">Principal Paid</TableHead>
                          <TableHead className="text-right">Interest Charged</TableHead>
                          <TableHead className="text-right">Total Payment</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {yearData.monthlyDetails.map((month, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-center font-medium">{month.month}</TableCell>
                            <TableCell className="text-right">₹{month.principal.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-accent">₹{month.interest.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">₹{month.totalPayment.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">₹{month.balance.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};