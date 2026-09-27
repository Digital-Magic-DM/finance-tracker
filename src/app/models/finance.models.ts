export enum AssetType {
    Stock = 'Stock',
    MutualFund = 'MutualFund',
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
}

export const ASSET_COLORS: { [key in AssetType]: string } = {
    [AssetType.Stock]: 'var(--asset-stock)',
    [AssetType.MutualFund]: 'var(--asset-mf)',
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

export type ChartDataSource = 'Income' | 'Expense' | 'Assets';
export type ChartMetric = 'Sum' | 'Count';
export type ChartDimension = 'Category' | 'Type' | 'Time' | 'AppSource' | 'None';
export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut';

export interface ChartDateRange {
    startDate?: string; // ISO
    endDate?: string; // ISO
}

export interface ChartFilter {
    dateRange?: ChartDateRange;
    categories?: string[];
    assetTypes?: AssetType[];
    appSources?: string[];
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

