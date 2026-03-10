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

export interface Asset {
    id?: string;
    name: string;
    type: AssetType;
    quantity: number;
    buyPrice: number;
    currentPrice: number;
    symbol?: string;
    currency: string;
    purchaseDate: Date;
    notes?: string;
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
    [AssetType.Stock]: '#6C63FF',
    [AssetType.MutualFund]: '#00D4AA',
    [AssetType.ETF]: '#29B6F6',
    [AssetType.Gold]: '#FFD700',
    [AssetType.Cash]: '#4FC3F7',
    [AssetType.RealEstate]: '#FF6B6B',
    [AssetType.Crypto]: '#FF9800',
    [AssetType.Other]: '#9E9E9E',
};

export const TRANSACTION_CATEGORIES = [
    'Salary', 'Investment', 'Food', 'Transport', 'Utilities',
    'Entertainment', 'Healthcare', 'Shopping', 'Education', 'Rent', 'Other'
];
