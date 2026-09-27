import { Injectable, inject, computed } from '@angular/core';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { AssetService } from './asset.service';
import { TransactionService } from './transaction.service';
import { GoogleFinanceService } from './google-finance.service';
import { PriceService } from './price.service';
import { AssetType, TransactionType, EssentialsProfile } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class EssentialsService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private googleFinance = inject(GoogleFinanceService);
    private priceService = inject(PriceService);

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

    // Baseline fallbacks when transactions are sparse and no profile override is set
    readonly defaultMonthlyExpense = 50000;
    readonly defaultMonthlyIncome = 100000;

    // 1. Effective Monthly Expense (Profile override -> Transaction average -> Baseline fallback)
    avgMonthlyExpense = computed(() => {
        const txs = this.transactions()
            .filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy);
        
        if (txs.length === 0) return 0;

        const total = txs.reduce((s, t) => s + t.amount, 0);
        const months = new Set(txs.map(t => {
            const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000 || t.date);
            return `${d.getMonth()}-${d.getFullYear()}`;
        })).size || 1;

        return Math.round(total / months);
    });

    effectiveMonthlyExpense = computed(() => {
        const profile = this.profile();
        if (profile?.monthlyExpenseOverride && profile.monthlyExpenseOverride > 0) {
            return profile.monthlyExpenseOverride;
        }
        const txExpense = this.avgMonthlyExpense();
        if (txExpense > 0) return txExpense;
        return this.defaultMonthlyExpense;
    });

    isExpenseEstimated = computed(() => {
        const profile = this.profile();
        if (profile?.monthlyExpenseOverride && profile.monthlyExpenseOverride > 0) return false;
        return this.avgMonthlyExpense() === 0;
    });

    // 2. Effective Monthly Income (Profile override -> Transaction income -> Expense-derived fallback)
    effectiveMonthlyIncome = computed(() => {
        const profile = this.profile();
        if (profile?.monthlyIncomeOverride && profile.monthlyIncomeOverride > 0) {
            return profile.monthlyIncomeOverride;
        }
        const incomeTxs = this.transactions().filter(t => t.type === TransactionType.Income || t.type === TransactionType.Sell);
        if (incomeTxs.length > 0) {
            const monthsObserved = new Set(incomeTxs.map(t => {
                const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000 || t.date);
                return `${d.getMonth()}-${d.getFullYear()}`;
            })).size || 1;
            const avg = incomeTxs.reduce((s, t) => s + t.amount, 0) / monthsObserved;
            if (avg > 0) return Math.round(avg);
        }
        return Math.round(Math.max(this.effectiveMonthlyExpense() * 1.6, this.defaultMonthlyIncome));
    });

    // 3. Savings Rate (%)
    savingsRate = computed(() => {
        const inc = this.effectiveMonthlyIncome();
        const exp = this.effectiveMonthlyExpense();
        if (inc <= 0) return 0;
        return Math.max(0, Math.min(100, Math.round(((inc - exp) / inc) * 100)));
    });

    // 4. Liquid Assets Total (Cash + isLiquid assets + Liquid/Overnight/Arbitrage Mutual Funds)
    liquidAssetsTotal = computed(() => {
        return this.assets()
            .filter(a => {
                if (a.type === AssetType.Cash || a.isLiquid) return true;
                if (a.type === AssetType.MutualFund) {
                    const n = (a.name || '').toLowerCase();
                    return /liquid|overnight|arbitrage|money market|savings fund|cash/i.test(n);
                }
                return false;
            })
            .reduce((s, a) => {
                const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.RealEstate ? a.buyPrice : 0);
                const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
                return s + (a.quantity * cp * fx);
            }, 0);
    });

    // 5. Emergency Runway (Months)
    runwayMonths = computed(() => {
        const expense = this.effectiveMonthlyExpense();
        return expense > 0 ? (this.liquidAssetsTotal() / expense) : 0;
    });

    // 5.1 Runway Targets (3m, 6m, 12m)
    runwayTargets = computed(() => {
        const expense = this.effectiveMonthlyExpense();
        return {
            risky: expense * 3,
            safe: expense * 6,
            ideal: expense * 12
        };
    });

    // 5.2 Current Net Worth
    currentNetWorth = computed(() => {
        return this.assets().reduce((s, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.RealEstate ? a.buyPrice : 0);
            const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
            return s + (a.quantity * cp * fx);
        }, 0);
    });

    // 6. FI Target Net Worth (Multiplier x Annual Expense)
    fiTargetNetWorth = computed(() => {
        const profile = this.profile();
        const multiplier = profile?.annualExpenseMultiplier || 25;
        return (this.effectiveMonthlyExpense() * 12) * multiplier;
    });

    // 6.1 FI Progress (%)
    fiProgressPct = computed(() => {
        const target = this.fiTargetNetWorth();
        if (target <= 0) return 0;
        return Math.min(100, Math.max(0, Math.round((this.currentNetWorth() / target) * 1000) / 10));
    });

    // 6.2 FI Clock (Years to Financial Independence)
    yearsToFI = computed(() => {
        const currentNetWorth = this.currentNetWorth();
        const targetNetWorth = this.fiTargetNetWorth();
        const gap = targetNetWorth - currentNetWorth;
        if (gap <= 0) return 0; // Already FI!

        const annualSavings = (this.effectiveMonthlyIncome() - this.effectiveMonthlyExpense()) * 12;
        if (annualSavings <= 0) return Infinity;

        const raw = gap / annualSavings;
        return Math.round(raw * 10) / 10;
    });

    // 7. Insurance Logic
    idealTermCover = computed(() => {
        const annualExpense = this.effectiveMonthlyExpense() * 12;
        const target = annualExpense * 25;
        return Math.max(target - this.currentNetWorth(), 0);
    });

    idealHealthCover = computed(() => {
        const profile = this.profile();
        const deps = profile?.dependents || 0;
        // Solo: 10L Ideal, Family with dependents: 25L Ideal
        return deps > 0 ? 2500000 : 1000000;
    });

    // 8. Health Score (1-10)
    healthScore = computed(() => {
        let score = 0;

        // Savings Rate (35%) - 40%+ yields full 3.5 points
        const sr = this.savingsRate();
        score += (Math.min(sr / 40, 1) * 3.5);

        // Runway (35%) - 12 months buffer yields full 3.5 points
        const rw = this.runwayMonths();
        score += (Math.min(rw / 12, 1) * 3.5);

        // Insurance (30%) - 1.5 Term + 1.5 Health
        const profile = this.profile();
        const term = profile?.insurance?.termCover || 0;
        const health = profile?.insurance?.healthCover || 0;
        const targetTerm = this.idealTermCover();
        const targetHealth = this.idealHealthCover();

        if (targetTerm === 0) {
            score += 1.5; // FI reached
        } else {
            score += Math.min(term / targetTerm, 1) * 1.5;
        }

        score += Math.min(health / targetHealth, 1) * 1.5;

        return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
    });

    // Helper: Estimated Monthly Income and Savings
    estimatedMonthlyIncome = computed(() => this.effectiveMonthlyIncome());

    estimatedMonthlySavings = computed(() => {
        return Math.max(0, this.effectiveMonthlyIncome() - this.effectiveMonthlyExpense());
    });

    async updateProfile(data: Partial<EssentialsProfile>) {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/essentials/profile`);
        await setDoc(ref, data, { merge: true });
    }
}
