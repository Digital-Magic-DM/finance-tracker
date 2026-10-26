export type SipFrequency = 'Monthly' | 'Weekly' | 'Quarterly';

export type SipCategory = 'MutualFund' | 'Stock' | 'ETF' | 'Gold' | 'Crypto' | 'Other';

export type SipStatus = 'Active' | 'Paused' | 'Completed' | 'Cancelled';

export type SipPaymentStatus = 'Pending' | 'Debited' | 'Failed' | 'Reversed' | 'NotApplicable';

export type SipAllotmentStatus = 'Pending' | 'Confirmed' | 'Mismatched' | 'Cancelled';

export type SipReconciliationStatus = 'Unreconciled' | 'Matched' | 'ManuallyConfirmed' | 'Discrepancy';

export type SipConfirmationSource =
  | 'CAS_STATEMENT'
  | 'BANK_MATCH'
  | 'MANUAL_ENTRY'
  | 'RTA_FEED'
  | 'AMFI_VERIFIED'
  | 'ESTIMATED_LEGACY';

export type SipPlanType = 'Direct' | 'Regular';

export type SipOption = 'Growth' | 'IDCW';

export type SipDataSource = 'CAS' | 'BankStatement' | 'Manual' | 'CAMS' | 'KFintech';

export type SipExecutionMode = 'External' | 'Manual';

export interface MarketHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  day: string; // Monday, Tuesday, etc.
  year: number;
  description?: string;
  clearingClosed?: boolean;
}

export interface TradingDayResolution {
  scheduledDate: string; // YYYY-MM-DD
  executionDate: string; // YYYY-MM-DD (next valid trading day)
  wasShifted: boolean;
  shiftDays: number;
  reason: string;
}

export interface SipInstallment {
  id: string; // Deterministic: `${sipId}_${scheduledDate.replace(/-/g, '')}`
  installmentNumber: number;
  scheduledDate: string; // YYYY-MM-DD (preferred day, e.g. 15th)
  executionDate: string; // YYYY-MM-DD (actual market open day, e.g. 16th)
  amount: number;

  // Lifecycle States
  paymentStatus: SipPaymentStatus;
  paymentDate?: string; // YYYY-MM-DD

  allotmentStatus: SipAllotmentStatus;
  allotmentDate?: string; // YYYY-MM-DD (NAV date confirmed by AMC/RTA)
  nav?: number; // Confirmed allotment NAV
  units?: number; // Confirmed allotted units

  // Reconciliation Audit & Source
  reconciliationStatus: SipReconciliationStatus;
  confirmationSource?: SipConfirmationSource;
  reconciliationNotes?: string;
  externalReference?: string; // UTR number, Folio transaction ref, or CAS entry ref
  transactionId?: string; // Linked bank transaction ID

  // Backwards compatibility for existing UI views
  status: 'Executed' | 'Scheduled' | 'Skipped' | 'Processing';
  isMarketShifted: boolean;
  shiftReason?: string;
  autoExecuted: boolean;
  executedAt?: string; // ISO string when confirmed
  notes?: string;
}

export interface SipStepUpConfig {
  enabled: boolean;
  type: 'percentage' | 'fixed';
  value: number; // e.g. 10 (%) or 1000 (INR)
  frequencyMonths: number; // usually 12 months
}

export interface Sip {
  id: string;
  name: string;
  category: SipCategory;

  // Scheme & Folio Identifiers
  schemeCode?: string; // AMFI 6-digit numeric scheme code (e.g. 122639)
  isin?: string; // Official ISIN (e.g. INF879O01019)
  planType?: SipPlanType; // Direct / Regular
  option?: SipOption; // Growth / IDCW
  fundHouse?: string;
  folioNumber?: string;
  mandateAccount?: string; // e.g. 'HDFC Bank - OTM Autopay'

  // Investment Terms
  amount: number;
  frequency: SipFrequency;
  sipDay: number; // 1 - 31 (preferred day of month)
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD or empty for until cancelled
  status: SipStatus;
  stepUp?: SipStepUpConfig;

  // Tracking Mode & Source
  dataSource?: SipDataSource;
  executionMode?: SipExecutionMode; // Default: 'External' (tracking only, no real-money execution)
  autoExecute: boolean; // Enables automatic generation of expected installments ahead of schedule

  // Accounting: Planned vs Confirmed
  totalCommitted?: number; // Total scheduled/planned investment amount
  totalInvested: number; // Confirmed invested amount ONLY
  confirmedUnitsTotal?: number; // Sum of confirmed allotted units
  installmentsPaid: number; // Count of confirmed installments

  // Schedule Dates
  lastExecutionDate?: string; // YYYY-MM-DD of latest confirmed installment
  nextExecutionDate?: string; // YYYY-MM-DD (next scheduled trading day)
  installments?: SipInstallment[];

  // Portfolio Integration
  linkedAssetId?: string;
  linkedAssetName?: string;

  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NavSnapshot {
  schemeCode: string;
  isin?: string;
  schemeName: string;
  nav: number;
  navDate: string; // YYYY-MM-DD
  fetchedAt: string; // ISO string
  source: 'AMFI_OFFICIAL' | 'MFAPI' | 'MANUAL';
  delayed?: boolean; // True if NAV publication for today is still pending
}

export interface ReconciliationCandidate {
  installmentId: string;
  sipId: string;
  sipName: string;
  installmentNumber: number;
  scheduledDate: string;
  executionDate: string;
  expectedAmount: number;
  currentPaymentStatus: SipPaymentStatus;
  currentAllotmentStatus: SipAllotmentStatus;

  matchedTransaction?: {
    id?: string;
    date: string;
    amount: number;
    description: string;
    bank?: string;
    source: 'BANK_IMPORT' | 'CAS_IMPORT' | 'MANUAL';
  };
  matchedNav?: number;
  matchedNavDate?: string;
  calculatedUnits?: number;
  confidenceScore: number; // 0 to 100
  matchReasons: string[];
  discrepancies: string[];
  status: 'ExactMatch' | 'ProbableMatch' | 'Discrepancy' | 'Unmatched';
}

export interface SipSummaryMetrics {
  totalActiveSips: number;
  totalMonthlyCommitment: number;
  totalInvested: number; // Confirmed amount
  totalPlannedCommitted: number; // Total planned
  totalConfirmedInstallments: number;
  totalPendingAllotments: number; // Debited or scheduled, awaiting unit confirmation
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

export interface YearlyScheduleEntry {
  monthIndex: number; // 0 - 11
  monthName: string;
  scheduledDateStr: string; // YYYY-MM-DD
  executionDateStr: string; // YYYY-MM-DD
  wasShifted: boolean;
  shiftDays: number;
  reason: string;
  isPast: boolean;
  isCurrentMonth: boolean;
  isNextUpcoming: boolean;
}

export const SIP_CATEGORY_CONFIG: Record<
  SipCategory,
  { label: string; icon: string; color: string; badgeBg: string }
> = {
  MutualFund: {
    label: 'Mutual Fund',
    icon: 'pie_chart',
    color: '#8b5cf6',
    badgeBg: 'rgba(139, 92, 246, 0.15)',
  },
  ETF: {
    label: 'Exchange Traded Fund (ETF)',
    icon: 'stacked_line_chart',
    color: '#3b82f6',
    badgeBg: 'rgba(59, 130, 246, 0.15)',
  },
  Stock: {
    label: 'Equity Stock',
    icon: 'show_chart',
    color: '#10b981',
    badgeBg: 'rgba(16, 185, 129, 0.15)',
  },
  Gold: {
    label: 'Gold / Sovereign Gold',
    icon: 'savings',
    color: '#f59e0b',
    badgeBg: 'rgba(245, 158, 11, 0.15)',
  },
  Crypto: {
    label: 'Cryptocurrency',
    icon: 'currency_bitcoin',
    color: '#06b6d4',
    badgeBg: 'rgba(6, 182, 212, 0.15)',
  },
  Other: {
    label: 'Other Investment',
    icon: 'category',
    color: '#64748b',
    badgeBg: 'rgba(100, 116, 139, 0.15)',
  },
};
