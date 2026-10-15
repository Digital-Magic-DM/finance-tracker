import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';
import { PriceService } from '../../services/price.service';
import { GoogleFinanceService } from '../../services/google-finance.service';
import { PortfolioAnalyticsService } from '../../services/portfolio-analytics.service';
import { TransactionType, AssetType, getAssetAppSource, ASSET_TYPE_LABELS, CustomChartConfig } from '../../models/finance.models';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { AnalyticsBuilderService } from '../../services/analytics-builder.service';
import { CustomAnalyticsBuilderComponent } from './custom-analytics-builder/custom-analytics-builder.component';
import { DynamicChartComponent, DynamicChartDataset } from '../../shared/dynamic-chart/dynamic-chart.component';

export type AnalyticsTimeframe = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

@Component({
    selector: 'app-analytics',
    standalone: true,
    imports: [
        CommonModule,
        CurrencyPipe, 
        DecimalPipe, 
        NetworthChartComponent, 
        CustomAnalyticsBuilderComponent, 
        DynamicChartComponent
    ],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private snapshotService = inject(SnapshotService);
    private analyticsBuilder = inject(AnalyticsBuilderService);
    private priceService = inject(PriceService);
    private googleFinance = inject(GoogleFinanceService);
    public portfolioAnalytics = inject(PortfolioAnalyticsService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    // Active Timeframe filter
    selectedTimeframe = signal<AnalyticsTimeframe>('ALL');
    
    // View toggles for built-in charts
    categoryViewMode = signal<'chart' | 'list'>('chart');
    assetAllocationMode = signal<'type' | 'broker'>('type');

    // Custom Analytics builder modal state
    isBuildingCustomChart = signal(false);
    editingChart = signal<CustomChartConfig | null>(null);

    setTimeframe(tf: AnalyticsTimeframe) {
        this.selectedTimeframe.set(tf);
    }

    openCreateCustomChart() {
        this.editingChart.set(null);
        this.isBuildingCustomChart.set(true);
    }

    openEditCustomChart(config: CustomChartConfig) {
        this.editingChart.set(config);
        this.isBuildingCustomChart.set(true);
    }

    closeCustomBuilder() {
        this.editingChart.set(null);
        this.isBuildingCustomChart.set(false);
    }

    deleteCustomChart(id: string) {
        if (confirm('Are you sure you want to remove this custom analytics card?')) {
            this.analyticsBuilder.deleteConfig(id);
        }
    }

    // Filter transactions based on active timeframe
    filteredTransactions = computed(() => {
        const tf = this.selectedTimeframe();
        const txs = this.transactions();
        if (tf === 'ALL' || !txs.length) return txs;

        const now = new Date();
        let startTime = 0;
        switch (tf) {
            case '1M':
                startTime = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();
                break;
            case '3M':
                startTime = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).getTime();
                break;
            case '6M':
                startTime = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
                break;
            case 'YTD':
                startTime = new Date(now.getFullYear(), 0, 1).getTime();
                break;
            case '1Y':
                startTime = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
                break;
        }

        return txs.filter(t => {
            const d = this.formatDate(t.date);
            return d.getTime() >= startTime;
        });
    });

    // Custom KPI Widgets
    customWidgets = computed(() => {
        return this.analyticsBuilder.savedConfigs()
            .filter(c => c.displayType === 'widget')
            .map(config => {
                return {
                    config,
                    dataSignal: this.analyticsBuilder.buildChartData(config)
                };
            });
    });

    // Custom Charts (both half-width and full-width)
    customCharts = computed(() => {
        return this.analyticsBuilder.savedConfigs()
            .filter(c => c.displayType !== 'widget')
            .map(config => {
                return {
                    config,
                    dataSignal: this.analyticsBuilder.buildChartData(config)
                };
            });
    });

    // Net Worth History
    networthHistory = computed(() =>
        this.snapshotService.buildNetWorthPoints(this.snapshots(), this.assets())
    );

    // Financial KPI Totals (reactive to timeframe)
    totalIncome = computed(() =>
        this.filteredTransactions()
            .filter(t => t.type === TransactionType.Income || t.type === TransactionType.Sell)
            .reduce((s, t) => s + (t.amount || 0), 0)
    );

    totalExpense = computed(() =>
        this.filteredTransactions()
            .filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy)
            .reduce((s, t) => s + (t.amount || 0), 0)
    );

    netSavings = computed(() => this.totalIncome() - this.totalExpense());

    savingsRate = computed(() => {
        const income = this.totalIncome();
        if (income <= 0) return 0;
        return ((income - this.totalExpense()) / income) * 100;
    });

    // Total Portfolio Value
    portfolioValue = computed(() => {
        return this.assets().reduce((total, asset) => {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (
                asset.type === AssetType.Cash || asset.type === AssetType.RealEstate || 
                asset.type === AssetType.Bond || asset.type === AssetType.FixedDeposit ? asset.buyPrice : 0
            );
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            return total + (asset.quantity * cp * fx);
        }, 0);
    });

    // Average Monthly Burn Rate
    monthlyBurnRate = computed(() => {
        const txs = this.filteredTransactions().filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy);
        if (!txs.length) return 0;

        const months = new Set<string>();
        let total = 0;
        txs.forEach(t => {
            const d = this.formatDate(t.date);
            if (!isNaN(d.getTime())) {
                months.add(`${d.getFullYear()}-${d.getMonth()}`);
            }
            total += t.amount || 0;
        });

        const monthCount = Math.max(1, months.size);
        return total / monthCount;
    });

    // Liquid Emergency Runway (Months covered by cash + liquid FDs)
    liquidRunwayMonths = computed(() => {
        const burn = this.monthlyBurnRate();
        if (burn <= 0) return 0;

        const liquidAssets = this.assets()
            .filter(a => a.type === AssetType.Cash || (a.type === AssetType.FixedDeposit && a.isLiquid))
            .reduce((sum, a) => sum + (a.quantity * (a.currentPrice > 0 ? a.currentPrice : a.buyPrice)), 0);

        return Math.round((liquidAssets / burn) * 10) / 10;
    });

    // Cashflow Trajectory Chart Data (Monthly Income vs Expense vs Net Savings)
    cashflowChartData = computed(() => {
        const txs = this.filteredTransactions();
        const monthlyData: Record<string, { income: number; expense: number }> = {};

        txs.forEach(t => {
            const d = this.formatDate(t.date);
            if (isNaN(d.getTime())) return;
            const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            if (!monthlyData[key]) {
                monthlyData[key] = { income: 0, expense: 0 };
            }

            if (t.type === TransactionType.Income || t.type === TransactionType.Sell) {
                monthlyData[key].income += t.amount || 0;
            } else if (t.type === TransactionType.Expense || t.type === TransactionType.Buy) {
                monthlyData[key].expense += t.amount || 0;
            }
        });

        // Sort chronologically
        const sortedEntries = Object.entries(monthlyData).sort((a, b) => {
            const dA = new Date('01 ' + a[0]);
            const dB = new Date('01 ' + b[0]);
            return dA.getTime() - dB.getTime();
        });

        const labels = sortedEntries.map(e => e[0]);
        const incomeData = sortedEntries.map(e => e[1].income);
        const expenseData = sortedEntries.map(e => e[1].expense);
        const savingsData = sortedEntries.map(e => e[1].income - e[1].expense);

        const datasets: DynamicChartDataset[] = [
            {
                label: 'Income',
                data: incomeData,
                backgroundColor: 'rgba(16, 185, 129, 0.85)',
                borderColor: '#10b981',
                borderRadius: 4,
                type: 'bar'
            },
            {
                label: 'Expenses',
                data: expenseData,
                backgroundColor: 'rgba(239, 68, 68, 0.85)',
                borderColor: '#ef4444',
                borderRadius: 4,
                type: 'bar'
            },
            {
                label: 'Net Savings',
                data: savingsData,
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                borderColor: '#0284c7',
                borderWidth: 2.5,
                fill: false,
                tension: 0.3,
                type: 'line'
            }
        ];

        return { labels, datasets };
    });

    // Category Breakdown
    categoryBreakdown = computed(() => {
        const map: Record<string, number> = {};
        for (const tx of this.filteredTransactions()) {
            if (tx.type === TransactionType.Expense || tx.type === TransactionType.Buy) {
                const cat = tx.category || 'Other';
                map[cat] = (map[cat] || 0) + tx.amount;
            }
        }
        const total = Object.values(map).reduce((s, v) => s + v, 0);
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, val]) => ({ cat, val, pct: total > 0 ? (val / total) * 100 : 0 }));
    });

    categoryChartData = computed(() => {
        const breakdown = this.categoryBreakdown();
        return {
            labels: breakdown.map(b => b.cat),
            dataset: breakdown.map(b => b.val)
        };
    });

    // Asset Allocation (By Asset Type)
    assetAllocationByType = computed(() => {
        const map: Record<string, number> = {};
        this.assets().forEach(asset => {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (
                asset.type === AssetType.Cash || asset.type === AssetType.RealEstate || 
                asset.type === AssetType.Bond || asset.type === AssetType.FixedDeposit ? asset.buyPrice : 0
            );
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            const val = asset.quantity * cp * fx;
            const label = ASSET_TYPE_LABELS[asset.type] || asset.type;
            map[label] = (map[label] || 0) + val;
        });

        const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
        return {
            labels: sorted.map(s => s[0]),
            dataset: sorted.map(s => Math.round(s[1]))
        };
    });

    // Asset Allocation (By Platform / Broker)
    assetAllocationByBroker = computed(() => {
        const map: Record<string, number> = {};
        this.assets().forEach(asset => {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (
                asset.type === AssetType.Cash || asset.type === AssetType.RealEstate || 
                asset.type === AssetType.Bond || asset.type === AssetType.FixedDeposit ? asset.buyPrice : 0
            );
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            const val = asset.quantity * cp * fx;
            const broker = getAssetAppSource(asset);
            map[broker] = (map[broker] || 0) + val;
        });

        const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
        return {
            labels: sorted.map(s => s[0]),
            dataset: sorted.map(s => Math.round(s[1]))
        };
    });

    // Spending by Day of the Week
    dayOfWeekSpending = computed(() => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayTotals = [0, 0, 0, 0, 0, 0, 0];

        this.filteredTransactions().forEach(t => {
            if (t.type === TransactionType.Expense || t.type === TransactionType.Buy) {
                const d = this.formatDate(t.date);
                if (!isNaN(d.getTime())) {
                    dayTotals[d.getDay()] += t.amount || 0;
                }
            }
        });

        return {
            labels: days,
            dataset: dayTotals
        };
    });

    hasDayOfWeekData = computed(() => this.dayOfWeekSpending().dataset.some(v => v > 0));

    private formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
