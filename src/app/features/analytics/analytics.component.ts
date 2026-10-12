import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';
import { TransactionType } from '../../models/finance.models';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { AnalyticsBuilderService } from '../../services/analytics-builder.service';
import { CustomAnalyticsBuilderComponent } from './custom-analytics-builder/custom-analytics-builder.component';
import { DynamicChartComponent } from '../../shared/dynamic-chart/dynamic-chart.component';

@Component({
    selector: 'app-analytics',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, NetworthChartComponent, CustomAnalyticsBuilderComponent, DynamicChartComponent],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private snapshotService = inject(SnapshotService);
    private analyticsBuilder = inject(AnalyticsBuilderService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    isBuildingCustomChart = signal(false);

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

    deleteCustomChart(id: string) {
        this.analyticsBuilder.deleteConfig(id);
    }

    networthHistory = computed(() =>
        this.snapshotService.buildNetWorthPoints(this.snapshots(), this.assets())
    );

    categoryBreakdown = computed(() => {
        const map: Record<string, number> = {};
        for (const tx of this.transactions()) {
            if (tx.type === TransactionType.Expense) {
                map[tx.category] = (map[tx.category] || 0) + tx.amount;
            }
        }
        const total = Object.values(map).reduce((s, v) => s + v, 0);
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, val]) => ({ cat, val, pct: total > 0 ? (val / total) * 100 : 0 }));
    });

    totalIncome = computed(() =>
        this.transactions()
            .filter((t) => t.type === TransactionType.Income)
            .reduce((s, t) => s + t.amount, 0)
    );

    totalExpense = computed(() =>
        this.transactions()
            .filter((t) => t.type === TransactionType.Expense)
            .reduce((s, t) => s + t.amount, 0)
    );

    savingsRate = computed(() =>
        this.totalIncome() > 0 ? ((this.totalIncome() - this.totalExpense()) / this.totalIncome()) * 100 : 0
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
        
        // Return last 6 months in chronological order
        return Object.entries(map)
            .map(([month, amount]) => ({ month, amount }))
            .reverse() // Most recent first for the list, but we might want chronological for chart
            .slice(0, 6);
    });

    private formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
