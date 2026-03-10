import { Component, inject, computed } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';
import { TransactionType, TRANSACTION_CATEGORIES } from '../../models/finance.models';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-analytics',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, NetworthChartComponent],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private snapshotService = inject(SnapshotService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    networthHistory = computed(() =>
        this.snapshots().map((s) => ({ date: s.date, value: s.netWorth }))
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
}
