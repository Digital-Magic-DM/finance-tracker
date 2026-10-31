import { Component, OnInit, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';
import { GoogleFinanceService } from '../../services/google-finance.service';
import { PriceService } from '../../services/price.service';


import {
    TransactionType,
    AssetType, AssetAllocation, Asset
} from '../../models/finance.models';
import { PortfolioChartComponent } from '../../shared/portfolio-chart/portfolio-chart.component';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { EssentialsService } from '../../services/essentials.service';
import { GoalService } from '../../services/goal.service';
import { EmiService } from '../../services/emi.service';
import { SipService } from '../../services/sip.service';
import quotesDataFile from '../../../assets/quotes.json';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, PortfolioChartComponent, NetworthChartComponent],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private snapshotService = inject(SnapshotService);
    public googleFinance = inject(GoogleFinanceService);
    public priceService = inject(PriceService);
    public essentialsService = inject(EssentialsService);
    goalService = inject(GoalService);
    public emiService = inject(EmiService);
    public sipService = inject(SipService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    totalLiabilities = computed(() => this.emiService.summaryMetrics().totalOutstandingBalance);
    totalMonthlyEmi = computed(() => this.emiService.summaryMetrics().totalMonthlyEmi);
    netWorthAfterDebt = computed(() => Math.max(0, this.totalNetWorth() - this.totalLiabilities()));

    isRefreshing = signal(false);
    lastRefreshed = signal<string | null>(null);
    quoteOffset = signal(0);

    dailyQuote = computed(() => {
        const data: any = quotesDataFile;

        const val = this.totalGainPct();
        let currentLevel: any = null;
        let quotesArr: string[] = [];
        let icon = '';

        if (val <= -100) {
            currentLevel = data['negative_100_extra'];
        } else if (val <= -70) {
            currentLevel = data['negative_70_to_99_extra'];
        } else if (val <= -50) {
            currentLevel = data['negative_50_to_70_extra'];
        } else if (val <= -20) {
            currentLevel = data['negative_20_to_50_extra'];
        } else if (val <= -10) {
            currentLevel = data['negative_10_to_20_extra'];
        } else if (val <= -5) {
            currentLevel = data['negative_5_to_10_extra'];
        } else if (val < 0) {
            currentLevel = data['negative_small_-1_to_-5_extra'];
        } else if (val >= 0 && val <= 3) {
            currentLevel = data['one_to_three_extra'];
        } else if (val > 3 && val <= 7) {
            currentLevel = data['three_to_seven_extra'];
        } else if (val > 7 && val <= 12) {
            currentLevel = data['seven_to_twelve_extra'];
        } else if (val > 12 && val < 50) {
            currentLevel = data['above_twelve_extra'];
        } else {
            const ext = data['extreme_winners_extra'];
            if (ext) {
                icon = ext.icon || '☠️';
                if (val >= 200) quotesArr = ext.levels['200+'];
                else if (val >= 100) quotesArr = ext.levels['100'];
                else if (val >= 90) quotesArr = ext.levels['90'];
                else quotesArr = ext.levels['50'];
            }
        }

        if (currentLevel) {
            icon = currentLevel.icon;
            quotesArr = currentLevel.quotes;
        }

        if (quotesArr && quotesArr.length > 0) {
            const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24);
            const seed = dayOfYear + Math.floor(this.totalCost() / 1000) + this.quoteOffset();
            const index = seed % quotesArr.length;
            return { icon, text: quotesArr[index] };
        }

        return null;
    });

    refreshQuote() {
        this.quoteOffset.update(v => v + 1);
    }

    getFxRate(a: any): number {
        return this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
    }

    totalNetWorth = computed(() =>
        this.assets().reduce((sum, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
            const fx = this.getFxRate(a);
            return sum + (a.quantity * cp * fx);
        }, 0)
    );

    totalCost = computed(() =>
        this.assets().reduce((sum, a) => {
            const fx = this.getFxRate(a);
            return sum + (a.quantity * a.buyPrice * fx);
        }, 0)
    );

    totalGain = computed(() => this.totalNetWorth() - this.totalCost());

    totalGainPct = computed(() =>
        this.totalCost() > 0 ? (this.totalGain() / this.totalCost()) * 100 : 0
    );

    totalDaysGain = computed(() => {
        return this.assets().reduce((s, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : 0;
            const pct = (a.dailyChange || 0) / 100;
            const daily = cp * pct * a.quantity * this.getFxRate(a);
            return s + daily;
        }, 0);
    });

    totalDaysGainPct = computed(() => {
        const total = this.totalNetWorth();
        return total > 0 ? (this.totalDaysGain() / total) * 100 : 0;
    });

    healthStatus = computed(() => {
        const score = this.essentialsService.healthScore();
        if (score >= 9) return { label: 'Optimal', color: 'var(--accent-success-blend)', icon: 'auto_awesome' };
        if (score >= 7.5) return { label: 'Strong', color: 'var(--accent-success-blend)', icon: 'verified' };
        if (score >= 5) return { label: 'Stable', color: 'var(--accent-warning-blend)', icon: 'check_circle' };
        return { label: 'Needs Focus', color: 'var(--accent-danger-blend)', icon: 'error' };
    });

    async refreshQuotes() {
        if (this.isRefreshing()) return;
        this.isRefreshing.set(true);
        try {
            await this.priceService.refreshAllPrices(this.assets());
            this.lastRefreshed.set(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
        } catch (err) {
            console.error('[Dashboard] Live quote refresh error:', err);
        } finally {
            this.isRefreshing.set(false);
        }
    }

    getAssetApp(a: Asset): string {
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

    getAppColor(appName: string): string {
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

    monthlyIncome = computed(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        return this.transactions()
            .filter((t) => {
                const d = this.formatDate(t.date);
                if (isNaN(d.getTime())) return false;

                const isCorrectMonth = d.getMonth() === month && d.getFullYear() === year;
                const isIncomeType = t.type === TransactionType.Income || t.type === TransactionType.Sell;

                return isIncomeType && isCorrectMonth;
            })
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    });

    monthlyExpense = computed(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        return this.transactions()
            .filter((t) => {
                const d = this.formatDate(t.date);
                if (isNaN(d.getTime())) return false;

                const isCorrectMonth = d.getMonth() === month && d.getFullYear() === year;
                const isExpenseType = t.type === TransactionType.Expense || t.type === TransactionType.Buy;

                return isExpenseType && isCorrectMonth;
            })
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    });

    recentTransactions = computed(() => this.transactions().slice(0, 5));

    allocations = computed<AssetAllocation[]>(() => {
        const total = this.totalNetWorth();
        if (total === 0) return [];
        const grouped: { [key: string]: number } = {};
        for (const a of this.assets()) {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
            const fx = this.getFxRate(a);
            const val = a.quantity * cp * fx;

            let label = 'Other';
            if (a.type === AssetType.USStock || (a.type === AssetType.Stock && this.priceService.isUSAsset(a))) {
                label = 'US Stocks';
            } else if (a.type === AssetType.Stock) {
                label = 'Indian Stocks';
            } else if (a.type === AssetType.MutualFund) {
                label = 'Mutual Funds';
            } else if (a.type === AssetType.FixedDeposit) {
                label = 'Fixed Deposits';
            } else if (a.type === AssetType.Bond) {
                label = 'Bonds';
            } else if (a.type === AssetType.ETF) {
                label = 'ETFs';
            } else if (a.type === AssetType.Gold) {
                label = 'Gold';
            } else if (a.type === AssetType.RealEstate) {
                label = 'Real Estate';
            } else if (a.type === AssetType.Crypto) {
                label = 'Crypto';
            } else if (a.type === AssetType.Cash) {
                label = 'Cash';
            } else if (a.type === AssetType.SavingsAccount) {
                label = 'Savings Account';
            }

            grouped[label] = (grouped[label] || 0) + val;
        }

        const labelColors: Record<string, string> = {
            'Indian Stocks': 'var(--asset-stock)',
            'Stock': 'var(--asset-stock)',
            'US Stocks': 'var(--asset-us-stock)',
            'USStock': 'var(--asset-us-stock)',
            'Mutual Funds': 'var(--asset-mf)',
            'MutualFund': 'var(--asset-mf)',
            'Fixed Deposits': 'var(--asset-fd)',
            'FixedDeposit': 'var(--asset-fd)',
            'Bonds': 'var(--asset-bond)',
            'Bond': 'var(--asset-bond)',
            'ETFs': 'var(--asset-etf)',
            'ETF': 'var(--asset-etf)',
            'Gold': 'var(--asset-gold)',
            'Cash': 'var(--asset-cash)',
            'Savings Account': 'var(--asset-savings, #10b981)',
            'SavingsAccount': 'var(--asset-savings, #10b981)',
            'Real Estate': 'var(--asset-re)',
            'RealEstate': 'var(--asset-re)',
            'Crypto': 'var(--asset-crypto)',
            'Other': 'var(--asset-other)',
        };

        return Object.entries(grouped)
            .map(([label, value]) => ({
                label,
                value,
                percentage: (value / total) * 100,
                color: labelColors[label] || 'var(--asset-other)',
            }))
            .sort((a, b) => b.value - a.value);
    });

    appWiseHoldings = computed(() => {
        const total = this.totalNetWorth();
        if (total === 0) return [];

        const grouped: { [key: string]: number } = {};
        for (const a of this.assets()) {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
            const fx = this.getFxRate(a);
            const val = a.quantity * cp * fx;
            const source = this.getAssetApp(a);

            grouped[source] = (grouped[source] || 0) + val;
        }

        return Object.entries(grouped)
            .map(([label, value]) => ({
                label,
                value,
                percentage: (value / total) * 100,
                color: this.getAppColor(label)
            }))
            .sort((a, b) => b.value - a.value);
    });

    networthHistory = computed(() =>
        this.snapshotService.buildNetWorthPoints(this.snapshots(), this.assets())
    );

    monthlySpendingTrend = computed(() => {
        const map: Record<string, number> = {};
        for (const tx of this.transactions()) {
            if (tx.type === TransactionType.Expense || tx.type === TransactionType.Buy) {
                const d = this.formatDate(tx.date);
                if (isNaN(d.getTime())) continue;
                const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
                map[key] = (map[key] || 0) + tx.amount;
            }
        }

        // Return last 4 months for dashboard
        return Object.entries(map)
            .map(([month, amount]) => ({ month, amount }))
            .reverse()
            .slice(0, 4);
    });

    async ngOnInit() {
        // Wait briefly for assets to load, then save a daily snapshot
        setTimeout(async () => {
            await this.snapshotService.saveSnapshot(this.assets());
        }, 1500);
    }

    getTransactionIcon(type: TransactionType): string {
        const icons: Record<TransactionType, string> = {
            [TransactionType.Income]: 'arrow_upward',
            [TransactionType.Expense]: 'arrow_downward',
            [TransactionType.Buy]: 'add_circle',
            [TransactionType.Sell]: 'remove_circle',
        };
        return icons[type] || 'circle';
    }

    getTransactionClass(type: TransactionType): string {
        if (type === TransactionType.Income || type === TransactionType.Sell) return 'positive';
        return 'negative';
    }

    formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
