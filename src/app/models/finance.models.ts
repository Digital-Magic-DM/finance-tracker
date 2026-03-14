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
    location?: AssetLocation;
}

export interface Transaction {
    id?: string;
    type: TransactionType;
    amount: number;
    description: string;
    category: string;
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
