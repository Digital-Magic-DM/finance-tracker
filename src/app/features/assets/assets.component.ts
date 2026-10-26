import { Component, inject, signal, computed, NgZone, ChangeDetectorRef, OnInit, HostListener } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssetService } from '../../services/asset.service';
import { PriceService } from '../../services/price.service';
import { GoogleFinanceService } from '../../services/google-finance.service';
import { SnackbarService } from '../../services/snackbar.service';
import { TickerRegistryService } from '../../services/ticker-registry.service';
import { BondLookupService } from '../../services/bond-lookup.service';
import { Asset, AssetType, ASSET_COLORS } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from '../settings/import-data/import-data.component';
import { LocationPickerComponent } from '../../shared/location-picker/location-picker.component';
import { CustomSelectDirective } from '../../shared/directives/custom-select.directive';

interface AssetGroup {
    type: string;
    label: string;
    assets: Asset[];
    totalValue: number;
    totalInvested: number;
    totalGain: number;
    gainPct: number;
    allocation: number;
    color: string;
    expanded: boolean;
    currency: 'INR' | 'USD';
    totalValueINR?: number;
    totalInvestedINR?: number;
    lastUpdated?: string;
}

@Component({
    selector: 'app-assets',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, FormsModule, ImportDataComponent, LocationPickerComponent, CustomSelectDirective],
    templateUrl: './assets.component.html',
    styleUrl: './assets.component.scss',
})
export class AssetsComponent implements OnInit {
    private assetService = inject(AssetService);
    private priceService = inject(PriceService);
    public googleFinance = inject(GoogleFinanceService);
    private tickerRegistry = inject(TickerRegistryService);
    private bondLookupService = inject(BondLookupService);
    private snackbar = inject(SnackbarService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    ngOnInit() {
        // Fetch live USD to INR exchange rate on component initialization
        this.googleFinance.fetchUsdInrRate().catch(() => { });
    }

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    showModal = signal(false);
    showImport = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    refreshingMFs = signal(false);
    refreshingStocks = signal(false);
    refreshingAssetId = signal<Set<string>>(new Set());
    lastRefreshed = signal<string>('');

    // Multi-select state
    selectMode = signal(false);
    selectedIds = signal<Set<string>>(new Set());
    deleting = signal(false);
    showDeleteModal = signal(false);
    assetsPendingDeletion = signal<Asset[]>([]);

    deleteTotalInvested = computed(() => {
        return this.assetsPendingDeletion().reduce(
            (sum, a) => sum + (a.buyPrice * a.quantity * this.getFxRate(a)),
            0
        );
    });

    deleteTotalValue = computed(() => {
        return this.assetsPendingDeletion().reduce(
            (sum, a) => sum + (this.getAssetValue(a) * this.getFxRate(a)),
            0
        );
    });

    // View mode: 'cards' (broker holding cards) or 'table' (accordion table)
    viewMode = signal<'cards' | 'table'>((localStorage.getItem('assetsViewMode') as 'cards' | 'table') || 'cards');

    // Single expanded group tracking
    private expandedGroup = signal<string | null>(null);

    assetTypes = Object.values(AssetType);
    AssetType = AssetType;

    showAddDropdown = signal(false);

    toggleAddDropdown(event?: Event) {
        if (event) event.stopPropagation();
        this.showAddDropdown.update(v => !v);
    }

    @HostListener('document:click')
    closeAddDropdown() {
        this.showAddDropdown.set(false);
    }

    // Top horizontal tabs & filters
    selectedCategory = signal<string>('Overview');
    subFilter = signal<'all' | 'investments' | 'gainers' | 'losers'>('all');
    searchQuery = signal<string>('');
    hideAmounts = signal<boolean>(localStorage.getItem('hideAssetAmounts') === 'true');
    appFilter = signal<string>('All');

    // Sorting state: 'value' | 'invested' | 'gain' | 'gainPct' | 'name' | 'quantity'
    sortField = signal<'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct'>('value');
    sortDirection = signal<'asc' | 'desc'>('desc');

    toggleSort(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct') {
        if (this.sortField() === field) {
            this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            this.sortField.set(field);
            this.sortDirection.set(field === 'name' ? 'asc' : 'desc');
        }
    }

    setSortField(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct') {
        this.sortField.set(field);
    }

    toggleSortDirection() {
        this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    }

    getSortIcon(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct'): string {
        if (this.sortField() !== field) return 'unfold_more';
        return this.sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward';
    }

    sortAssetList(list: Asset[]): Asset[] {
        const field = this.sortField();
        const dir = this.sortDirection() === 'asc' ? 1 : -1;

        return [...list].sort((a, b) => {
            let diff = 0;
            switch (field) {
                case 'name':
                    diff = (a.name || '').localeCompare(b.name || '');
                    break;
                case 'quantity':
                    diff = (a.quantity || 0) - (b.quantity || 0);
                    break;
                case 'invested': {
                    const invA = (a.buyPrice || 0) * (a.quantity || 0) * this.getFxRate(a);
                    const invB = (b.buyPrice || 0) * (b.quantity || 0) * this.getFxRate(b);
                    diff = invA - invB;
                    break;
                }
                case 'value': {
                    const valA = this.getAssetValue(a) * this.getFxRate(a);
                    const valB = this.getAssetValue(b) * this.getFxRate(b);
                    diff = valA - valB;
                    break;
                }
                case 'gain': {
                    const gainA = this.getGain(a) * this.getFxRate(a);
                    const gainB = this.getGain(b) * this.getFxRate(b);
                    diff = gainA - gainB;
                    break;
                }
                case 'gainPct': {
                    diff = this.getGainPct(a) - this.getGainPct(b);
                    break;
                }
            }
            return diff * dir;
        });
    }

    getAssetApp(a: Asset): string {
        const raw = (a.appSource || (a.notes?.includes('Imported from') ? a.notes.replace(/^Imported from\s*/i, '').trim() : '')).trim();
        if (!raw) return 'Manual';
        if (/indmoney|indstocks/i.test(raw)) return 'INDmoney';
        if (/groww/i.test(raw)) return 'Groww';
        if (/zerodha/i.test(raw)) return 'Zerodha';
        if (/cdsl|nsdl/i.test(raw)) return 'CDSL / NSDL';
        if (/csv/i.test(raw)) return 'CSV Import';

        // Strip trailing PDF Statement or (ISIN: ...)
        const clean = raw.replace(/\s*(pdf\s*statement|statement|\(isin:[^)]*\)|isin:[^\s)]*).*/gi, '').trim();
        return clean || 'Imported';
    }

    availableApps = computed(() => {
        const apps = new Set<string>();
        for (const a of this.assets()) {
            apps.add(this.getAssetApp(a));
        }
        return Array.from(apps).sort();
    });

    predefinedApps = ['Manual', 'Groww', 'Zerodha', 'INDmoney', 'Ethos', 'Kotak Cherry', 'Wint Wealth', 'Kuvera', 'AngelOne', 'Other'];
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
                const data = await this.tickerRegistry.getNseData();
                this.nseData.set(data);
            } else if (exchange === 'BSE' && this.bseData().length === 0) {
                const data = await this.tickerRegistry.getBseData();
                this.bseData.set(data);
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
        location: undefined,
        interestRate: undefined,
        maturityDate: undefined,
        subType: undefined,
        isLiquid: true
    });

    toggleHideAmounts() {
        this.hideAmounts.update(v => {
            const next = !v;
            localStorage.setItem('hideAssetAmounts', String(next));
            return next;
        });
    }

    toggleViewMode() {
        this.viewMode.update(v => {
            const next = v === 'cards' ? 'table' : 'cards';
            localStorage.setItem('assetsViewMode', next);
            return next;
        });
    }


    // Market Region Filter: 'all' | 'ind' | 'us'
    selectedMarket = signal<'all' | 'ind' | 'us'>('all');

    isUSAsset(a: Asset): boolean {
        return this.priceService.isUSAsset(a);
    }

    isIndianAsset(a: Asset): boolean {
        return !this.isUSAsset(a);
    }

    allIndAssets = computed(() => this.assets().filter(a => this.isIndianAsset(a)));
    allUsAssets = computed(() => this.assets().filter(a => this.isUSAsset(a)));
    hasBothMarkets = computed(() => this.allIndAssets().length > 0 && this.allUsAssets().length > 0);

    categories = computed(() => {
        const assets = this.selectedMarket() === 'ind'
            ? this.allIndAssets()
            : (this.selectedMarket() === 'us' ? this.allUsAssets() : this.assets());

        const counts = new Map<string, number>();
        let hasUS = false;
        let hasIndStock = false;

        for (const a of assets) {
            if (this.isUSAsset(a)) {
                hasUS = true;
                counts.set('US Stocks', (counts.get('US Stocks') || 0) + 1);
            } else if (a.type === AssetType.Stock) {
                hasIndStock = true;
                counts.set('Indian Stocks', (counts.get('Indian Stocks') || 0) + 1);
            } else {
                const t = this.getTypeLabel(a.type || AssetType.Other);
                counts.set(t, (counts.get(t) || 0) + 1);
            }
        }

        const list = [{ label: 'Overview', count: assets.length, key: 'Overview' }];

        if (hasIndStock) {
            list.push({ label: 'Indian Stocks', count: counts.get('Indian Stocks')!, key: 'Indian Stocks' });
        }
        if (hasUS) {
            list.push({ label: 'US Stocks', count: counts.get('US Stocks')!, key: 'US Stocks' });
        }

        const standardOrder = ['Mutual Funds', 'Fixed Deposits', 'Bonds', 'ETFs', 'Gold', 'Crypto', 'Real Estate', 'Cash', 'Other'];
        for (const cat of standardOrder) {
            if (counts.has(cat) && counts.get(cat)! > 0) {
                list.push({ label: cat, count: counts.get(cat)!, key: cat });
            }
        }
        return list;
    });

    filteredAssets = computed(() => {
        let list = this.assets();

        // 1. Market Region Filter
        const market = this.selectedMarket();
        if (market === 'ind') {
            list = list.filter(a => this.isIndianAsset(a));
        } else if (market === 'us') {
            list = list.filter(a => this.isUSAsset(a));
        }

        // 2. App Filter
        const app = this.appFilter();
        if (app !== 'All') {
            list = list.filter(a => this.getAssetApp(a) === app);
        }

        // 3. Category Tab
        const cat = this.selectedCategory();
        if (cat === 'Indian Stocks') {
            list = list.filter(a => this.isIndianAsset(a) && a.type === AssetType.Stock);
        } else if (cat === 'US Stocks') {
            list = list.filter(a => this.isUSAsset(a));
        } else if (cat !== 'Overview') {
            list = list.filter(a => this.getTypeLabel(a.type || AssetType.Other) === cat);
        }

        // 4. Search Query
        const q = this.searchQuery().trim().toLowerCase();
        if (q) {
            list = list.filter(a =>
                (a.name && a.name.toLowerCase().includes(q)) ||
                (a.symbol && a.symbol.toLowerCase().includes(q)) ||
                (a.notes && a.notes.toLowerCase().includes(q))
            );
        }

        // 5. Sub-filter
        const sub = this.subFilter();
        if (sub === 'gainers') {
            list = list.filter(a => this.getGain(a) > 0);
        } else if (sub === 'losers') {
            list = list.filter(a => this.getGain(a) < 0);
        }

        return this.sortAssetList(list);
    });

    // Market Sub-collections for Sections
    filteredIndAssets = computed(() => this.filteredAssets().filter(a => this.isIndianAsset(a)));
    filteredUsAssets = computed(() => this.filteredAssets().filter(a => this.isUSAsset(a)));

    // Subtotals for IND section
    indTotalInvested = computed(() =>
        this.filteredIndAssets().reduce((s, a) => s + (a.buyPrice * a.quantity), 0)
    );
    indTotalValue = computed(() =>
        this.filteredIndAssets().reduce((s, a) => s + ((a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0)) * a.quantity), 0)
    );
    indTotalGain = computed(() => this.indTotalValue() - this.indTotalInvested());

    // Subtotals for US section
    usTotalInvestedUSD = computed(() =>
        this.filteredUsAssets().reduce((s, a) => s + (a.buyPrice * a.quantity), 0)
    );
    usTotalValueUSD = computed(() =>
        this.filteredUsAssets().reduce((s, a) => s + ((a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0)) * a.quantity), 0)
    );
    usTotalGainUSD = computed(() => this.usTotalValueUSD() - this.usTotalInvestedUSD());
    usTotalGainPct = computed(() => {
        const inv = this.usTotalInvestedUSD();
        return inv > 0 ? (this.usTotalGainUSD() / inv) * 100 : 0;
    });
    indTotalGainPct = computed(() => {
        const inv = this.indTotalInvested();
        return inv > 0 ? (this.indTotalGain() / inv) * 100 : 0;
    });
    usTotalValueINR = computed(() => this.usTotalValueUSD() * this.USD_TO_INR);
    usTotalInvestedINR = computed(() => this.usTotalInvestedUSD() * this.USD_TO_INR);

    // FX conversion for multi-currency portfolio aggregate (Live from Google Finance / Open Exchange)
    usdToInrRate = computed(() => this.googleFinance.usdToInrRate());
    get USD_TO_INR(): number {
        return this.usdToInrRate();
    }

    getAssetCurrency(a: Asset): 'USD' | 'INR' {
        return this.isUSAsset(a) ? 'USD' : 'INR';
    }

    getFxRate(a: Asset): number {
        return this.isUSAsset(a) ? this.USD_TO_INR : 1;
    }

    isViewingUS = computed(() => {
        return this.selectedMarket() === 'us' || this.selectedCategory() === 'US Stocks';
    });

    usTotalDaysGainUSD = computed(() => {
        return this.filteredUsAssets().reduce((s, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : 0;
            const pct = (a.dailyChange || 0) / 100;
            return s + (cp * pct * a.quantity);
        }, 0);
    });

    usTotalDaysGainPct = computed(() => {
        const val = this.usTotalValueUSD();
        return val > 0 ? (this.usTotalDaysGainUSD() / val) * 100 : 0;
    });

    onSelectMarket(market: 'all' | 'ind' | 'us') {
        this.selectedMarket.set(market);
        if (market === 'us') {
            this.selectedCategory.set('US Stocks');
        } else if (market === 'ind' && this.selectedCategory() === 'US Stocks') {
            this.selectedCategory.set('Indian Stocks');
        } else if (market === 'all' && this.selectedCategory() === 'US Stocks') {
            this.selectedCategory.set('Overview');
        }
    }

    onSelectCategory(catKey: string) {
        this.selectedCategory.set(catKey);
        if (catKey === 'US Stocks') {
            this.selectedMarket.set('us');
        } else if (catKey === 'Indian Stocks' && this.selectedMarket() === 'us') {
            this.selectedMarket.set('ind');
        } else if (catKey === 'Overview' && this.selectedMarket() === 'us') {
            this.selectedMarket.set('all');
        }
    }

    totalValue = computed(() =>
        this.filteredAssets().reduce((s, a) => s + (a.quantity * (a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0)) * this.getFxRate(a)), 0)
    );

    totalInvested = computed(() =>
        this.filteredAssets().reduce((s, a) => s + (a.buyPrice * a.quantity * this.getFxRate(a)), 0)
    );

    totalOverallGain = computed(() =>
        this.totalValue() - this.totalInvested()
    );

    totalOverallGainPct = computed(() => {
        const inv = this.totalInvested();
        return inv > 0 ? (this.totalOverallGain() / inv) * 100 : 0;
    });

    totalDaysGain = computed(() => {
        return this.filteredAssets().reduce((s, a) => {
            const cp = a.currentPrice > 0 ? a.currentPrice : 0;
            const pct = (a.dailyChange || 0) / 100;
            const daily = cp * pct * a.quantity * this.getFxRate(a);
            return s + daily;
        }, 0);
    });

    totalDaysGainPct = computed(() => {
        const val = this.totalValue();
        return val > 0 ? (this.totalDaysGain() / val) * 100 : 0;
    });

    refreshAllPrices(forceMF = false) {
        const stocks = this.assets().filter(a => a.type === AssetType.Stock || a.type === AssetType.ETF);
        if (stocks.length > 0) this.refreshStocks(stocks);
        const mfs = this.assets().filter(a => a.type === AssetType.MutualFund);
        if (mfs.length > 0) this.refreshMutualFunds(forceMF);
    }

    assetGroups = computed(() => {
        const assets = this.filteredAssets();
        const expandedType = this.expandedGroup();
        const totalPortfolioValue = this.totalValue();
        const usdRate = this.USD_TO_INR;

        // Separate US Stocks from Indian/other assets
        const usStocks = assets.filter(a => this.isUSAsset(a));
        const indAssets = assets.filter(a => !this.isUSAsset(a));

        const groupMap = new Map<AssetType, Asset[]>();

        // Collect non-US assets into type groups
        for (const asset of indAssets) {
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
            AssetType.FixedDeposit,
            AssetType.Bond,
            AssetType.ETF,
            AssetType.Gold,
            AssetType.Crypto,
            AssetType.RealEstate,
            AssetType.Cash,
            AssetType.Other,
        ];

        const groups: AssetGroup[] = [];

        // 1. If US Stocks exist, create dedicated US Stocks group
        if (usStocks.length > 0) {
            const tValue = usStocks.reduce((s, a) => s + a.quantity * (a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0)), 0);
            const tInvested = usStocks.reduce((s, a) => s + (a.buyPrice * a.quantity), 0);
            const tGain = tValue - tInvested;
            const gPct = tInvested > 0 ? (tGain / tInvested) * 100 : 0;
            const tValueINR = tValue * usdRate;
            const tInvestedINR = tInvested * usdRate;
            const allocation = totalPortfolioValue > 0 ? (tValueINR / totalPortfolioValue) * 100 : 0;

            const latestUpdate = usStocks
                .filter(a => !!a.lastUpdated)
                .map(a => a.lastUpdated!)
                .sort().reverse()[0];

            groups.push({
                type: 'USStock',
                label: 'US Stocks',
                assets: usStocks,
                totalValue: tValue,
                totalInvested: tInvested,
                totalGain: tGain,
                gainPct: gPct,
                allocation,
                color: this.getColor(AssetType.USStock),
                expanded: expandedType === 'USStock',
                currency: 'USD',
                totalValueINR: tValueINR,
                totalInvestedINR: tInvestedINR,
                lastUpdated: latestUpdate
            });
        }

        // 2. Add Indian & other asset groups
        for (const type of typeOrder) {
            const typeAssets = groupMap.get(type);
            if (typeAssets && typeAssets.length > 0) {
                const tValue = typeAssets.reduce((s, a) => s + a.quantity * (a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0)), 0);
                const tInvested = typeAssets.reduce((s, a) => s + (a.buyPrice * a.quantity), 0);
                const tGain = tValue - tInvested;
                const gPct = tInvested > 0 ? (tGain / tInvested) * 100 : 0;
                const allocation = totalPortfolioValue > 0 ? (tValue / totalPortfolioValue) * 100 : 0;

                // Find latest update time in group
                const latestUpdate = typeAssets
                    .filter(a => !!a.lastUpdated)
                    .map(a => a.lastUpdated!)
                    .sort().reverse()[0];

                const label = type === AssetType.Stock && usStocks.length > 0
                    ? 'Indian Stocks'
                    : this.getTypeLabel(type);

                groups.push({
                    type,
                    label,
                    assets: this.sortAssetList(typeAssets),
                    totalValue: tValue,
                    totalInvested: tInvested,
                    totalGain: tGain,
                    gainPct: gPct,
                    allocation,
                    color: ASSET_COLORS[type],
                    expanded: expandedType === type,
                    currency: 'INR',
                    totalValueINR: tValue,
                    totalInvestedINR: tInvested,
                    lastUpdated: latestUpdate
                });
            }
        }

        // Sort groups according to active sort criteria
        const field = this.sortField();
        const dir = this.sortDirection() === 'asc' ? 1 : -1;
        groups.sort((a, b) => {
            let diff = 0;
            switch (field) {
                case 'name':
                    diff = a.label.localeCompare(b.label);
                    break;
                case 'quantity':
                    diff = a.assets.length - b.assets.length;
                    break;
                case 'invested':
                    diff = (a.totalInvestedINR || a.totalInvested) - (b.totalInvestedINR || b.totalInvested);
                    break;
                case 'value':
                    diff = (a.totalValueINR || a.totalValue) - (b.totalValueINR || b.totalValue);
                    break;
                case 'gain':
                    diff = a.totalGain - b.totalGain;
                    break;
                case 'gainPct':
                    diff = a.gainPct - b.gainPct;
                    break;
            }
            return diff * dir;
        });

        return groups;
    });

    selectedCount = computed(() => this.selectedIds().size);

    getTypeLabel(type: AssetType | string): string {
        const labels: Record<string, string> = {
            [AssetType.Stock]: 'Indian Stocks',
            [AssetType.USStock]: 'US Stocks',
            [AssetType.MutualFund]: 'Mutual Funds',
            [AssetType.FixedDeposit]: 'Fixed Deposits',
            [AssetType.Bond]: 'Bonds',
            [AssetType.ETF]: 'ETFs',
            [AssetType.Gold]: 'Gold',
            [AssetType.Crypto]: 'Crypto',
            [AssetType.RealEstate]: 'Real Estate',
            [AssetType.Cash]: 'Cash',
            [AssetType.Other]: 'Other'
        };
        return labels[type as string] || type;
    }

    getIconForType(type: string): string {
        if (type === 'USStock' || type === AssetType.USStock) return 'language';
        if (type === 'FixedDeposit' || type === AssetType.FixedDeposit) return 'savings';
        const icons: Record<string, string> = {
            [AssetType.MutualFund]: 'pie_chart',
            [AssetType.Stock]: 'trending_up',
            [AssetType.USStock]: 'language',
            [AssetType.FixedDeposit]: 'savings',
            [AssetType.Bond]: 'receipt_long',
            [AssetType.ETF]: 'stacked_line_chart',
            [AssetType.Gold]: 'workspace_premium',
            [AssetType.Crypto]: 'currency_bitcoin',
            [AssetType.RealEstate]: 'home_work',
            [AssetType.Cash]: 'account_balance_wallet',
            [AssetType.Other]: 'category',
        };
        return icons[type] || 'category';
    }

    isNonMarketAsset(a: Asset): boolean {
        return a.type === AssetType.Cash || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit;
    }

    getGain(a: Asset) {
        if (!a.currentPrice || a.currentPrice <= 0) return 0;
        return (a.currentPrice - a.buyPrice) * a.quantity;
    }

    getGainPct(a: Asset) {
        if (!a.currentPrice || a.currentPrice <= 0 || !a.buyPrice || a.buyPrice === 0) return 0;
        return ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100;
    }

    getAssetValue(a: Asset) {
        const cp = a.currentPrice > 0 ? a.currentPrice : (this.isNonMarketAsset(a) ? a.buyPrice : 0);
        return a.quantity * cp;
    }

    getColor(type: AssetType | string) {
        if (type === 'USStock' || type === AssetType.USStock) return 'var(--asset-us-stock)';
        if (type === 'FixedDeposit' || type === AssetType.FixedDeposit) return 'var(--asset-fd)';
        if (type === AssetType.Bond) return 'var(--asset-bond)';
        return ASSET_COLORS[type as AssetType] || '#64748b';
    }

    // ─── Group collapse/expand ───────────────────
    toggleGroup(type: string | AssetType) {
        if (this.expandedGroup() === type) {
            this.expandedGroup.set(null);
        } else {
            this.expandedGroup.set(type);
        }
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
        const visibleIds = this.filteredAssets().filter(a => a.id).map(a => a.id!);
        this.selectedIds.set(new Set(visibleIds));
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

    deleteSelected() {
        const ids = this.selectedIds();
        if (ids.size === 0) return;

        const toDelete = this.assets().filter(a => a.id && ids.has(a.id));
        if (toDelete.length === 0) return;

        this.assetsPendingDeletion.set(toDelete);
        this.showDeleteModal.set(true);
    }

    closeDeleteModal() {
        if (this.deleting()) return;
        this.showDeleteModal.set(false);
        this.assetsPendingDeletion.set([]);
    }

    async confirmDelete() {
        const toDelete = this.assetsPendingDeletion();
        const ids = toDelete.map(a => a.id!).filter(Boolean);
        if (ids.length === 0) {
            this.closeDeleteModal();
            return;
        }

        this.deleting.set(true);
        try {
            await this.assetService.batchDeleteAssets(ids);

            // Remove deleted IDs from current selection
            this.selectedIds.update(set => {
                const next = new Set(set);
                for (const id of ids) {
                    next.delete(id);
                }
                return next;
            });

            if (this.selectedIds().size === 0) {
                this.selectMode.set(false);
            }

            this.snackbar.show(
                `Successfully deleted ${ids.length} holding${ids.length > 1 ? 's' : ''}`,
                'success'
            );
            this.closeDeleteModal();
        } catch (err: any) {
            console.error('[Assets] Batch delete failed:', err);
            this.snackbar.show('Failed to delete holdings. Please try again.', 'error');
        } finally {
            this.deleting.set(false);
        }
    }

    // ─── CRUD ────────────────────────────────────
    openAdd(type?: AssetType, currency?: string) {
        this.editingId.set(null);
        this.showCustomApp.set(false);
        this.showAddDropdown.set(false);
        let selectedType = type;
        if (!selectedType) {
            const catMap: Record<string, AssetType> = {
                'Indian Stocks': AssetType.Stock,
                'US Stocks': AssetType.USStock,
                'Mutual Funds': AssetType.MutualFund,
                'Fixed Deposits': AssetType.FixedDeposit,
                'Bonds': AssetType.Bond,
                'ETFs': AssetType.ETF,
                'Gold': AssetType.Gold,
                'Crypto': AssetType.Crypto,
                'Real Estate': AssetType.RealEstate,
                'Cash': AssetType.Cash,
                'Other': AssetType.Other,
            };
            const currentCat = this.selectedCategory();
            if (currentCat && catMap[currentCat]) {
                selectedType = catMap[currentCat];
            } else if (this.selectedMarket() === 'us') {
                selectedType = AssetType.USStock;
            } else {
                selectedType = AssetType.Stock;
            }
        }
        const defaultCurrency = currency || ((selectedType === AssetType.USStock || selectedType === AssetType.Crypto || this.isViewingUS()) ? 'USD' : 'INR');
        const defaultQty = (selectedType === AssetType.FixedDeposit || selectedType === AssetType.RealEstate || selectedType === AssetType.Cash) ? 1 : (selectedType === AssetType.Bond ? 1 : 0);
        const defaultSubType = selectedType === AssetType.Bond ? 'Corporate Bond' : (selectedType === AssetType.FixedDeposit ? 'Bank FD' : undefined);
        const defaultBuyPrice = selectedType === AssetType.Bond ? 1000 : 0;
        this.form.set({
            name: '',
            type: selectedType,
            quantity: defaultQty,
            buyPrice: defaultBuyPrice,
            currentPrice: defaultBuyPrice,
            symbol: '',
            currency: defaultCurrency,
            purchaseDate: new Date(),
            notes: '',
            appSource: 'Manual',
            location: undefined,
            interestRate: selectedType === AssetType.FixedDeposit ? 7.0 : (selectedType === AssetType.Bond ? 8.5 : undefined),
            maturityDate: undefined,
            subType: defaultSubType,
            payoutFrequency: selectedType === AssetType.Bond ? 'Annual' : undefined,
            payoutDates: undefined,
            isLiquid: selectedType !== AssetType.RealEstate
        });
        this.showModal.set(true);
    }

    exportPortfolio() {
        const asts = this.assets();
        if (asts.length === 0) {
            this.snackbar.show('No assets to export', 'info');
            return;
        }
        const rows = [
            ['Name', 'Symbol', 'Type', 'Quantity', 'Buy Price', 'Current Price', 'Currency', 'App Source', 'Notes'],
            ...asts.map((a: any) => [
                `"${(a.name || '').replace(/"/g, '""')}"`,
                `"${(a.symbol || '').replace(/"/g, '""')}"`,
                a.type || '',
                a.quantity.toString(),
                a.buyPrice.toString(),
                (a.currentPrice || 0).toString(),
                a.currency || 'INR',
                `"${(this.getAssetApp(a) || '').replace(/"/g, '""')}"`,
                `"${(a.notes || '').replace(/"/g, '""')}"`
            ]),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `portfolio_export_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        this.snackbar.show(`Exported ${asts.length} holdings to CSV`, 'success');
    }

    openEdit(a: Asset) {
        this.editingId.set(a.id!);
        const isUS = this.isUSAsset(a);
        const source = this.getAssetApp(a);
        const isCustom = !!(source && !this.predefinedApps.filter(p => p !== 'Other').includes(source));
        this.showCustomApp.set(isCustom);
        const isBond = a.type === AssetType.Bond;
        const payoutFreq = a.payoutFrequency || (isBond ? (a.subType === 'Govt Bond (G-Sec)' ? 'Semi-Annual' : 'Annual') : undefined);
        const payoutDates = a.payoutDates || (isBond && a.maturityDate ? this.bondLookupService.calculatePayoutDates(a.maturityDate, payoutFreq) : undefined);

        this.form.set({
            ...a,
            currency: isUS ? 'USD' : (a.currency || 'INR'),
            appSource: source,
            payoutFrequency: payoutFreq,
            payoutDates: payoutDates,
        });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateForm(field: keyof Omit<Asset, 'id'>, value: any) {
        this.form.update((f) => {
            const next = { ...f, [field]: value };

            // Clear irrelevant fields when type changes
            if (field === 'type') {
                const type = value as AssetType;
                if (type === AssetType.USStock || type === AssetType.Crypto) {
                    next.currency = 'USD';
                } else if (!this.editingId()) {
                    next.currency = 'INR';
                }
                if (type === AssetType.Cash || type === AssetType.RealEstate || type === AssetType.FixedDeposit) {
                    next.symbol = '';
                }
                if (type === AssetType.Cash || type === AssetType.RealEstate) {
                    next.appSource = 'Manual';
                }
                if (type !== AssetType.RealEstate) {
                    next.location = undefined;
                }
                if (type === AssetType.FixedDeposit) {
                    if (!next.quantity || next.quantity <= 0) next.quantity = 1;
                    if (next.interestRate === undefined) next.interestRate = 7.0;
                    if (!next.subType) next.subType = 'Bank FD';
                    next.isLiquid = true;
                }
                if (type === AssetType.Bond) {
                    if (!next.quantity || next.quantity <= 0) next.quantity = 1;
                    if (!next.subType) next.subType = 'Corporate Bond';
                    if (next.interestRate === undefined) next.interestRate = 8.5;
                    if (!next.buyPrice) next.buyPrice = 1000;
                    if (!next.currentPrice) next.currentPrice = 1000;
                    if (!next.payoutFrequency) next.payoutFrequency = 'Annual';
                }
            }

            // Smart reactive bond adjustments
            if (next.type === AssetType.Bond) {
                if (field === 'subType') {
                    if (value === 'Govt Bond (G-Sec)') {
                        if (next.buyPrice === 1000 || next.buyPrice === 0) {
                            next.buyPrice = 100;
                            next.currentPrice = 100;
                        }
                        if (next.interestRate === 8.5) next.interestRate = 7.18;
                        next.payoutFrequency = 'Semi-Annual';
                    } else if (value === 'Corporate Bond' || value === 'Tax-Free Bond') {
                        if (next.buyPrice === 100 || next.buyPrice === 0) {
                            next.buyPrice = 1000;
                            next.currentPrice = 1000;
                        }
                        next.payoutFrequency = 'Annual';
                    } else if (value === 'Sovereign Gold Bond (SGB)') {
                        next.payoutFrequency = 'Semi-Annual';
                        if (next.interestRate === 8.5) next.interestRate = 2.5;
                    }
                    next.payoutDates = this.bondLookupService.calculatePayoutDates(next.maturityDate, next.payoutFrequency);
                }

                // If user changes buy price on bond, automatically keep current price synced unless customized
                if (field === 'buyPrice' && (!next.currentPrice || next.currentPrice === f.buyPrice)) {
                    next.currentPrice = value;
                }

                // If user updates maturity date or payout frequency, recalculate payout schedule dates automatically
                if (field === 'maturityDate' || field === 'payoutFrequency') {
                    next.payoutDates = this.bondLookupService.calculatePayoutDates(next.maturityDate, next.payoutFrequency);
                }
            }

            return next;
        });
    }

    fetchingBond = signal(false);

    async fetchBondDetails() {
        const isin = (this.form().symbol || '').trim().toUpperCase();
        if (!isin) {
            this.snackbar.show('Please enter a Bond ISIN to fetch details', 'info');
            return;
        }
        if (!this.bondLookupService.isValidISIN(isin)) {
            this.snackbar.show('Invalid ISIN format. Must be 12 characters (e.g. IN0020230085 or INE001A07SD3)', 'error');
            return;
        }

        this.fetchingBond.set(true);
        try {
            const details = await this.bondLookupService.fetchBondDetails(isin);
            if (details) {
                this.form.update(f => {
                    const nextBuyPrice = f.buyPrice > 0 && f.buyPrice !== 1000 ? f.buyPrice : details.defaultBuyPrice;
                    const nextCurrentPrice = f.currentPrice > 0 && f.currentPrice !== 1000 ? f.currentPrice : (f.buyPrice > 0 && f.buyPrice !== 1000 ? f.buyPrice : details.defaultCurrentPrice);
                    const nextQty = f.quantity > 0 ? f.quantity : (details.subType === 'Govt Bond (G-Sec)' ? 100 : 1);

                    return {
                        ...f,
                        name: f.name.trim() && f.name !== 'Unnamed Asset' ? f.name : details.name,
                        symbol: details.isin,
                        subType: details.subType || f.subType,
                        interestRate: details.interestRate !== undefined ? details.interestRate : f.interestRate,
                        maturityDate: details.maturityDate || f.maturityDate,
                        buyPrice: nextBuyPrice,
                        currentPrice: nextCurrentPrice,
                        quantity: nextQty,
                        payoutFrequency: details.payoutFrequency || f.payoutFrequency || 'Semi-Annual',
                        payoutDates: details.payoutDates || f.payoutDates,
                    };
                });
                const rateStr = details.interestRate ? `${details.interestRate}%` : '';
                const matStr = details.maturityDate ? `Due ${details.maturityDate}` : '';
                const payoutStr = details.payoutDates ? `Payout: ${details.payoutDates}` : '';
                const extra = [rateStr, matStr, payoutStr].filter(Boolean).join(' • ');
                this.snackbar.show(`Loaded: ${details.name}${extra ? ' (' + extra + ')' : ''}`, 'success');
            } else {
                this.snackbar.show(`No bond details found for ISIN: ${isin}`, 'info');
            }
        } catch (err: any) {
            console.error('Error fetching bond details:', err);
            this.snackbar.show(err.message || 'Failed to fetch bond details', 'error');
        } finally {
            this.fetchingBond.set(false);
        }
    }

    bondAnnualInterest(): number {
        const f = this.form();
        if (f.type !== AssetType.Bond) return 0;
        const qty = f.quantity || 0;
        const price = f.buyPrice || 0;
        const rate = f.interestRate || 0;
        return (qty * price * rate) / 100;
    }

    bondInstallmentPayout(): { amount: number; label: string } {
        const annual = this.bondAnnualInterest();
        const freq = this.form().payoutFrequency || 'Semi-Annual';
        if (freq === 'Semi-Annual') {
            return { amount: annual / 2, label: 'Every 6 Months' };
        } else if (freq === 'Quarterly') {
            return { amount: annual / 4, label: 'Every 3 Months' };
        } else if (freq === 'Monthly') {
            return { amount: annual / 12, label: 'Every Month' };
        } else if (freq === 'Cumulative') {
            return { amount: annual, label: 'Lump Sum at Maturity' };
        }
        return { amount: annual, label: 'Once a Year' };
    }

    setBondFaceValue(val: number) {
        this.updateForm('buyPrice', val);
        this.updateForm('currentPrice', val);
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
            if ((!cleanData.currentPrice || cleanData.currentPrice <= 0) && this.isNonMarketAsset(cleanData as Asset)) {
                cleanData.currentPrice = cleanData.buyPrice;
            }
            if (cleanData.location === undefined) delete cleanData.location;
            if (!cleanData.notes) delete cleanData.notes;
            if (!cleanData.symbol) delete cleanData.symbol;
            if (!cleanData.appSource) delete cleanData.appSource;
            if (cleanData.interestRate === undefined || cleanData.interestRate === null || isNaN(cleanData.interestRate) || cleanData.interestRate <= 0) delete cleanData.interestRate;
            if (!cleanData.maturityDate) delete cleanData.maturityDate;
            if (!cleanData.subType) delete cleanData.subType;
            if (!cleanData.payoutFrequency) delete cleanData.payoutFrequency;
            if (!cleanData.payoutDates) delete cleanData.payoutDates;

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

    delete(id: string) {
        const asset = this.assets().find(a => a.id === id);
        if (!asset) return;
        this.assetsPendingDeletion.set([asset]);
        this.showDeleteModal.set(true);
    }

    async refreshMutualFunds(force = false) {
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

            const result = await this.priceService.refreshAllPrices(mfAssets, force);

            this.ngZone.run(() => {
                this.lastRefreshed.set(new Date().toLocaleTimeString());

                if (result.failed > 0 && result.mfUpdated === 0 && result.unchanged === 0) {
                    this.snackbar.show(`Failed to fetch prices for all ${result.failed} mutual funds.`, 'error');
                } else if (result.mfSkipped > 0 && result.mfUpdated === 0 && result.unchanged === 0) {
                    this.snackbar.show('Mutual Fund NAVs are already up to date for today (NAV updates once daily).', 'info');
                } else if (result.mfUpdated > 0) {
                    const skipText = result.mfSkipped > 0 ? ` (${result.mfSkipped} already up to date)` : '';
                    this.snackbar.show(`${force ? 'Force updated' : 'Successfully refreshed'} ${result.mfUpdated} mutual fund NAVs${skipText}`, 'success');
                } else {
                    this.snackbar.show(force ? 'Mutual Fund prices are up to date.' : 'Mutual Fund prices are already up to date for today.', 'info');
                }

                this.refreshingMFs.set(false);
                this.cdr.markForCheck();
            });
        } catch (err) {
            console.error('[Assets] MF Price refresh failed:', err);
            this.ngZone.run(() => {
                this.snackbar.show('Failed to refresh Mutual Funds. Please try again later.', 'error');
                this.refreshingMFs.set(false);
                this.cdr.markForCheck();
            });
        }
    }

    async refreshStocks(groupAssets: Asset[]) {
        if (this.refreshingStocks()) return;
        this.refreshingStocks.set(true);
        try {
            // Only refresh the assets passed in (the specific group's assets)
            const stockAssets = groupAssets.filter(a => !!a.id);

            if (stockAssets.length === 0) {
                this.ngZone.run(() => {
                    this.snackbar.show('No assets to refresh in this group.', 'info');
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

    async refreshSingleAsset(asset: Asset) {
        if (!asset.id || this.refreshingAssetId().has(asset.id)) return;
        this.refreshingAssetId.update(s => new Set(s).add(asset.id!));
        try {
            const res = await this.priceService.fetchPriceDetails(asset);
            if (res !== null) {
                const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                const todayStr = this.priceService.getTodayDateString();
                const isUS = this.isUSAsset(asset);
                const updates: Partial<Asset> = {
                    currentPrice: res.price,
                    lastUpdated: now,
                    lastUpdatedDate: todayStr
                };
                if (isUS && asset.currency !== 'USD') {
                    updates.currency = 'USD';
                }
                if (res.dailyChange !== undefined) {
                    updates.dailyChange = res.dailyChange;
                }
                if (res.navDate) {
                    updates.navDate = res.navDate;
                }
                await this.assetService.updateAsset(asset.id, updates);
                this.ngZone.run(() => {
                    const sym = isUS ? '$' : '₹';
                    const formatted = isUS
                        ? res.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : res.price.toLocaleString('en-IN');
                    const navDateStr = res.navDate ? ` (NAV: ${res.navDate})` : '';
                    this.snackbar.show(`${asset.name} updated to ${sym}${formatted}${navDateStr}`, 'success');
                    this.cdr.markForCheck();
                });
            } else {
                this.ngZone.run(() => this.snackbar.show(`Could not fetch price for ${asset.name}`, 'error'));
            }
        } catch (err) {
            console.error('[Assets] Single asset refresh failed:', err);
            this.ngZone.run(() => this.snackbar.show('Refresh failed. Try again.', 'error'));
        } finally {
            this.refreshingAssetId.update(s => { const n = new Set(s); n.delete(asset.id!); return n; });
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
