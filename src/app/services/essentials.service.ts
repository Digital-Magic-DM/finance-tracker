import { Injectable, inject, computed } from '@angular/core';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { AssetService } from './asset.service';
import { TransactionService } from './transaction.service';
import { AssetType, TransactionType, EssentialsProfile } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class EssentialsService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);

    // Profile Data
    private profileRef$ = new Observable<EssentialsProfile | null>(subscriber => {
        const uid = this.auth.currentUser?.uid;
        if (!uid) { subscriber.next(null); return; }
        const ref = doc(this.firestore, `users/${uid}/essentials/profile`);
        return docData(ref).subscribe(subscriber as any);
    });

    profile = toSignal(this.profileRef$, { initialValue: null });

    // Base Signals
    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });

    // 1. Savings Rate (%)
    savingsRate = computed(() => {
        const txs = this.transactions();
        const income = txs.filter(t => t.type === TransactionType.Income || t.type === TransactionType.Sell)
                          .reduce((s, t) => s + t.amount, 0);
        const expense = txs.filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy)
                           .reduce((s, t) => s + t.amount, 0);
        
        return income > 0 ? ((income - expense) / income) * 100 : 0;
    });

    // 2. Average Monthly Expense (last 3 months approx)
    avgMonthlyExpense = computed(() => {
        const txs = this.transactions()
            .filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy);
        
        if (txs.length === 0) return 0;

        // For simplicity, we take total expenses and divide by months active or last 3
        const total = txs.reduce((s, t) => s + t.amount, 0);
        // Better: Group by month and average
        const months = new Set(txs.map(t => {
            const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000 || t.date);
            return `${d.getMonth()}-${d.getFullYear()}`;
        })).size || 1;

        return total / months;
    });

    // 3. Liquid Assets
    liquidAssetsTotal = computed(() => {
        return this.assets()
            .filter(a => a.type === AssetType.Cash || a.isLiquid)
            .reduce((s, a) => s + (a.quantity * a.currentPrice), 0);
    });

    // 4. Emergency Runway (Months)
    runwayMonths = computed(() => {
        const expense = this.avgMonthlyExpense();
        return expense > 0 ? (this.liquidAssetsTotal() / expense) : 0;
    });

    // 4.1 Runway Targets (3m, 6m, 12m)
    runwayTargets = computed(() => {
        const expense = this.avgMonthlyExpense();
        return {
            risky: expense * 3,
            safe: expense * 6,
            ideal: expense * 12
        };
    });

    // 4.2 Current Net Worth
    currentNetWorth = computed(() => {
        return this.assets().reduce((s, a) => s + (a.quantity * a.currentPrice), 0);
    });

    // 5. FI Clock (Years to Financial Independence)
    // Formula: (Target NetWorth - Current NetWorth) / Annual Savings
    yearsToFI = computed(() => {
        const profile = this.profile();
        if (!profile) return null;

        const currentNetWorth = this.assets().reduce((s, a) => s + (a.quantity * a.currentPrice), 0);
        const annualExpense = this.avgMonthlyExpense() * 12;
        const targetNetWorth = annualExpense * (profile.annualExpenseMultiplier || 25);
        
        const gap = targetNetWorth - currentNetWorth;
        if (gap <= 0) return 0; // Already FI!

        // Estimate annual income from transactions or use a fallback
        const incomeTxs = this.transactions().filter(t => t.type === TransactionType.Income);
        const monthsObserved = new Set(incomeTxs.map(t => {
            const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000 || t.date);
            return `${d.getMonth()}-${d.getFullYear()}`;
        })).size || 1;
        
        const avgMonthlyIncome = incomeTxs.reduce((s, t) => s + t.amount, 0) / monthsObserved;
        const annualIncome = avgMonthlyIncome * 12;
        const annualSavings = (this.savingsRate() / 100) * annualIncome;
        
        return annualSavings > 0 ? gap / annualSavings : Infinity;
    });

    // 6. Insurance Logic (Refined)
    idealTermCover = computed(() => {
        const annualExpense = this.avgMonthlyExpense() * 12;
        const target = annualExpense * 25; // Finboom 25x multiplier
        return Math.max(target - this.currentNetWorth(), 0); 
    });

    idealHealthCover = computed(() => {
        const profile = this.profile();
        const deps = profile?.dependents || 0;
        // Solo: 10L Ideal, Family: 25L Ideal (based on audit)
        return deps > 0 ? 2500000 : 1000000;
    });

    // 7. Health Score (1-10) (Refined weights)
    healthScore = computed(() => {
        let score = 0;

        // Savings Rate (40%) - Target 30%
        const sr = this.savingsRate();
        score += (Math.min(sr / 30, 1) * 4);

        // Runway (30%) - Target 12 months for full score
        const rw = this.runwayMonths();
        score += (Math.min(rw / 12, 1) * 3);

        // Insurance (30%)
        const profile = this.profile();
        if (profile?.insurance) {
            let insScore = 0;
            if (profile.insurance.termCover >= this.idealTermCover()) insScore += 1.5;
            else insScore += (profile.insurance.termCover / (this.idealTermCover() || 1)) * 1.5;

            if (profile.insurance.healthCover >= this.idealHealthCover()) insScore += 1.5;
            else insScore += (profile.insurance.healthCover / this.idealHealthCover()) * 1.5;
            
            score += Math.min(insScore, 3);
        }

        return Math.round(score * 10) / 10;
    });

    // Helper: Estimated Monthly Income and Savings based on average expense and rate
    estimatedMonthlyIncome = computed(() => {
        const expense = this.avgMonthlyExpense();
        const rate = this.savingsRate();
        if (rate >= 100) return expense * 10; // Avoid division by zero
        return expense / (1 - (rate / 100));
    });

    estimatedMonthlySavings = computed(() => {
        return this.estimatedMonthlyIncome() - this.avgMonthlyExpense();
    });

    async updateProfile(data: Partial<EssentialsProfile>) {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/essentials/profile`);
        await setDoc(ref, data, { merge: true });
    }
}
