import { Component, OnInit, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';


import {
    TransactionType,
    AssetType, ASSET_COLORS, AssetAllocation
} from '../../models/finance.models';
import { PortfolioChartComponent } from '../../shared/portfolio-chart/portfolio-chart.component';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';
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


    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    quoteOffset = signal(0);

    dailyQuote = computed(() => {
        const data: any = quotesDataFile;

        const val = this.totalGainPct();
        let currentLevel: any = null;
        let quotesArr: string[] = [];
        let icon = '';

        if (val < 0) {
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

    totalNetWorth = computed(() =>
        this.assets().reduce((sum, a) => sum + a.quantity * a.currentPrice, 0)
    );

    totalCost = computed(() =>
        this.assets().reduce((sum, a) => sum + a.quantity * a.buyPrice, 0)
    );

    totalGain = computed(() => this.totalNetWorth() - this.totalCost());

    totalGainPct = computed(() =>
        this.totalCost() > 0 ? (this.totalGain() / this.totalCost()) * 100 : 0
    );

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
            const val = a.quantity * a.currentPrice;
            grouped[a.type] = (grouped[a.type] || 0) + val;
        }
        return Object.entries(grouped).map(([type, value]) => ({
            label: type,
            value,
            percentage: (value / total) * 100,
            color: ASSET_COLORS[type as AssetType] || '#9E9E9E',
        }));
    });
    
    appWiseHoldings = computed(() => {
        const total = this.totalNetWorth();
        if (total === 0) return [];
        
        const grouped: { [key: string]: number } = {};
        for (const a of this.assets()) {
            const val = a.quantity * a.currentPrice;
            const source = a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace('Imported from', '').trim() : 'Manual');
            
            grouped[source] = (grouped[source] || 0) + val;
        }
        
        return Object.entries(grouped)
            .map(([label, value]) => ({
                label,
                value,
                percentage: (value / total) * 100
            }))
            .sort((a, b) => b.value - a.value);
    });

    networthHistory = computed(() =>
        this.snapshots().map((s) => ({ date: s.date, value: s.netWorth }))
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
