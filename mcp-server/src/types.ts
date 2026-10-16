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
