import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { AssetService } from '../../../services/asset.service';
import { SnapshotService } from '../../../services/snapshot.service';
import { NetworthChartComponent } from '../../../shared/networth-chart/networth-chart.component';
import { Asset, AssetType, NetWorthPoint } from '../../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';

export type PortfolioAnalysisTab = 'stocks' | 'mutual_funds' | 'bonds' | 'all';

@Component({
    selector: 'app-portfolio-analysis',
    standalone: true,
    imports: [CommonModule, DecimalPipe, NetworthChartComponent],
    templateUrl: './portfolio-analysis.component.html',
    styleUrl: './portfolio-analysis.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioAnalysisComponent implements OnInit {
    private assetService = inject(AssetService);
    private snapshotService = inject(SnapshotService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });

    activeTab = signal<PortfolioAnalysisTab>('stocks');
    hideAmounts = signal<boolean>(false);

    ngOnInit(): void {
        const queryTab = this.route.snapshot.queryParams['tab'];
        if (queryTab && ['stocks', 'mutual_funds', 'bonds', 'all'].includes(queryTab)) {
            this.activeTab.set(queryTab as PortfolioAnalysisTab);
        }
    }

    setTab(tab: PortfolioAnalysisTab): void {
        this.activeTab.set(tab);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    toggleHideAmounts(): void {
        this.hideAmounts.update(v => !v);
    }

    filteredAssets = computed(() => {
        const all = this.assets();
        const tab = this.activeTab();
        switch (tab) {
            case 'stocks':
                return all.filter(a => a.type === AssetType.Stock || a.type === AssetType.USStock || a.type === AssetType.Gold);
            case 'mutual_funds':
                return all.filter(a => a.type === AssetType.MutualFund);
            case 'bonds':
                return all.filter(a => a.type === AssetType.Bond || a.type === AssetType.FixedDeposit);
            case 'all':
            default:
                return all.filter(a => a.type !== AssetType.Cash && a.type !== AssetType.SavingsAccount);
        }
    });

    currentValue = computed(() => {
        return this.filteredAssets().reduce((sum, a) => sum + (this.getAssetValue(a)), 0);
    });

    investedValue = computed(() => {
        return this.filteredAssets().reduce((sum, a) => sum + (Number(a.buyPrice || 0) * Number(a.quantity || 0)), 0);
    });

    totalGain = computed(() => {
        return this.currentValue() - this.investedValue();
    });

    totalGainPct = computed(() => {
        const inv = this.investedValue();
        if (inv <= 0) return 0;
        return (this.totalGain() / inv) * 100;
    });

    dayGain = computed(() => {
        return this.filteredAssets().reduce((sum, a) => {
            const val = this.getAssetValue(a);
            const pct = (a.dailyChange || 0) / 100;
            return sum + (val * pct);
        }, 0);
    });

    dayGainPct = computed(() => {
        const cur = this.currentValue();
        if (cur <= 0) return 0;
        return (this.dayGain() / cur) * 100;
    });

    chartPoints = computed<NetWorthPoint[]>(() => {
        const assets = this.filteredAssets();
        const snaps = this.snapshots();
        return this.snapshotService.buildNetWorthPoints(snaps, assets);
    });

    pageTitle = computed(() => {
        const tab = this.activeTab();
        if (tab === 'mutual_funds') return 'MF Portfolio analysis';
        if (tab === 'bonds') return 'Bonds & Fixed Income analysis';
        if (tab === 'all') return 'Overall Portfolio analysis';
        return 'Portfolio analysis';
    });

    getAssetValue(asset: Asset): number {
        const cp = (asset.currentPrice && asset.currentPrice > 0) ? asset.currentPrice : (asset.buyPrice || 0);
        return (asset.quantity || 0) * cp;
    }

    goBack(): void {
        this.router.navigate(['/app/assets'], {
            queryParams: { tab: this.activeTab() }
        });
    }
}
