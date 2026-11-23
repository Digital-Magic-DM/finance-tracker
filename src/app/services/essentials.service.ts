import { Injectable, inject, computed } from '@angular/core';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { AssetService } from './asset.service';
import { TransactionService } from './transaction.service';
import { GoogleFinanceService } from './google-finance.service';
import { PriceService } from './price.service';
import { SnapshotService } from './snapshot.service';
import { AssetType, TransactionType, EssentialsProfile } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class EssentialsService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private googleFinance = inject(GoogleFinanceService);
    private priceService = inject(PriceService);
    private snapshotService = inject(SnapshotService);

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
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

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

    // 4. Liquid Assets Total (Cash + Fixed Deposits + isLiquid assets + Liquid/Overnight/Arbitrage Mutual Funds)
    liquidAssetsTotal = computed(() => {
        return this.assets()
            .filter(a => {
                if (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.FixedDeposit || a.isLiquid) return true;
                if (a.type === AssetType.MutualFund) {
                    const n = (a.name || '').toLowerCase();
                    return /liquid|overnight|arbitrage|money market|savings fund|cash/i.test(n);
                }
                return false;
            })
            .reduce((s, a) => {
                const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
                const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
                return s + (a.quantity * cp * fx);
            }, 0);
    });

    // 5. Emergency Runway (Months)
    runwayMonths = computed(() => {
        const expense = this.effectiveMonthlyExpense();
        return expense > 0 ? (this.liquidAssetsTotal() / expense) : 0;
    });

    // 5.1 Configured Target Runway (Defaults to 6 months if not specified)
    targetRunwayMonths = computed(() => {
        const profile = this.profile();
        return profile?.targetRunwayMonths && profile.targetRunwayMonths > 0 ? profile.targetRunwayMonths : 6;
    });

    targetRunwayCapital = computed(() => {
        return this.effectiveMonthlyExpense() * this.targetRunwayMonths();
    });

    runwayTargetProgress = computed(() => {
        const target = this.targetRunwayCapital();
        if (target <= 0) return 0;
        return Math.min(100, Math.round((this.liquidAssetsTotal() / target) * 100));
    });

    runwayDeficitOrSurplus = computed(() => {
        return this.liquidAssetsTotal() - this.targetRunwayCapital();
    });

    // 5.2 Runway Tier Benchmarks (3m, 6m, 12m)
    runwayTargets = computed(() => {
        const expense = this.effectiveMonthlyExpense();
        return {
            risky: expense * 3,
            safe: expense * 6,
            ideal: expense * 12
        };
    });

    // 5.3 Current Net Worth
    currentNetWorth = computed(() => {
        return this.assets().reduce((s, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
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

    // 9. Financial & Essentials Progress Leap (Tracking How Far User Has Jumped)
    progressLeap = computed(() => {
        const profile = this.profile();
        const currentNW = this.currentNetWorth();
        const currentRunway = this.runwayMonths();
        const currentHealth = this.healthScore();
        const currentFiPct = this.fiProgressPct();
        const currentFiYears = this.yearsToFI();
        const currentSavingsRate = this.savingsRate();
        const snapList = this.snapshots();

        // 1. Determine baseline starting date
        let startDateStr = profile?.startingDate;
        if (!startDateStr) {
            if (snapList.length > 0 && snapList[0].date) {
                startDateStr = snapList[0].date;
            } else {
                // Find earliest asset purchase date
                const assetsWithDates = this.assets()
                    .filter(a => a.purchaseDate && !isNaN(new Date(a.purchaseDate).getTime()))
                    .sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime());
                if (assetsWithDates.length > 0) {
                    startDateStr = new Date(assetsWithDates[0].purchaseDate).toISOString().split('T')[0];
                } else {
                    const d = new Date();
                    d.setMonth(d.getMonth() - 6);
                    startDateStr = d.toISOString().split('T')[0];
                }
            }
        }

        // 2. Determine baseline starting net worth
        let startNW = profile?.startingNetWorth;
        if (startNW === undefined || startNW === null || startNW <= 0) {
            if (snapList.length > 0 && snapList[0].netWorth > 0) {
                startNW = snapList[0].netWorth;
            } else {
                // Cost basis of all assets
                const totalCost = this.assets().reduce((s, a) => {
                    const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
                    return s + (a.quantity * a.buyPrice * fx);
                }, 0);
                startNW = totalCost > 0 ? totalCost : Math.round(currentNW * 0.7);
            }
        }

        // 3. Determine baseline starting runway
        let startRunway = profile?.startingRunwayMonths;
        if (startRunway === undefined || startRunway === null) {
            startRunway = Math.max(0.5, Math.round(Math.min(currentRunway * 0.4, 2) * 10) / 10);
        }

        // 4. Determine baseline health score
        const startHealth = 4.5;

        // 5. Calculate Jump Deltas
        const nwJump = currentNW - startNW;
        const nwGrowthPct = startNW > 0 ? Math.round((nwJump / startNW) * 1000) / 10 : 0;
        const runwayJump = Math.round((currentRunway - startRunway) * 10) / 10;
        const healthJump = Math.round((currentHealth - startHealth) * 10) / 10;

        // Months elapsed
        const startD = new Date(startDateStr);
        const nowD = new Date();
        const monthsElapsed = Math.max(
            1,
            (nowD.getFullYear() - startD.getFullYear()) * 12 + (nowD.getMonth() - startD.getMonth())
        );

        // Milestone Stages Progress
        const stage1Completed = currentRunway >= 3;
        const stage2Completed = currentRunway >= 6 && (profile?.insurance?.termCover || 0) > 0;
        const stage3Completed = currentSavingsRate >= 30 && currentNW >= 1000000;
        const stage4Completed = currentNW >= this.fiTargetNetWorth() && this.fiTargetNetWorth() > 0;

        let currentStageNumber = 1;
        if (stage4Completed) currentStageNumber = 4;
        else if (stage3Completed) currentStageNumber = 4;
        else if (stage2Completed) currentStageNumber = 3;
        else if (stage1Completed) currentStageNumber = 2;

        return {
            startDate: startDateStr,
            monthsElapsed,
            startNW,
            currentNW,
            nwJump,
            nwGrowthPct,
            startRunway,
            currentRunway,
            runwayJump,
            startHealth,
            currentHealth,
            healthJump,
            currentFiPct,
            currentFiYears,
            currentSavingsRate,
            currentStageNumber,
            stages: [
                {
                    id: 1,
                    title: 'Survival Buffer',
                    desc: '3 Months liquid runway to weather unforeseen job or life shocks',
                    target: '3M Runway',
                    isCompleted: stage1Completed,
                    isCurrent: currentStageNumber === 1,
                    icon: 'shield'
                },
                {
                    id: 2,
                    title: 'Fortress Protection',
                    desc: '6+ Months runway & pure term life insurance to protect family',
                    target: '6M + Insurance',
                    isCompleted: stage2Completed,
                    isCurrent: currentStageNumber === 2,
                    icon: 'verified_user'
                },
                {
                    id: 3,
                    title: 'Wealth Velocity',
                    desc: '30%+ Monthly savings rate & rapid capital compounding (> ₹10L NW)',
                    target: '30%+ Savings & 10L+',
                    isCompleted: stage3Completed,
                    isCurrent: currentStageNumber === 3,
                    icon: 'trending_up'
                },
                {
                    id: 4,
                    title: 'Financial Independence (FI)',
                    desc: '25x Annual burn reached. Work becomes 100% optional forever',
                    target: '25x Annual Burn',
                    isCompleted: stage4Completed,
                    isCurrent: currentStageNumber === 4,
                    icon: 'flight_takeoff'
                }
            ]
        };
    });

    async updateProfile(data: Partial<EssentialsProfile>) {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/essentials/profile`);
        await setDoc(ref, data, { merge: true });
    }
}
