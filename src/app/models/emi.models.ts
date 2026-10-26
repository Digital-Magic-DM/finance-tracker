export type LoanCategory =
  | 'Home'
  | 'Vehicle'
  | 'Personal'
  | 'Education'
  | 'CreditCard'
  | 'Gadget'
  | 'Gold'
  | 'Business'
  | 'Other';

export interface EmiPrepayment {
  id: string;
  date: string;
  amount: number;
  type: 'reduce_tenure' | 'reduce_emi';
  note?: string;
}

export interface Loan {
  id: string;
  name: string;
  lender: string;
  loanType: LoanCategory;
  principalAmount: number;
  interestRate: number; // % p.a.
  tenureMonths: number;
  emiAmount: number;
  startDate: string; // YYYY-MM-DD
  dueDay: number; // 1 - 31
  paidEmis: number;
  accountNumber?: string;
  status: 'Active' | 'Closed' | 'Foreclosed';
  prepayments?: EmiPrepayment[];
  foreclosedAt?: string;
  lastPaymentDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AmortizationScheduleEntry {
  monthIndex: number;
  dateStr: string;
  beginningBalance: number;
  emi: number;
  principal: number;
  interest: number;
  endingBalance: number;
  isPaid: boolean;
}

export interface LoanSummaryMetrics {
  totalActiveLoans: number;
  totalMonthlyEmi: number;
  totalOutstandingBalance: number;
  totalOriginalPrincipal: number;
  totalInterestPayable: number;
  totalInterestPaid: number;
  totalAmountPayable: number;
  totalPaidSoFar: number;
  overallProgressPct: number;
  nextUpcomingEmi?: {
    loanName: string;
    lender: string;
    amount: number;
    dueDateStr: string;
    daysRemaining: number;
  };
}

export type TaxRegime = 'old' | 'new';

export interface FoirMetrics {
  monthlyIncome: number;
  isConfigured: boolean;
  totalEmi: number;
  foirPct: number;
  status: 'healthy' | 'moderate' | 'risky' | 'not_set';
  statusLabel: string;
  maxRecommendedEmi: number;
  remainingBorrowingCapacity: number;
}

export interface TaxDeductionSummary {
  regime: TaxRegime;
  taxSlabRate: number; // e.g. 0.10, 0.20, 0.30
  sec24bInterest: number; // Home Loan Interest (capped at 2,00,000 under Old Regime; 0 under New Regime)
  sec80cPrincipal: number; // Home Loan Principal (capped at 1,50,000 under Old Regime; 0 under New Regime)
  sec80eInterest: number; // Education Loan Interest (uncapped under Old Regime; 0 under New Regime)
  totalEligibleDeduction: number;
  estimatedTaxSaved: number; // calculated at selected slab rate
  potentialOldRegimeDeduction: number; // what they could deduct under Old Regime if currently in New Regime
  potentialOldRegimeTaxSaved: number;
  eligibleLoansCount: number;
}

export interface PayoffStrategyItem {
  loan: Loan;
  rank: number;
  outstandingBalance: number;
  interestRate: number;
  monthlyEmi: number;
  strategyReason: string;
}

export interface MonthlyTimelineItem {
  loan: Loan;
  dueDay: number;
  dueDateStr: string;
  amount: number;
  isPaidThisMonth: boolean;
  daysRemaining: number;
  status: 'paid' | 'due_today' | 'due_soon' | 'upcoming' | 'overdue';
}

export const LOAN_TYPE_CONFIG: Record<
  LoanCategory,
  { label: string; icon: string; color: string; defaultRate: number; defaultTenureYears: number }
> = {
  Home: {
    label: 'Home Loan',
    icon: 'home',
    color: '#3b82f6',
    defaultRate: 8.5,
    defaultTenureYears: 20,
  },
  Vehicle: {
    label: 'Vehicle / Car Loan',
    icon: 'directions_car',
    color: '#10b981',
    defaultRate: 9.0,
    defaultTenureYears: 5,
  },
  Personal: {
    label: 'Personal Loan',
    icon: 'person',
    color: '#f59e0b',
    defaultRate: 11.5,
    defaultTenureYears: 3,
  },
  Education: {
    label: 'Education Loan',
    icon: 'school',
    color: '#8b5cf6',
    defaultRate: 9.5,
    defaultTenureYears: 7,
  },
  CreditCard: {
    label: 'Credit Card EMI',
    icon: 'credit_card',
    color: '#ef4444',
    defaultRate: 15.0,
    defaultTenureYears: 1,
  },
  Gadget: {
    label: 'Consumer / Gadget EMI',
    icon: 'laptop_mac',
    color: '#06b6d4',
    defaultRate: 0.0,
    defaultTenureYears: 1,
  },
  Gold: {
    label: 'Gold Loan',
    icon: 'savings',
    color: '#eab308',
    defaultRate: 8.75,
    defaultTenureYears: 2,
  },
  Business: {
    label: 'Business Loan',
    icon: 'business_center',
    color: '#6366f1',
    defaultRate: 13.0,
    defaultTenureYears: 4,
  },
  Other: {
    label: 'Other Loan',
    icon: 'receipt',
    color: '#64748b',
    defaultRate: 10.0,
    defaultTenureYears: 3,
  },
};
