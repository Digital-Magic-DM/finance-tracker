import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SnapshotService } from '../../services/snapshot.service';
import { MockDataService } from '../../services/mock-data.service';
import { AuthService } from '../../services/auth.service';
import {
    Asset, Transaction, TransactionType,
    AssetType, ASSET_COLORS, AssetAllocation
} from '../../models/finance.models';
import { PortfolioChartComponent } from '../../shared/portfolio-chart/portfolio-chart.component';
import { NetworthChartComponent } from '../../shared/networth-chart/networth-chart.component';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, PortfolioChartComponent, NetworthChartComponent],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private snapshotService = inject(SnapshotService);
    private mockDataService = inject(MockDataService);
    private authService = inject(AuthService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

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
        return this.transactions()
            .filter((t) => {
                const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000);
                return t.type === TransactionType.Income &&
                    d.getMonth() === now.getMonth() &&
                    d.getFullYear() === now.getFullYear();
            })
            .reduce((s, t) => s + t.amount, 0);
    });

    monthlyExpense = computed(() => {
        const now = new Date();
        return this.transactions()
            .filter((t) => {
                const d = t.date instanceof Date ? t.date : new Date((t.date as any).seconds * 1000);
                return t.type === TransactionType.Expense &&
                    d.getMonth() === now.getMonth() &&
                    d.getFullYear() === now.getFullYear();
            })
            .reduce((s, t) => s + t.amount, 0);
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

    networthHistory = computed(() =>
        this.snapshots().map((s) => ({ date: s.date, value: s.netWorth }))
    );

    async ngOnInit() {
        // Wait briefly for assets to load, then seed if empty
        setTimeout(async () => {
            const count = this.assets().length;
            await this.mockDataService.seedIfEmpty(count);
            // Save a daily snapshot
            await this.snapshotService.saveSnapshot(this.assets());
        }, 1500);
    }

    getTransactionIcon(type: TransactionType): string {
        const icons: Record<TransactionType, string> = {
            [TransactionType.Income]: '↑',
            [TransactionType.Expense]: '↓',
            [TransactionType.Buy]: '◈',
            [TransactionType.Sell]: '◇',
        };
        return icons[type] || '•';
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
