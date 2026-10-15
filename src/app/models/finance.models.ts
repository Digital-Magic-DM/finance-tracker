export enum AssetType {
    Stock = 'Stock',
    USStock = 'USStock',
    MutualFund = 'MutualFund',
    FixedDeposit = 'FixedDeposit',
    Bond = 'Bond',
    ETF = 'ETF',
    Gold = 'Gold',
    Cash = 'Cash',
    RealEstate = 'RealEstate',
    Crypto = 'Crypto',
    Other = 'Other',
}

export interface InsuranceInfo {
    termCover: number;
    healthCover: number;
    lastUpdated?: string;
}

export interface EssentialsProfile {
    age: number;
    targetRetirementAge: number;
    annualExpenseMultiplier: number; // usually 25 for 4% rule
    dependents: number; // New: for health insurance logic
    insurance: InsuranceInfo;
    monthlyExpenseOverride?: number; // Manual monthly expense/burn rate (₹)
    monthlyIncomeOverride?: number;  // Manual monthly income (₹)
    targetRunwayMonths?: number;     // Target emergency runway months (e.g. 3, 6, 9, 12; default 6)
}

export enum TransactionType {
    Buy = 'Buy',
    Sell = 'Sell',
    Income = 'Income',
    Expense = 'Expense',
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    createdAt: Date;
}

export interface AssetLocation {
    type: 'manual' | 'map';
    name: string;
    lat?: number;
    lng?: number;
    formattedAddress?: string;
}

export interface Asset {
    id?: string;
    name: string;
    type: AssetType;
    quantity: number;
    buyPrice: number;
    currentPrice: number;
    dailyChange?: number;
    symbol?: string;
    currency: string;
    purchaseDate: Date;
    notes?: string;
    appSource?: string;
    location?: AssetLocation;
    lastUpdated?: string;
    lastUpdatedDate?: string; // YYYY-MM-DD format (e.g. '2026-09-27') to limit updates to once a day
    navDate?: string;         // NAV date reported by AMFI / MFAPI (e.g. '26-Sep-2026')
    isLiquid?: boolean; // New: for Emergency Runway calculation
    interestRate?: number;     // e.g. 7.5% for FD or 8.2% coupon for Corporate Bond
    maturityDate?: string;     // YYYY-MM-DD or date string
    subType?: string;          // e.g. 'Corporate Bond' | 'Govt Bond (G-Sec)' | 'Bank FD' | 'NBFC FD' | 'Tax-Free Bond'
}

export interface Transaction {
    id?: string;
    type: TransactionType;
    amount: number;
    description: string;
    category: string;
    bank?: string;
    date: Date;
    assetId?: string;
    assetName?: string;
    notes?: string;
}

export interface PortfolioSnapshot {
    id?: string;
    date: string; // YYYY-MM-DD
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
    totalInvested?: number;
    totalProfit?: number;
    breakdown: { [key in AssetType]?: number };
}

export interface AssetAllocation {
    label: string;
    value: number;
    percentage: number;
    color: string;
}

export interface NetWorthPoint {
    date: string;
    value: number;
    invested?: number;
    profit?: number;
}

export const ASSET_COLORS: { [key in AssetType]: string } = {
    [AssetType.Stock]: 'var(--asset-stock)',
    [AssetType.USStock]: 'var(--asset-us-stock)',
    [AssetType.MutualFund]: 'var(--asset-mf)',
    [AssetType.FixedDeposit]: 'var(--asset-fd)',
    [AssetType.Bond]: 'var(--asset-bond)',
    [AssetType.ETF]: 'var(--asset-etf)',
    [AssetType.Gold]: 'var(--asset-gold)',
    [AssetType.Cash]: 'var(--asset-cash)',
    [AssetType.RealEstate]: 'var(--asset-re)',
    [AssetType.Crypto]: 'var(--asset-crypto)',
    [AssetType.Other]: 'var(--asset-other)',
};

export const TRANSACTION_CATEGORIES = [
    'Salary', 'Investment', 'Food', 'Transport', 'Utilities',
    'Entertainment', 'Healthcare', 'Shopping', 'Education', 'Rent', 'Other'
];

export const ASSET_TYPE_LABELS: Record<string, string> = {
    [AssetType.Stock]: 'Indian Stocks',
    [AssetType.USStock]: 'US Stocks',
    [AssetType.MutualFund]: 'Mutual Funds',
    [AssetType.FixedDeposit]: 'Fixed Deposits',
    [AssetType.Bond]: 'Bonds',
    [AssetType.ETF]: 'ETFs',
    [AssetType.Gold]: 'Gold',
    [AssetType.Crypto]: 'Crypto',
    [AssetType.RealEstate]: 'Real Estate',
    [AssetType.Cash]: 'Cash',
    [AssetType.Other]: 'Other'
};

export type ChartDataSource = 'Income' | 'Expense' | 'Assets';
export type ChartMetric = 'Sum' | 'Count' | 'Average' | 'Max' | 'Min';
export type ChartDimension = 'Category' | 'Type' | 'Time' | 'AppSource' | 'Bank' | 'DayOfWeek' | 'None';
export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'polarArea' | 'radar';
export type ChartPalette = 'default' | 'emerald' | 'sunset' | 'cyber' | 'ocean' | 'monochrome';

export interface ChartDateRange {
    startDate?: string; // ISO
    endDate?: string; // ISO
    preset?: 'all' | '1m' | '3m' | '6m' | 'this_year' | '1y' | 'custom';
}

export interface ChartFilter {
    dateRange?: ChartDateRange;
    categories?: string[];
    assetTypes?: AssetType[];
    appSources?: string[];
    banks?: string[];
    minAmount?: number;
    maxAmount?: number;
}

export interface CustomChartConfig {
    id: string;
    title: string;
    displayType?: 'chart' | 'widget';
    dataSource: ChartDataSource;
    metric: ChartMetric;
    dimension: ChartDimension;
    filters: ChartFilter;
    chartType: ChartType;
    sortBy: 'value_asc' | 'value_desc' | 'label_asc' | 'label_desc' | 'time_asc';
    limit?: number; // top N
    palette?: ChartPalette;
    showLegend?: boolean;
    cardWidth?: 'full' | 'half';
}

export function getAssetAppSource(a: { appSource?: string; notes?: string }): string {
    const raw = (a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace(/^Imported from\s*/i, '').trim() : '')).trim();
    if (!raw) return 'Manual';
    if (/indmoney|indstocks/i.test(raw)) return 'INDmoney';
    if (/groww/i.test(raw)) return 'Groww';
    if (/zerodha/i.test(raw)) return 'Zerodha';
    if (/cdsl|nsdl/i.test(raw)) return 'CDSL / NSDL';
    if (/csv/i.test(raw)) return 'CSV Import';

    const clean = raw.replace(/\s*(pdf\s*statement|statement|\(isin:[^)]*\)|isin:[^\s)]*).*/gi, '').trim();
    return clean || 'Imported';
}

export function getAppBrandColor(appName: string): string {
    const map: Record<string, string> = {
        'INDmoney': '#6366F1',
        'Groww': '#00D09C',
        'Zerodha': '#387ED1',
        'CDSL / NSDL': '#F59E0B',
        'CSV Import': '#06B6D4',
        'Manual': '#EC4899',
        'Imported': '#8B5CF6'
    };
    return map[appName] || '#A855F7';
}

