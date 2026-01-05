import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TrendingDown } from "lucide-react";

export const ExistingLoanCalculator = () => {
  const [currentBalance, setCurrentBalance] = useState();
  const [currentEMI, setCurrentEMI] = useState();
  const [interestRate, setInterestRate] = useState();
  const [remainingMonths, setRemainingMonths] = useState();
  const [prepaymentAmount, setPrepaymentAmount] = useState();
  const [prepaymentOption, setPrepaymentOption] = useState("tenure"); // "tenure" or "emi"

  const formatIndian = (num) => {
    if (!num && num !== 0) return '0';
    const n = Math.round(num).toString();
    const lastThree = n.substring(n.length - 3);
    const otherNumbers = n.substring(0, n.length - 3);
    return otherNumbers !== '' ? otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree : lastThree;
  };

  const calculateNewLoan = () => {
    const r = interestRate / 12 / 100;
    const newPrincipal = currentBalance - prepaymentAmount;
    
    if (newPrincipal <= 0) {
      return { newEMI: 0, newBalance: newPrincipal, newMonths: 0, timeSaved: remainingMonths, interestSaved: currentEMI * remainingMonths };
    }
    
    if (prepaymentOption === "tenure") {
      const newTenure = Math.log(currentEMI / (currentEMI - newPrincipal * r)) / Math.log(1 + r);
      const oldInterest = (currentEMI * remainingMonths) - currentBalance;
      const newInterest = (currentEMI * newTenure) - newPrincipal;
      const interestSaved = oldInterest - newInterest;
      return {
        newEMI: currentEMI,
        newBalance: newPrincipal,
        newMonths: Math.round(newTenure),
        timeSaved: remainingMonths - Math.round(newTenure),
        interestSaved
      };
    } else {
      const newEMI = (newPrincipal * r * Math.pow(1 + r, remainingMonths)) / (Math.pow(1 + r, remainingMonths) - 1);
      const oldInterest = (currentEMI * remainingMonths) - currentBalance;
      const newInterest = (newEMI * remainingMonths) - newPrincipal;
      const interestSaved = oldInterest - newInterest;
      return {
        newEMI,
        newBalance: newPrincipal,
        newMonths: remainingMonths,
        timeSaved: 0,
        interestSaved
      };
    }
  };

  const result = calculateNewLoan();

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <TrendingDown className="w-10 h-10 text-primary" />
            <h1 className="text-4xl font-bold text-foreground">Pre-Payment Loan Calculator</h1>
          </div>
          <p className="text-muted-foreground text-lg">See how paying extra reduces your loan burden</p>
        </div>
        
        <Card className="shadow-[var(--shadow-medium)] mb-6">
          <CardHeader>
            <CardTitle>Current Loan Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <Label>Outstanding Balance (₹)</Label>
              <Input type="number" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <Label>Current EMI (₹)</Label>
              <Input type="number" value={currentEMI} onChange={(e) => setCurrentEMI(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <Label>Interest Rate (% p.a.)</Label>
              <Input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value === '' ? '' : Number(e.target.value))} step="0.1" />
            </div>
            <div>
              <Label>Remaining Months</Label>
              <Input type="number" value={remainingMonths} onChange={(e) => setRemainingMonths(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <Label>Prepayment Amount (₹)</Label>
              <Input type="number" value={prepaymentAmount} onChange={(e) => setPrepaymentAmount(e.target.value === '' ? '' : Number(e.target.value))} className="[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
            </div>
            <div className="col-span-2">
              <Label>Prepayment Option</Label>
              <RadioGroup value={prepaymentOption} onValueChange={setPrepaymentOption} className="flex gap-4 mt-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tenure" id="tenure" />
                  <Label htmlFor="tenure" className="cursor-pointer font-normal">Reduce Tenure (Keep EMI Same)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="emi" id="emi" />
                  <Label htmlFor="emi" className="cursor-pointer font-normal">Reduce EMI (Keep Tenure Same)</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-medium)] bg-green-50/50 border-green-500/20">
          <CardHeader>
            <CardTitle className="text-green-700">Impact of Prepayment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-100/50 p-3 rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">New Outstanding Balance</p>
              <p className="text-2xl font-bold text-blue-700">₹{formatIndian(result.newBalance)}</p>
              <p className="text-xs text-muted-foreground mt-1">(After ₹{formatIndian(prepaymentAmount)} prepayment)</p>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">New EMI</p>
                <p className="text-xl font-bold text-primary">₹{formatIndian(result.newEMI)}</p>
              </div>
              <div className="bg-white p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">New Tenure</p>
                <p className="text-xl font-bold text-green-700">{result.newMonths} months</p>
              </div>
              <div className="bg-white p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Time Saved</p>
                <p className="text-xl font-bold text-green-700">{result.timeSaved} months</p>
              </div>
              <div className="bg-white p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Interest Saved</p>
                <p className="text-xl font-bold text-green-700">₹{formatIndian(result.interestSaved)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
