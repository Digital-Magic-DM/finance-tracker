export type SipFrequency = 'Monthly' | 'Weekly' | 'Quarterly';

export type SipCategory = 'MutualFund' | 'Stock' | 'ETF' | 'Gold' | 'Crypto' | 'Other';

export type SipStatus = 'Active' | 'Paused' | 'Completed' | 'Cancelled';

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
  id: string;
  installmentNumber: number;
  scheduledDate: string; // YYYY-MM-DD (original day, e.g. 15th)
  executionDate: string; // YYYY-MM-DD (actual market open day, e.g. 16th)
  amount: number;
  nav?: number;
  units?: number;
  status: 'Executed' | 'Scheduled' | 'Skipped' | 'Processing';
  isMarketShifted: boolean;
  shiftReason?: string;
  transactionId?: string;
  autoExecuted: boolean;
  executedAt?: string; // ISO string
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
  fundHouse?: string;
  folioNumber?: string;
  mandateAccount?: string; // e.g. 'HDFC Bank - OTM Autopay'
  amount: number;
  frequency: SipFrequency;
  sipDay: number; // 1 - 31 (preferred day of month)
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD or empty for until cancelled
  status: SipStatus;
  stepUp?: SipStepUpConfig;
  linkedAssetId?: string;
  linkedAssetName?: string;
  autoExecute: boolean; // default true: auto update without user manual intervention
  totalInvested: number;
  installmentsPaid: number;
  lastExecutionDate?: string; // YYYY-MM-DD
  nextExecutionDate?: string; // YYYY-MM-DD (market adjusted)
  installments?: SipInstallment[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SipSummaryMetrics {
  totalActiveSips: number;
  totalMonthlyCommitment: number;
  totalInvested: number;
  totalExecutedInstallments: number;
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
