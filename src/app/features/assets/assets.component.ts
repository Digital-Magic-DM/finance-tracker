import { Component, inject, signal, computed, NgZone, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssetService } from '../../services/asset.service';
import { PriceService } from '../../services/price.service';
import { SnackbarService } from '../../services/snackbar.service';
import { Asset, AssetType, ASSET_COLORS } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from '../settings/import-data/import-data.component';
import { LocationPickerComponent } from '../../shared/location-picker/location-picker.component';

interface AssetGroup {
    type: AssetType;
    label: string;
    assets: Asset[];
    totalValue: number;
    totalInvested: number;
    totalGain: number;
    gainPct: number;
    allocation: number;
    color: string;
    expanded: boolean;
    lastUpdated?: string;
}

@Component({
    selector: 'app-assets',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule, ImportDataComponent, LocationPickerComponent],
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

    // Single expanded group tracking
    private expandedGroup = signal<string | null>(null);

    assetTypes = Object.values(AssetType);

    appFilter = signal<string>('All');

    availableApps = computed(() => {
        const apps = new Set<string>();
        for (const a of this.assets()) {
            const source = a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace('Imported from', '').trim() : 'Manual');
            apps.add(source);
        }
        return Array.from(apps).sort();
    });

    predefinedApps = ['Manual', 'Groww', 'Zerodha', 'IndMoney', 'Ethos', 'Kotak Cherry', 'Wint Wealth', 'Kuvera', 'AngelOne', 'Other'];
    showCustomApp = signal(false);

    // Stock Search
    stockExchange = signal<'NSE' | 'BSE'>('NSE');
    stockSearchQuery = signal<string>('');
    private nseData = signal<any[]>([]);
    private bseData = signal<any[]>([]);

    stockSuggestions = computed(() => {
        const query = this.stockSearchQuery().toUpperCase();
        if (query.length < 2) return [];

        const exchange = this.stockExchange();
        const data = exchange === 'NSE' ? this.nseData() : this.bseData();

        if (data.length === 0) {
            // Trigger load
            this.loadStockData(exchange);
            return [];
        }

        return data
            .filter(item => item.symbol.includes(query))
            .slice(0, 10);
    });

    private async loadStockData(exchange: 'NSE' | 'BSE') {
        try {
            if (exchange === 'NSE' && this.nseData().length === 0) {
                const data = await import('./nse_companies.json');
                this.nseData.set(data.default);
            } else if (exchange === 'BSE' && this.bseData().length === 0) {
                const data = await import('./bse_isin.json');
                this.bseData.set(data.default);
            }
        } catch (err) {
            console.error('Failed to load stock data:', err);
        }
    }

    onSelectStock(item: any) {
        // Remove the suffix for better display name if needed, or keep it
        this.updateForm('symbol', item.symbol);
        // Pre-fill name if it was symbol, or keep as is. User can edit name.
        if (!this.form().name) {
            this.updateForm('name', item.symbol.split('.')[0]);
        }
        this.stockSearchQuery.set('');
    }

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
        appSource: 'Manual',
        location: undefined
    });

    filteredAssets = computed(() => {
        const assets = this.assets();
        const filter = this.appFilter();
        if (filter === 'All') return assets;

        return assets.filter(a => {
            const source = a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace('Imported from', '').trim() : 'Manual');
            return source === filter;
        });
    });

    totalValue = computed(() =>
        this.filteredAssets().reduce((s, a) => s + a.quantity * a.currentPrice, 0)
    );

    assetGroups = computed(() => {
        const assets = this.filteredAssets();
        const expandedType = this.expandedGroup();
        const totalPortfolioValue = this.totalValue();
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
                const tValue = typeAssets.reduce((s, a) => s + a.quantity * a.currentPrice, 0);
                const tInvested = typeAssets.reduce((s, a) => s + (a.buyPrice * a.quantity), 0);
                const tGain = tValue - tInvested;
                const gPct = tInvested > 0 ? (tGain / tInvested) * 100 : 0;
                const allocation = totalPortfolioValue > 0 ? (tValue / totalPortfolioValue) * 100 : 0;
                
                // Find latest update time in group
                const latestUpdate = typeAssets
                    .filter(a => !!a.lastUpdated)
                    .map(a => a.lastUpdated!)
                    .sort().reverse()[0];

                groups.push({
                    type,
                    label: this.getTypeLabel(type),
                    assets: typeAssets,
                    totalValue: tValue,
                    totalInvested: tInvested,
                    totalGain: tGain,
                    gainPct: gPct,
                    allocation,
                    color: ASSET_COLORS[type],
                    expanded: expandedType === type,
                    lastUpdated: latestUpdate
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

    getIconForType(type: AssetType): string {
        const icons: Record<AssetType, string> = {
            [AssetType.MutualFund]: 'pie_chart',
            [AssetType.Stock]: 'trending_up',
            [AssetType.ETF]: 'stacked_line_chart',
            [AssetType.Gold]: 'workspace_premium',
            [AssetType.Crypto]: 'currency_bitcoin',
            [AssetType.RealEstate]: 'home_work',
            [AssetType.Cash]: 'account_balance_wallet',
            [AssetType.Other]: 'category',
        };
        return icons[type] || 'category';
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
        if (this.expandedGroup() === type) {
            this.expandedGroup.set(null);
        } else {
            this.expandedGroup.set(type);
        }
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
        this.showCustomApp.set(false);
        this.form.set({
            name: '', type: AssetType.Stock, quantity: 0, buyPrice: 0,
            currentPrice: 0, symbol: '', currency: 'INR', purchaseDate: new Date(), notes: '',
            appSource: 'Manual',
            location: undefined
        });
        this.showModal.set(true);
    }

    openEdit(a: Asset) {
        this.editingId.set(a.id!);
        const source = a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace('Imported from', '').trim() : 'Manual');
        const isCustom = !!(source && !this.predefinedApps.filter(p => p !== 'Other').includes(source));
        this.showCustomApp.set(isCustom);
        this.form.set({ ...a, appSource: source });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateForm(field: keyof Omit<Asset, 'id'>, value: any) {
        this.form.update((f) => {
            const next = { ...f, [field]: value };
            
            // Clear irrelevant fields when type changes
            if (field === 'type') {
                const type = value as AssetType;
                if (type === AssetType.Cash || type === AssetType.RealEstate) {
                    next.symbol = '';
                    next.appSource = 'Manual';
                }
                if (type !== AssetType.RealEstate) {
                    next.location = undefined;
                }
            }
            return next;
        });
    }

    updateAppSource(val: string) {
        if (val === 'Other') {
            this.showCustomApp.set(true);
            this.updateForm('appSource', '');
        } else {
            this.showCustomApp.set(false);
            this.updateForm('appSource', val);
        }
    }

    async save() {
        if (this.saving()) return;
        
        const data = this.form();
        // Validation
        if (!data.name.trim()) {
            this.snackbar.show('Asset name is required', 'error');
            return;
        }
        if (data.quantity <= 0) {
            this.snackbar.show('Quantity must be greater than 0', 'error');
            return;
        }
        if (data.buyPrice < 0 || data.currentPrice < 0) {
            this.snackbar.show('Prices cannot be negative', 'error');
            return;
        }

            this.saving.set(true);
        try {
            const id = this.editingId();
            
            // Clean data: Firestore doesn't like 'undefined' values
            const cleanData: any = { ...data };
            if (cleanData.location === undefined) delete cleanData.location;
            if (!cleanData.notes) delete cleanData.notes;
            if (!cleanData.symbol) delete cleanData.symbol;
            if (!cleanData.appSource) delete cleanData.appSource;

            if (id) {
                await this.assetService.updateAsset(id, cleanData);
                this.snackbar.show('Asset updated successfully', 'success');
            } else {
                await this.assetService.addAsset(cleanData);
                this.snackbar.show('Asset added successfully', 'success');
            }
            this.closeModal();
            this.cdr.markForCheck();
        } catch (err: any) {
            console.error('[Assets] Save failed:', err);
            this.snackbar.show(err.message || 'Failed to save asset. Please try again.', 'error');
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
        void count;
        this.showImport.set(false);
    }
}
