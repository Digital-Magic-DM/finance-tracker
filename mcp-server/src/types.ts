export type AssetType =
  | 'Stock'
  | 'USStock'
  | 'MutualFund'
  | 'FixedDeposit'
  | 'Bond'
  | 'ETF'
  | 'Gold'
  | 'Cash'
  | 'RealEstate'
  | 'Crypto'
  | 'Other';

export type TransactionType = 'Buy' | 'Sell' | 'Income' | 'Expense';

export interface Asset {
  id?: string;
  name: string;
  type: AssetType;
  quantity: number;
  buyPrice: number;
  currentPrice: number;
  currency: string;
  purchaseDate?: string;
  notes?: string;
  appSource?: string;
  isLiquid?: boolean;
  interestRate?: number;
  maturityDate?: string;
  subType?: string;
  lastUpdated?: string;
}

export interface Transaction {
  id?: string;
  type: TransactionType;
  amount: number;
  description: string;
  category: string;
  bank?: string;
  date: string; // ISO string
  assetId?: string;
  assetName?: string;
  notes?: string;
}

export interface NetWorthOverview {
  totalNetWorth: number;
  totalInvested: number;
  totalCurrentValue: number;
  totalLiabilities: number;
  totalProfit: number;
  profitPercentage: number;
  liquidAssets: number;
  illiquidAssets: number;
  assetsCount: number;
  breakdown: Record<string, { value: number; percentage: number; count: number }>;
}

export interface CashFlowSummary {
  period: string;
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
  savingsRate: number; // percentage
  transactionsCount: number;
  topExpenseCategories: Array<{ category: string; amount: number; percentage: number }>;
}

export type LoanType = 'Home' | 'Personal' | 'Car' | 'Education' | 'Gold' | 'Consumer' | 'Other';
export type LoanStatus = 'Active' | 'Closed';

export interface EmiPrepayment {
  date: string;
  amount: number;
  type: 'reduce_tenure' | 'reduce_emi';
  note?: string;
}

export interface Loan {
  id: string;
  name: string;
  lender: string;
  loanType: LoanType;
  principalAmount: number;
  interestRate: number;
  tenureMonths: number;
  emiAmount: number;
  startDate: string;
  dueDay: number;
  paidEmis: number;
  prepayments?: EmiPrepayment[];
  accountNumber?: string;
  status: LoanStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmiOverview {
  totalActiveLoans: number;
  totalOutstandingBalance: number;
  totalMonthlyEmi: number;
  totalOriginalPrincipal: number;
  totalInterestPayable: number;
  totalInterestPaid: number;
  totalAmountPayable: number;
  totalPaidSoFar: number;
  overallProgressPct: number;
  loans: Array<{
    id: string;
    name: string;
    lender: string;
    loanType: LoanType;
    principal: number;
    interestRate: number;
    emi: number;
    paidEmis: number;
    tenureMonths: number;
    outstandingBalance: number;
    status: LoanStatus;
  }>;
  debtByType: Record<string, { balance: number; monthlyEmi: number; count: number }>;
  nextDue?: {
    loanName: string;
    lender: string;
    amount: number;
    dueDay: number;
  };
}

export interface DebtPayoffSimulation {
  method: 'avalanche' | 'snowball';
  extraMonthlyPayment: number;
  prioritizedLoans: Array<{
    rank: number;
    loanId: string;
    loanName: string;
    lender: string;
    interestRate: number;
    outstandingBalance: number;
    currentEmi: number;
    reason: string;
  }>;
  totalCurrentDebt: number;
  totalMonthlyCommitment: number;
  estimatedInterestSaved: number;
  estimatedMonthsSaved: number;
  strategyAdvice: string;
}

export type SipCategory = 'MutualFund' | 'Stock' | 'ETF' | 'Gold' | 'Crypto' | 'Other';
export type SipFrequency = 'Monthly' | 'Weekly' | 'Quarterly';
export type SipStatus = 'Active' | 'Paused' | 'Completed' | 'Cancelled';

export interface SipInstallment {
  id: string;
  installmentNumber: number;
  scheduledDate: string;
  executionDate: string;
  amount: number;
  nav?: number;
  units?: number;
  status: 'Executed' | 'Scheduled' | 'Skipped';
  isMarketShifted: boolean;
  shiftReason?: string;
  autoExecuted?: boolean;
}

export interface Sip {
  id: string;
  name: string;
  category: SipCategory;
  fundHouse?: string;
  folioNumber?: string;
  mandateAccount?: string;
  amount: number;
  frequency: SipFrequency;
  sipDay: number;
  startDate: string;
  endDate?: string;
  status: SipStatus;
  autoExecute?: boolean;
  totalInvested: number;
  installmentsPaid: number;
  lastExecutionDate?: string;
  nextExecutionDate?: string;
  stepUp?: { enabled: boolean; type: 'percentage' | 'fixed'; value: number };
  installments?: SipInstallment[];
  notes?: string;
}

export interface SipsOverview {
  totalActiveSips: number;
  totalMonthlyCommitment: number;
  totalInvested: number;
  totalExecutedInstallments: number;
  sips: Array<{
    id: string;
    name: string;
    category: SipCategory;
    fundHouse?: string;
    amount: number;
    frequency: SipFrequency;
    sipDay: number;
    status: SipStatus;
    totalInvested: number;
    installmentsPaid: number;
    nextExecutionDate?: string;
    autoExecute?: boolean;
  }>;
  nextUpcomingSip?: {
    sipId: string;
    sipName: string;
    amount: number;
    scheduledDate: string;
    executionDate: string;
    daysRemaining: number;
    wasShifted: boolean;
    shiftReason?: string;
  };
  marketStatus: {
    isOpen: boolean;
    statusText: string;
    nextSessionText: string;
  };
}
