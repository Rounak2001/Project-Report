import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calculator, PieChart, TrendingUp } from "lucide-react";
import { EMIPieChart } from "./EMIPieChart.jsx";
import { AmortizationSchedule } from "./AmortizationSchedule.jsx";
import { toast } from "sonner";

const loanTypes = [
  { value: "home", label: "Home Loan", defaultRate: 9.0 },
  { value: "car", label: "Car Loan", defaultRate: 12.0 },
  { value: "gold", label: "Gold Loan", defaultRate: 7.5 },
  { value: "personal", label: "Personal Loan", defaultRate: 14.0 },
  { value: "education", label: "Education Loan", defaultRate: 10.0 },
  { value: "business", label: "Business Loan", defaultRate: 11.5 },
  { value: "agriculture", label: "Agriculture Loan", defaultRate: 7 },
  { value: "credit card", label: "Credit Card Loan", defaultRate: 12 },
  // { value: "cash credit ", label: "Cash Credit", defaultRate: 12 },
];

export const EMICalculator = () => {
  const [loanType, setLoanType] = useState("home");
  const [principal, setPrincipal] = useState(1000000);
  const [interestRate, setInterestRate] = useState(9.0);
  const [tenure, setTenure] = useState(10);
  const [desiredEMI, setDesiredEMI] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [interestType, setInterestType] = useState("reducing"); // "fixed" or "reducing"
  const [showPrepaymentSchedule, setShowPrepaymentSchedule] = useState(false);
  const [sipReturn, setSipReturn] = useState(12);
  const [sipStartAfter, setSipStartAfter] = useState(2);

  const calculateEMI = (p, r, t) => {
    if (interestType === "fixed") {
      // Fixed interest: Flat rate - same interest amount every month
      const totalInterest = (p * r * t) / 100;
      const totalAmount = p + totalInterest;
      return totalAmount / (t * 12);
    } else {
      // Reducing balance: Compound interest calculation
      const monthlyRate = r / 12 / 100;
      const months = t * 12;
      const emi = (p * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
      return emi;
    }
  };

  const calculateTotalAmount = (emi, t) => {
    return Math.round(emi * t * 12);
  };

  const calculateTotalInterest = (totalAmount, p) => {
    return Math.round(totalAmount - p);
  };

  const calculateSuggestions = () => {
    if (!desiredEMI || desiredEMI <= 0) return null;
    
    const targetEMI = Number(desiredEMI);
    let tenureYears = null;
    let suggestedPrincipal = null;
    let suggestedRate = null;
    
    if (interestType === "fixed") {
      // Fixed interest calculations
      // Calculate tenure: targetEMI = (P + (P * R * T) / 100) / (T * 12)
      // Solving for T: T = P / (targetEMI * 12 - P * R / 100)
      const denominator = targetEMI * 12 - (principal * interestRate) / 100;
      if (denominator > 0) {
        tenureYears = principal / denominator;
      }
      
      // Calculate principal: P = (targetEMI * T * 12) / (1 + R * T / 100)
      const months = tenure * 12;
      suggestedPrincipal = (targetEMI * months) / (1 + (interestRate * tenure) / 100);
      
      // Calculate rate: R = ((targetEMI * T * 12 - P) * 100) / (P * T)
      suggestedRate = ((targetEMI * tenure * 12 - principal) * 100) / (principal * tenure);
    } else {
      // Reducing balance calculations
      const monthlyRate = interestRate / 12 / 100;
      
      // Calculate tenure for desired EMI
      const tenureMonths = Math.log(targetEMI / (targetEMI - principal * monthlyRate)) / Math.log(1 + monthlyRate);
      tenureYears = tenureMonths / 12;
      
      // Calculate principal for desired EMI
      const months = tenure * 12;
      suggestedPrincipal = (targetEMI * (Math.pow(1 + monthlyRate, months) - 1)) / (monthlyRate * Math.pow(1 + monthlyRate, months));
      
      // Calculate interest rate for desired EMI
      let low = 0.1, high = 30;
      let iterations = 0;
      
      while (iterations < 50) {
        const guess = (low + high) / 2;
        const guessMonthlyRate = guess / 12 / 100;
        const testEMI = (principal * guessMonthlyRate * Math.pow(1 + guessMonthlyRate, months)) / (Math.pow(1 + guessMonthlyRate, months) - 1);
        
        if (Math.abs(testEMI - targetEMI) < 1) {
          suggestedRate = guess;
          break;
        }
        
        if (testEMI > targetEMI) {
          high = guess;
        } else {
          low = guess;
        }
        iterations++;
      }
    }
    
    return {
      tenure: tenureYears > 0 && tenureYears < 50 ? tenureYears : null,
      principal: suggestedPrincipal > 0 && suggestedPrincipal < 100000000 ? suggestedPrincipal : null,
      rate: suggestedRate > 0 && suggestedRate < 30 ? suggestedRate : null,
    };
  };

  const applySuggestion = (type) => {
    const suggestions = calculateSuggestions();
    if (!suggestions) return;
    
    if (type === "tenure" && suggestions.tenure) {
      setTenure(Math.round(suggestions.tenure * 10) / 10);
      toast.success("Tenure adjusted to match your desired EMI!");
    } else if (type === "principal" && suggestions.principal) {
      setPrincipal(Math.round(suggestions.principal));
      toast.success("Loan amount adjusted to match your desired EMI!");
    } else if (type === "rate" && suggestions.rate) {
      setInterestRate(Math.round(suggestions.rate * 10) / 10);
      toast.success("Interest rate adjusted to match your desired EMI!");
    }
    setShowSuggestions(false);
  };

  // Calculate actual tenure when using desired EMI
  const calculatedEMI = calculateEMI(principal, interestRate, tenure);
  const actualEMI = (desiredEMI && Math.abs(Number(desiredEMI) - calculatedEMI) < 100) ? Number(desiredEMI) : calculatedEMI;
  const emi = actualEMI;
  
  // Calculate actual tenure for desired EMI
  let actualTenure = tenure;
  if (desiredEMI && Math.abs(Number(desiredEMI) - calculatedEMI) < 100) {
    const suggestions = calculateSuggestions();
    if (suggestions && suggestions.tenure) {
      actualTenure = suggestions.tenure;
    }
  }
  
  const totalAmount = calculateTotalAmount(emi, actualTenure);
  const totalInterest = calculateTotalInterest(totalAmount, principal);

  // Calculate prepayment benefits (yearly extra EMI)
  const calculatePrepaymentBenefits = () => {
    if (interestType === "reducing") {
      const monthlyRate = interestRate / 12 / 100;
      let balance = principal;
      let months = 0;
      let totalInterestNormal = 0;
      
      // Calculate normal loan completion
      while (balance > 1 && months < tenure * 12) {
        const interestPayment = balance * monthlyRate;
        const principalPayment = emi - interestPayment;
        balance -= principalPayment;
        totalInterestNormal += interestPayment;
        months++;
      }
      
      // Calculate with yearly extra EMI prepayment
      let prepaidBalance = principal;
      let prepaidMonths = 0;
      let totalInterestPrepaid = 0;
      
      while (prepaidBalance > 1 && prepaidMonths < tenure * 12) {
        // Regular monthly EMI
        const interestPayment = prepaidBalance * monthlyRate;
        const principalPayment = emi - interestPayment;
        prepaidBalance -= principalPayment;
        totalInterestPrepaid += interestPayment;
        prepaidMonths++;
        
        // Extra EMI at end of each year (month 12, 24, 36, etc.) - directly reduces principal
        if (prepaidMonths % 12 === 0 && prepaidBalance > emi) {
          prepaidBalance -= emi;
        }
      }
      
      const monthsSaved = months - prepaidMonths;
      const interestSaved = totalInterestNormal - totalInterestPrepaid;
      
      return {
        monthsSaved: Math.max(0, monthsSaved),
        interestSaved: Math.max(0, interestSaved),
        yearsSaved: Math.max(0, monthsSaved / 12)
      };
    }
    return { monthsSaved: 0, interestSaved: 0, yearsSaved: 0 };
  };

  const prepaymentBenefits = calculatePrepaymentBenefits();

  // Calculate required SIP where SIP Returns = Total Interest
  const calculateRequiredSIP = () => {
    const monthlyRate = sipReturn / 12 / 100;
    const sipMonths = Math.max(0, (tenure - sipStartAfter) * 12);
    
    // SIP Corpus - SIP Invested = Returns, and Returns should = Total Interest
    // So: Corpus = Total Interest + Invested
    // We need to find SIP amount where (Corpus - Invested) = Total Interest
    
    // Total Invested = SIP × sipMonths
    // Corpus = SIP × [(1 + r)^n - 1] / r × (1 + r)
    // Returns = Corpus - Invested = Total Interest
    
    // Solving: SIP × {[(1 + r)^n - 1] / r × (1 + r) - n} = Total Interest
    const futureValueFactor = ((Math.pow(1 + monthlyRate, sipMonths) - 1) / monthlyRate) * (1 + monthlyRate);
    const returnsFactor = futureValueFactor - sipMonths; // This gives returns per rupee invested
    
    const requiredSIP = returnsFactor > 0 ? totalInterest / returnsFactor : 0;
    return Math.round(requiredSIP);
  };

  const requiredSIPAmount = calculateRequiredSIP();
  const [sipAmount, setSipAmount] = useState(requiredSIPAmount);

  // Auto-update SIP when loan parameters change
  useEffect(() => {
    setSipAmount(requiredSIPAmount);
  }, [requiredSIPAmount]);

  // Calculate SIP benefits with current amount
  const calculateSIPBenefits = () => {
    const monthlyRate = sipReturn / 12 / 100;
    const sipMonths = Math.max(0, (tenure - sipStartAfter) * 12);
    
    const sipCorpus = sipAmount * ((Math.pow(1 + monthlyRate, sipMonths) - 1) / monthlyRate) * (1 + monthlyRate);
    const totalInvested = sipAmount * sipMonths;
    const sipReturns = sipCorpus - totalInvested; // Actual profit from SIP
    const netBenefit = sipReturns - totalInterest; // SIP Returns - Loan Interest
    
    return {
      sipCorpus: Math.round(sipCorpus),
      totalInvested: Math.round(totalInvested),
      sipReturns: Math.round(sipReturns),
      interestDuringSIP: totalInterest,
      netBenefit: Math.round(netBenefit),
      requiredSIP: requiredSIPAmount,
      canCoverInterest: sipReturns >= totalInterest
    };
  };

  const sipBenefits = calculateSIPBenefits();

  const handleLoanTypeChange = (value) => {
    setLoanType(value);
    const selectedLoan = loanTypes.find(loan => loan.value === value);
    if (selectedLoan) {
      setInterestRate(selectedLoan.defaultRate);
    }
  };

  const suggestions = calculateSuggestions();

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Calculator className="w-10 h-10 text-primary" />
            <h1 className="text-4xl font-bold text-foreground">EMI Calculator</h1>
          </div>
          <p className="text-muted-foreground text-lg">Calculate your loan EMI or plan your budget with reverse calculation</p>
        </div>

        {/* Top Section: Loan Details (70%) + Pie Chart (30%) */}
        <div className="flex gap-6 mb-6">
          {/* Left Panel - Inputs (70%) */}
          <div className="flex-1 max-w-[70%]">
            <Card className="shadow-[var(--shadow-medium)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Loan Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Loan Type Selector */}
                <div className="space-y-2">
                  <Label>Loan Type</Label>
                  <Select value={loanType} onValueChange={handleLoanTypeChange}>
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {loanTypes.map(loan => (
                        <SelectItem key={loan.value} value={loan.value}>
                          {loan.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Principal Amount */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label>Loan Amount</Label>
                        <Input
                          type="number"
                          value={principal}
                          onChange={(e) => setPrincipal(Number(e.target.value))}
                          className="w-24 text-right"
                        />
                      </div>
                      <Slider
                        value={[principal]}
                        onValueChange={(value) => setPrincipal(value[0])}
                        min={100000}
                        max={10000000}
                        step={50000}
                        className="cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>₹1L</span>
                        <span>₹1Cr</span>
                      </div>
                    </div>

                    {/* Interest Rate */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label>Interest Rate (% p.a.)</Label>
                        <Input
                          type="number"
                          value={interestRate}
                          onChange={(e) => setInterestRate(Number(e.target.value))}
                          className="w-24 text-right"
                          step="0.1"
                        />
                      </div>
                      <Slider
                        value={[interestRate]}
                        onValueChange={(value) => setInterestRate(value[0])}
                        min={5}
                        max={20}
                        step={0.1}
                        className="cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>5%</span>
                        <span>20%</span>
                      </div>
                    </div>

                    {/* Tenure */}
                    <div className="space-y-3 ">
                      <div className="flex justify-between items-center ">
                        <Label>Loan Tenure (Years)</Label>
                        <Input
                          type="number"
                          value={tenure}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (value >= 1 && value <= 30) {
                              setTenure(Math.round(value));
                            }
                          }}
                          className="w-24 text-right"
                          step="1"
                          min="1"
                          max="30"
                        />
                      </div>
                      <Slider
                        value={[tenure]}
                        onValueChange={(value) => setTenure(value[0])}
                        min={1}
                        max={30}
                        step={1}
                        className="cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>1 Year</span>
                        <span>30 Years</span>
                      </div>
                    </div>

                    {/* Interest Type */}
                    <div className="space-y-3">
                      <Label>Interest Calculation Method</Label>
                      <RadioGroup value={interestType} onValueChange={setInterestType} className="flex gap-4">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="reducing" id="reducing" />
                          <Label htmlFor="reducing" className="cursor-pointer font-normal">Reducing Balance</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="fixed" id="fixed" />
                          <Label htmlFor="fixed" className="cursor-pointer font-normal">Fixed Rate</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {/* Desired EMI Field */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label>Desired EMI (Optional)</Label>
                        <Input
                          type="number"
                          placeholder={Math.round(emi).toLocaleString()}
                          value={desiredEMI}
                          onChange={(e) => {
                            setDesiredEMI(e.target.value);
                            setShowSuggestions(!!e.target.value);
                          }}
                          className="w-24 text-right"
                        />
                      </div>
                    </div>

                    {/* Suggestions when desired EMI is different */}
                    {showSuggestions && desiredEMI && Math.abs(Number(desiredEMI) - emi) > 100 && suggestions && (
                      <div className="p-4 bg-muted rounded-lg space-y-3">
                        <p className="text-sm font-medium">To achieve ₹{Number(desiredEMI).toLocaleString()} EMI:</p>
                        <div className="space-y-2">
                          {suggestions.tenure && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-between"
                              onClick={() => applySuggestion("tenure")}
                            >
                              <span>Adjust Tenure to {suggestions.tenure.toFixed(1)} years</span>
                              <span className="text-xs text-muted-foreground">Apply</span>
                            </Button>
                          )}
                          {suggestions.principal && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-between"
                              onClick={() => applySuggestion("principal")}
                            >
                              <span>Adjust Amount to ₹{(suggestions.principal / 100000).toFixed(1)}L</span>
                              <span className="text-xs text-muted-foreground">Apply</span>
                            </Button>
                          )}
                          {suggestions.rate && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-between"
                              onClick={() => applySuggestion("rate")}
                            >
                              <span>Adjust Rate to {suggestions.rate.toFixed(1)}%</span>
                              <span className="text-xs text-muted-foreground">Apply</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Pie Chart (30%) */}
          <div className="flex-shrink-0 w-80">
            <Card className="shadow-[var(--shadow-medium)] h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-primary" />
                  Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center">
                <EMIPieChart 
                  principal={principal} 
                  interest={totalInterest}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Middle Section: Loan Summary */}
        <Card className="shadow-[var(--shadow-medium)] mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              Loan Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4">
              {/* Monthly EMI */}
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Monthly EMI</p>
                  <p className="text-2xl font-bold text-primary">₹{Math.round(emi).toLocaleString()}</p>
                </div>
              </div>
              
              {/* Principal Amount */}
              <div className="bg-muted/50 border p-4 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Principal</p>
                  <p className="text-lg font-semibold">₹{principal.toLocaleString()}</p>
                </div>
              </div>
              
              {/* Total Interest */}
              <div className="bg-muted/50 border p-4 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Total Interest</p>
                  <p className="text-lg font-semibold">₹{totalInterest.toLocaleString()}</p>
                </div>
              </div>
              
              {/* Total Amount */}
              <div className="bg-muted/50 border p-4 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Total Amount</p>
                  <p className="text-lg font-semibold">₹{totalAmount.toLocaleString()}</p>
                </div>
              </div>
              
              {/* Interest Rate */}
              <div className="bg-muted/50 border p-4 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Interest Rate</p>
                  <p className="text-lg font-semibold">{interestRate}% p.a.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SIP Investment Advice */}
        <Card className="shadow-[var(--shadow-medium)] mb-6 border-green-500/20 bg-green-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-green-700 text-base">
              <TrendingUp className="w-4 h-4" />
              📈 Smart Strategy: SIP Investment
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="bg-white/50 p-3 rounded-lg space-y-3">
              <p className="text-xs text-muted-foreground">
                <strong>Wealth Building Tip:</strong> Start a SIP {sipStartAfter > 0 ? `after ${sipStartAfter} years` : 'now'} for {tenure - sipStartAfter} years. Build wealth while paying your loan!
              </p>
              
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Monthly SIP (₹)</Label>
                  <Input
                    type="number"
                    value={sipAmount}
                    onChange={(e) => setSipAmount(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Expected Return (%)</Label>
                  <Input
                    type="number"
                    value={sipReturn}
                    onChange={(e) => setSipReturn(Number(e.target.value))}
                    className="h-8 text-xs"
                    step="0.5"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Start After (Years)</Label>
                  <Input
                    type="number"
                    value={sipStartAfter}
                    onChange={(e) => setSipStartAfter(Number(e.target.value))}
                    className="h-8 text-xs"
                    min="0"
                    max={tenure}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-blue-100/50 p-2 rounded-lg">
                  <p className="text-[10px] text-muted-foreground">Invested</p>
                  <p className="text-xs font-bold text-blue-700">₹{sipBenefits.totalInvested.toLocaleString()}</p>
                </div>
                <div className="bg-green-100/50 p-2 rounded-lg">
                  <p className="text-[10px] text-muted-foreground">SIP Returns</p>
                  <p className="text-xs font-bold text-green-700">₹{sipBenefits.sipReturns.toLocaleString()}</p>
                </div>
                <div className="bg-orange-100/50 p-2 rounded-lg">
                  <p className="text-[10px] text-muted-foreground">Loan Interest</p>
                  <p className="text-xs font-bold text-orange-700">₹{sipBenefits.interestDuringSIP.toLocaleString()}</p>
                </div>
                <div className={`${sipBenefits.netBenefit >= 0 ? 'bg-green-100/50' : 'bg-red-100/50'} p-2 rounded-lg`}>
                  <p className="text-[10px] text-muted-foreground">Net Gain</p>
                  <p className={`text-xs font-bold ${sipBenefits.netBenefit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {sipBenefits.netBenefit >= 0 ? '+' : '-'}₹{Math.abs(sipBenefits.netBenefit).toLocaleString()}
                  </p>
                </div>
              </div>

              {sipBenefits.canCoverInterest ? (
                <div className="bg-green-100/50 p-2 rounded text-center">
                  <p className="text-xs text-green-800 font-medium">✓ Your SIP returns (₹{sipBenefits.sipReturns.toLocaleString()}) can cover loan interest!</p>
                </div>
              ) : (
                <div className="bg-blue-100/50 p-2 rounded text-center">
                  <p className="text-xs text-blue-800 font-medium">💡 ₹{sipBenefits.requiredSIP.toLocaleString()}/month - SIP returns will cover your loan interest</p>
                </div>
              )}

              {sipAmount !== sipBenefits.requiredSIP && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-7"
                  onClick={() => {
                    setSipAmount(sipBenefits.requiredSIP);
                    toast.success(`SIP set to ₹${sipBenefits.requiredSIP.toLocaleString()}/month`);
                  }}
                >
                  💡 Try Suggested: ₹{sipBenefits.requiredSIP.toLocaleString()}/month
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Prepayment Advice */}
        {interestType === "reducing" && prepaymentBenefits.monthsSaved > 0 && (
          <Card className="shadow-[var(--shadow-medium)] mb-6 border-accent/20 bg-accent/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-accent text-base">
                  <TrendingUp className="w-4 h-4" />
                  💡 Smart Tip: Prepayment Benefits
                </CardTitle>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowPrepaymentSchedule(!showPrepaymentSchedule)}
                  className="h-6 w-6 p-0"
                >
                  <svg 
                    className={`w-4 h-4 transition-transform ${showPrepaymentSchedule ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="bg-white/50 p-3 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>Pro Tip:</strong> Pay one extra EMI (₹{Math.round(emi).toLocaleString()}) at the end of each year to save significantly!
                </p>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-accent/10 p-2 rounded-lg">
                    <p className="text-[10px] text-muted-foreground">Time Saved</p>
                    <p className="text-sm font-bold text-accent">{prepaymentBenefits.yearsSaved.toFixed(1)} years ({Math.round(prepaymentBenefits.monthsSaved)} months)</p>
                  </div>
                  <div className="bg-accent/10 p-2 rounded-lg">
                    <p className="text-[10px] text-muted-foreground">Interest Saved</p>
                    <p className="text-sm font-bold text-accent">₹{Math.round(prepaymentBenefits.interestSaved).toLocaleString()}</p>
                  </div>
                </div>
              </div>
              {showPrepaymentSchedule && (
                <div className="mt-3">
                  <AmortizationSchedule 
                    principal={principal}
                    interestRate={interestRate}
                    tenure={actualTenure}
                    emi={emi}
                    interestType={interestType}
                    desiredEMI={desiredEMI ? Number(desiredEMI) : null}
                    showPrepayment={true}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Bottom Section: Amortization Schedule */}
        <div>
          <AmortizationSchedule 
            principal={principal}
            interestRate={interestRate}
            tenure={actualTenure}
            emi={emi}
            interestType={interestType}
            desiredEMI={desiredEMI ? Number(desiredEMI) : null}
            showPrepayment={false}
          />
        </div>
      </div>
    </div>
  );
};
