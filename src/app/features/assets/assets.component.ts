import { Component, inject, signal, computed, NgZone, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssetService } from '../../services/asset.service';
import { PriceService } from '../../services/price.service';
import { SnackbarService } from '../../services/snackbar.service';
import { Asset, AssetType, ASSET_COLORS } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from '../settings/import-data/import-data.component';

interface AssetGroup {
    type: AssetType;
    label: string;
    assets: Asset[];
    totalValue: number;
    totalGain: number;
    color: string;
    collapsed: boolean;
}

@Component({
    selector: 'app-assets',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule, ImportDataComponent],
    templateUrl: './assets.component.html',
    styleUrl: './assets.component.scss',
})
export class AssetsComponent {
    private assetService = inject(AssetService);
    private priceService = inject(PriceService);
    private snackbar = inject(SnackbarService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    showModal = signal(false);
    showImport = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    refreshingMFs = signal(false);
    refreshingStocks = signal(false);
    lastRefreshed = signal<string>('');

    // Multi-select state
    selectMode = signal(false);
    selectedIds = signal<Set<string>>(new Set());
    deleting = signal(false);
    
    viewMode = signal<'grid' | 'table'>((localStorage.getItem('assetsViewMode') as 'grid' | 'table') || 'grid');

    // Collapsed groups tracking
    private collapsedGroups = signal<Set<string>>(new Set());

    assetTypes = Object.values(AssetType);

    form = signal<Omit<Asset, 'id'>>({
        name: '',
        type: AssetType.Stock,
        quantity: 0,
        buyPrice: 0,
        currentPrice: 0,
        symbol: '',
        currency: 'INR',
        purchaseDate: new Date(),
        notes: '',
    });

    totalValue = computed(() =>
        this.assets().reduce((s, a) => s + a.quantity * a.currentPrice, 0)
    );

    // Group assets by type
    assetGroups = computed(() => {
        const assets = this.assets();
        const collapsed = this.collapsedGroups();
        const groupMap = new Map<AssetType, Asset[]>();

        // Collect assets into type groups
        for (const asset of assets) {
            const type = asset.type || AssetType.Other;
            if (!groupMap.has(type)) {
                groupMap.set(type, []);
            }
            groupMap.get(type)!.push(asset);
        }

        // Define display order
        const typeOrder: AssetType[] = [
            AssetType.MutualFund,
            AssetType.Stock,
            AssetType.ETF,
            AssetType.Gold,
            AssetType.Crypto,
            AssetType.RealEstate,
            AssetType.Cash,
            AssetType.Other,
        ];

        const groups: AssetGroup[] = [];
        for (const type of typeOrder) {
            const typeAssets = groupMap.get(type);
            if (typeAssets && typeAssets.length > 0) {
                groups.push({
                    type,
                    label: this.getTypeLabel(type),
                    assets: typeAssets,
                    totalValue: typeAssets.reduce((s, a) => s + a.quantity * a.currentPrice, 0),
                    totalGain: typeAssets.reduce((s, a) => s + this.getGain(a), 0),
                    color: ASSET_COLORS[type],
                    collapsed: collapsed.has(type),
                });
            }
        }
        return groups;
    });

    selectedCount = computed(() => this.selectedIds().size);

    getTypeLabel(type: AssetType): string {
        const labels: Record<AssetType, string> = {
            [AssetType.MutualFund]: 'Mutual Funds',
            [AssetType.Stock]: 'Stocks',
            [AssetType.ETF]: 'ETFs',
            [AssetType.Gold]: 'Gold',
            [AssetType.Crypto]: 'Crypto',
            [AssetType.RealEstate]: 'Real Estate',
            [AssetType.Cash]: 'Cash',
            [AssetType.Other]: 'Other',
        };
        return labels[type] || type;
    }

    getGain(a: Asset) {
        return (a.currentPrice - a.buyPrice) * a.quantity;
    }

    getGainPct(a: Asset) {
        return a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0;
    }

    getAssetValue(a: Asset) {
        return a.quantity * a.currentPrice;
    }

    getColor(type: AssetType) {
        return ASSET_COLORS[type];
    }

    // ─── Group collapse/expand ───────────────────
    toggleGroup(type: AssetType) {
        this.collapsedGroups.update(set => {
            const next = new Set(set);
            if (next.has(type)) {
                next.delete(type);
            } else {
                next.add(type);
            }
            return next;
        });
    }

    toggleViewMode() {
        const next = this.viewMode() === 'table' ? 'grid' : 'table';
        this.viewMode.set(next);
        localStorage.setItem('assetsViewMode', next);
    }
   // ─── Multi-select ────────────────────────────
    toggleSelectMode() {
        if (this.selectMode()) {
            // Exiting select mode — clear selections
            this.selectMode.set(false);
            this.selectedIds.set(new Set());
        } else {
            this.selectMode.set(true);
        }
    }

    toggleAssetSelection(id: string) {
        this.selectedIds.update(set => {
            const next = new Set(set);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    isSelected(id: string): boolean {
        return this.selectedIds().has(id);
    }

    selectAll() {
        const allIds = this.assets().filter(a => a.id).map(a => a.id!);
        this.selectedIds.set(new Set(allIds));
    }

    deselectAll() {
        this.selectedIds.set(new Set());
    }

    selectGroupAll(group: AssetGroup) {
        this.selectedIds.update(set => {
            const next = new Set(set);
            for (const a of group.assets) {
                if (a.id) next.add(a.id);
            }
            return next;
        });
    }

    async deleteSelected() {
        const ids = Array.from(this.selectedIds());
        if (ids.length === 0) return;

        const confirmText = `Delete ${ids.length} selected asset${ids.length > 1 ? 's' : ''}?`;
        if (!confirm(confirmText)) return;

        this.deleting.set(true);
        try {
            for (const id of ids) {
                await this.assetService.deleteAsset(id);
            }
            this.selectedIds.set(new Set());
            this.selectMode.set(false);
        } catch (err) {
            console.error('[Assets] Batch delete failed:', err);
        } finally {
            this.deleting.set(false);
        }
    }

    // ─── CRUD ────────────────────────────────────
    openAdd() {
        this.editingId.set(null);
        this.form.set({
            name: '', type: AssetType.Stock, quantity: 0, buyPrice: 0,
            currentPrice: 0, symbol: '', currency: 'INR', purchaseDate: new Date(), notes: '',
        });
        this.showModal.set(true);
    }

    openEdit(a: Asset) {
        this.editingId.set(a.id!);
        this.form.set({ ...a });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateForm(field: keyof Omit<Asset, 'id'>, value: any) {
        this.form.update((f) => ({ ...f, [field]: value }));
    }

    async save() {
        if (this.saving()) return;
        this.saving.set(true);
        try {
            const id = this.editingId();
            if (id) {
                await this.assetService.updateAsset(id, this.form());
            } else {
                await this.assetService.addAsset(this.form());
            }
            this.closeModal();
        } finally {
            this.saving.set(false);
        }
    }

    async delete(id: string) {
        if (confirm('Delete this asset?')) {
            await this.assetService.deleteAsset(id);
        }
    }

    async refreshMutualFunds() {
        if (this.refreshingMFs()) return;
        this.refreshingMFs.set(true);
        try {
            // Only refresh Mutual Funds
            const mfAssets = this.assets().filter(a => a.type === AssetType.MutualFund);

            if (mfAssets.length === 0) {
                this.ngZone.run(() => {
                    this.snackbar.show('No Mutual Funds to refresh.', 'info');
                    this.refreshingMFs.set(false);
                });
                return;
            }

            const result = await this.priceService.refreshAllPrices(mfAssets);

            this.ngZone.run(() => {
                this.lastRefreshed.set(new Date().toLocaleTimeString());

                if (result.failed > 0 && result.updated === 0 && result.unchanged === 0) {
                    this.snackbar.show(`Failed to fetch prices for all ${result.failed} mutual funds.`, 'error');
                } else if (result.failed > 0) {
                    this.snackbar.show(`Refreshed prices (Updated: ${result.updated}), but ${result.failed} funds failed.`, 'error');
                } else if (result.updated > 0) {
                    this.snackbar.show(`Successfully refreshed ${result.updated} mutual fund prices`, 'success');
                } else {
                    this.snackbar.show('Mutual Fund prices are up to date.', 'info');
                }

                this.refreshingMFs.set(false);
                this.cdr.markForCheck();
            });
        } catch (err) {
            console.error('[Assets] ML Price refresh failed:', err);
            this.ngZone.run(() => {
                this.snackbar.show('Failed to refresh Mutual Funds. Please try again later.', 'error');
                this.refreshingMFs.set(false);
                this.cdr.markForCheck();
            });
        }
    }

    async refreshStocks() {
        if (this.refreshingStocks()) return;
        this.refreshingStocks.set(true);
        try {
            // Only refresh Stocks and ETFs
            const stockAssets = this.assets().filter(a => [AssetType.Stock, AssetType.ETF].includes(a.type as AssetType));

            if (stockAssets.length === 0) {
                this.ngZone.run(() => {
                    this.snackbar.show('No Stocks/ETFs to refresh.', 'info');
                    this.refreshingStocks.set(false);
                });
                return;
            }

            const result = await this.priceService.refreshAllPrices(stockAssets);

            this.ngZone.run(() => {
                this.lastRefreshed.set(new Date().toLocaleTimeString());
                console.log(`Failed to fetch prices for all ${result.failed} stocks.`, result);
                if (result.failed > 0 && result.updated === 0 && result.unchanged === 0) {
                    this.snackbar.show(`Failed to fetch prices for all ${result.failed} stocks.`, 'error');

                } else if (result.failed > 0) {
                    this.snackbar.show(`Refreshed prices (Updated: ${result.updated}), but ${result.failed} stocks failed.`, 'error');
                } else if (result.updated > 0) {
                    this.snackbar.show(`Successfully refreshed ${result.updated} stock prices`, 'success');
                } else {
                    this.snackbar.show('Stock prices are up to date.', 'info');
                }

                this.refreshingStocks.set(false);
                this.cdr.markForCheck();
            });
        } catch (err) {
            console.error('[Assets] Stock Price refresh failed:', err);
            this.ngZone.run(() => {
                this.snackbar.show('Failed to refresh Stocks. Please try again later.', 'error');
                this.refreshingStocks.set(false);
                this.cdr.markForCheck();
            });
        }
    }

    // ─── Import ──────────────────────────────────
    openImport() {
        this.showImport.set(true);
    }

    onImportComplete(count: number) {
        this.showImport.set(false);
    }
}
