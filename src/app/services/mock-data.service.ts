import { Injectable, inject } from '@angular/core';
import { AssetService } from './asset.service';
import { TransactionService } from './transaction.service';
import { AssetType, TransactionType } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class MockDataService {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);

    async seedIfEmpty(assetCount: number): Promise<void> {
        if (assetCount > 0) return; // already seeded

        const baseDate = new Date();

        const assets = [
            {
                name: 'Reliance Industries',
                type: AssetType.Stock,
                quantity: 50,
                buyPrice: 2200,
                currentPrice: 2450,
                symbol: 'RELIANCE',
                currency: 'INR',
                purchaseDate: new Date(baseDate.getFullYear(), baseDate.getMonth() - 6, 1),
                notes: 'Long-term hold',
            },
            {
                name: 'HDFC Bank',
                type: AssetType.Stock,
                quantity: 30,
                buyPrice: 1600,
                currentPrice: 1720,
                symbol: 'HDFCBANK',
                currency: 'INR',
                purchaseDate: new Date(baseDate.getFullYear(), baseDate.getMonth() - 4, 15),
            },
            {
                name: 'Axis Bluechip Fund',
                type: AssetType.MutualFund,
                quantity: 1000,
                buyPrice: 42,
                currentPrice: 48,
                symbol: 'AXISBLUECHIP',
                currency: 'INR',
                purchaseDate: new Date(baseDate.getFullYear(), baseDate.getMonth() - 8, 1),
            },
            {
                name: 'Gold Sovereign Bond',
                type: AssetType.Gold,
                quantity: 10,
                buyPrice: 5200,
                currentPrice: 5980,
                symbol: 'GOLDBOND',
                currency: 'INR',
                purchaseDate: new Date(baseDate.getFullYear() - 1, 0, 1),
                notes: '24-karat gold bonds',
            },
            {
                name: 'Emergency Fund',
                type: AssetType.Cash,
                quantity: 1,
                buyPrice: 150000,
                currentPrice: 150000,
                currency: 'INR',
                purchaseDate: new Date(baseDate.getFullYear() - 2, 0, 1),
                notes: '6-month emergency reserve',
            },
        ];

        for (const asset of assets) {
            await this.assetService.addAsset(asset as any);
        }

        const transactions = [
            {
                type: TransactionType.Income,
                amount: 85000,
                description: 'Monthly Salary',
                category: 'Salary',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1),
            },
            {
                type: TransactionType.Expense,
                amount: 18000,
                description: 'Monthly Rent',
                category: 'Rent',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 2),
            },
            {
                type: TransactionType.Buy,
                amount: 50 * 2200,
                description: 'Bought Reliance',
                category: 'Investment',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth() - 6, 1),
                assetName: 'Reliance Industries',
            },
            {
                type: TransactionType.Expense,
                amount: 4500,
                description: 'Grocery Shopping',
                category: 'Food',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 5),
            },
            {
                type: TransactionType.Expense,
                amount: 2800,
                description: 'Restaurant Dinner',
                category: 'Food',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 8),
            },
            {
                type: TransactionType.Expense,
                amount: 1200,
                description: 'Uber Rides',
                category: 'Transport',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 10),
            },
            {
                type: TransactionType.Expense,
                amount: 3200,
                description: 'Electricity + Internet',
                category: 'Utilities',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 7),
            },
            {
                type: TransactionType.Income,
                amount: 85000,
                description: 'Monthly Salary',
                category: 'Salary',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1),
            },
            {
                type: TransactionType.Expense,
                amount: 12000,
                description: 'Shopping - Clothes',
                category: 'Shopping',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 20),
            },
            {
                type: TransactionType.Buy,
                amount: 42000,
                description: 'Axis Bluechip SIP',
                category: 'Investment',
                date: new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 5),
                assetName: 'Axis Bluechip Fund',
            },
        ];

        for (const tx of transactions) {
            await this.txService.addTransaction(tx as any);
        }
    }
}
