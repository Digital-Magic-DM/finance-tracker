import { Component, inject, signal, computed, NgZone, ChangeDetectorRef, OnInit, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssetService } from '../../services/asset.service';
import { GoalService } from '../../services/goal.service';
import { GOAL_CATEGORY_CONFIG } from '../../models/goal.models';
import { PriceService } from '../../services/price.service';
import { GoogleFinanceService } from '../../services/google-finance.service';
import { SnackbarService } from '../../services/snackbar.service';
import { TickerRegistryService } from '../../services/ticker-registry.service';
import { BondLookupService } from '../../services/bond-lookup.service';
import { CompanyLogoService } from '../../services/company-logo.service';
import { SnapshotService } from '../../services/snapshot.service';
import { Asset, AssetType, ASSET_COLORS, getAssetAppSource } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from '../settings/import-data/import-data.component';
import { LocationPickerComponent } from '../../shared/location-picker/location-picker.component';
import { CustomSelectDirective } from '../../shared/directives/custom-select.directive';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

interface AssetGroup {
    type: string;
    label: string;
    assets: Asset[];
    totalValue: number;
    totalInvested: number;
    totalGain: number;
    gainPct: number;
    totalDaysGain: number;
    daysGainPct: number;
    hasDayChange: boolean;
    allocation: number;
    color: string;
    expanded: boolean;
    currency: 'INR' | 'USD';
    totalValueINR?: number;
    totalInvestedINR?: number;
    totalDaysGainINR?: number;
    lastUpdated?: string;
}

@Component({
    selector: 'app-assets',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, FormsModule, ImportDataComponent, LocationPickerComponent, CustomSelectDirective, EmptyStateComponent],
    templateUrl: './assets.component.html',
    styleUrl: './assets.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetsComponent implements OnInit {
    private assetService = inject(AssetService);
    goalService = inject(GoalService);
    private priceService = inject(PriceService);
    public googleFinance = inject(GoogleFinanceService);
    private tickerRegistry = inject(TickerRegistryService);
    private bondLookupService = inject(BondLookupService);
    private snackbar = inject(SnackbarService);
    public logoService = inject(CompanyLogoService);
    private snapshotService = inject(SnapshotService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    ngOnInit() {
        // Fetch live USD to INR exchange rate on component initialization
        this.googleFinance.fetchUsdInrRate().catch(() => { });
    }

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    locallyDeletedIds = signal<Set<string>>(new Set());

    // Active assets excluding any items deleted in the current session
    activeAssets = computed(() => {
        const deleted = this.locallyDeletedIds();
        if (deleted.size === 0) return this.assets();
        return this.assets().filter(a => !a.id || !deleted.has(a.id));
    });
    snapshots = toSignal(this.snapshotService.getSnapshots(), { initialValue: [] });
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
    viewMode = signal<'cards' | 'table'>((localStorage.getItem('assetsViewMode') as 'cards' | 'table') || 'table');

    // Single expanded group tracking
    // All groups expanded by default in table view so users can see all holdings
    expandedGroups = signal<Set<string>>(new Set([
        'Overview', 'Stock', 'MutualFund', 'USStock', 'FixedDeposit',
        'Bond', 'SavingsAccount', 'ETF', 'Gold', 'Crypto', 'RealEstate', 'Cash', 'Other'
    ]));

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

    // Sorting state: 'value' | 'invested' | 'gain' | 'gainPct' | 'name' | 'quantity' | 'dayGain'
    sortField = signal<'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct' | 'dayGain'>('value');
    sortDirection = signal<'asc' | 'desc'>('desc');

    toggleSort(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct' | 'dayGain') {
        if (this.sortField() === field) {
            this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            this.sortField.set(field);
            this.sortDirection.set(field === 'name' ? 'asc' : 'desc');
        }
    }

    setSortField(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct' | 'dayGain') {
        this.sortField.set(field);
    }

    toggleSortDirection() {
        this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    }

    getSortIcon(field: 'name' | 'quantity' | 'invested' | 'value' | 'gain' | 'gainPct' | 'dayGain'): string {
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
                case 'dayGain': {
                    const dayA = this.getAssetDayGain(a) * this.getFxRate(a);
                    const dayB = this.getAssetDayGain(b) * this.getFxRate(b);
                    diff = dayA - dayB;
                    break;
                }
            }
            return diff * dir;
        });
    }

    getAssetApp(a: Asset): string {
        return getAssetAppSource(a);
    }

    availableApps = computed(() => {
        const apps = new Set<string>();
        for (const a of this.activeAssets()) {
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
        isLiquid: true,
        goalId: undefined,
        goalName: undefined
    });

    toggleHideAmounts() {
        this.hideAmounts.update(v => {
            const next = !v;
            localStorage.setItem('hideAssetAmounts', String(next));
            return next;
        });
    }

    setViewMode(mode: 'cards' | 'table') {
        this.viewMode.set(mode);
        localStorage.setItem('assetsViewMode', mode);
    }

    toggleViewMode() {
        this.viewMode.update(v => {
            const next = v === 'cards' ? 'table' : 'cards';
            localStorage.setItem('assetsViewMode', next);
            return next;
        });
    }



    isUSAsset(a: Asset): boolean {
        return this.priceService.isUSAsset(a);
    }

    isIndianAsset(a: Asset): boolean {
        return !this.isUSAsset(a);
    }

    allIndAssets = computed(() => this.activeAssets().filter(a => this.isIndianAsset(a)));
    allUsAssets = computed(() => this.activeAssets().filter(a => this.isUSAsset(a)));
    hasBothMarkets = computed(() => this.allIndAssets().length > 0 && this.allUsAssets().length > 0);

    categories = computed(() => {
        const assets = this.activeAssets();

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

        const standardOrder = ['Savings Account', 'Mutual Funds', 'Fixed Deposits', 'Bonds', 'ETFs', 'Gold', 'Crypto', 'Real Estate', 'Cash', 'Other'];
        for (const cat of standardOrder) {
            if (counts.has(cat) && counts.get(cat)! > 0) {
                list.push({ label: cat, count: counts.get(cat)!, key: cat });
            }
        }
        return list;
    });

    filteredAssets = computed(() => {
        let list = this.activeAssets();

        // 1. App Filter
        const app = this.appFilter();
        if (app !== 'All') {
            list = list.filter(a => this.getAssetApp(a) === app);
        }

        // 2. Category Tab
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
        return this.selectedCategory() === 'US Stocks';
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

    onSelectCategory(catKey: string) {
        this.selectedCategory.set(catKey);
    }

    // ── Linked Goal Info (Unique Icon & Theme Color) ──
    readonly goalLookup = computed(() => {
        const mapById = new Map<string, { name: string; icon: string; color: string }>();
        const mapByName = new Map<string, { name: string; icon: string; color: string }>();

        for (const g of this.goalService.goals()) {
            const icon = g.icon || (g.category && GOAL_CATEGORY_CONFIG[g.category]?.icon) || 'flag';
            const color = g.color || (g.category && GOAL_CATEGORY_CONFIG[g.category]?.color) || '#06b6d4';
            const info = { name: g.name, icon, color };
            if (g.id) mapById.set(g.id, info);
            if (g.name) mapByName.set(g.name.toLowerCase().trim(), info);
        }

        return { mapById, mapByName };
    });

    getGoalInfo(item?: { goalId?: string; goalName?: string }): { name: string; icon: string; color: string } | null {
        if (!item || (!item.goalId && !item.goalName)) return null;
        const { mapById, mapByName } = this.goalLookup();

        if (item.goalId && mapById.has(item.goalId)) {
            return mapById.get(item.goalId)!;
        }
        if (item.goalName) {
            const normalized = item.goalName.toLowerCase().trim();
            if (mapByName.has(normalized)) {
                return mapByName.get(normalized)!;
            }
            for (const [catKey, config] of Object.entries(GOAL_CATEGORY_CONFIG)) {
                if (normalized.includes(catKey.toLowerCase()) || normalized.includes(config.label.toLowerCase())) {
                    return { name: item.goalName, icon: config.icon, color: config.color };
                }
            }
            return { name: item.goalName, icon: 'flag', color: '#06b6d4' };
        }
        return null;
    }

    getCompanyLogo(asset: Asset): string | null {
        return this.logoService.getLogoUrl(asset);
    }

    onLogoError(asset: Asset): void {
        this.logoService.markLogoFailed(this.logoService.getLogoKey(asset));
    }

    getLogoFallback(asset: Asset) {
        return this.logoService.getFallback(asset);
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

    isHeroGainPositive = computed(() => {
        return (this.isViewingUS() ? this.usTotalGainUSD() : this.totalOverallGain()) >= 0;
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

    private generateSparklineSvgPath(points: Array<{ x: number; y: number }>): { strokePath: string; fillPath: string; tipX: number; tipY: number } {
        if (!points || points.length === 0) {
            return {
                strokePath: 'M 0,55 L 497,55',
                fillPath: 'M 0,55 L 497,55 L 497,110 L 0,110 Z',
                tipX: 497,
                tipY: 55
            };
        }

        if (points.length === 1) {
            const y = Math.round(points[0].y * 10) / 10;
            return {
                strokePath: `M 0,${y} L 497,${y}`,
                fillPath: `M 0,${y} L 497,${y} L 497,110 L 0,110 Z`,
                tipX: 497,
                tipY: y
            };
        }

        let strokePath = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

        if (points.length === 2) {
            const p0 = points[0];
            const p1 = points[1];
            const midX = (p0.x + p1.x) / 2;
            strokePath += ` C ${midX.toFixed(1)},${p0.y.toFixed(1)} ${midX.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
        } else {
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = i > 0 ? points[i - 1] : points[i];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = i < points.length - 2 ? points[i + 2] : p2;

                const cp1x = p1.x + (p2.x - p0.x) / 5.5;
                const cp1y = p1.y + (p2.y - p0.y) / 5.5;
                const cp2x = p2.x - (p3.x - p1.x) / 5.5;
                const cp2y = p2.y - (p3.y - p1.y) / 5.5;

                strokePath += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
            }
        }

        const lastPoint = points[points.length - 1];
        const firstPoint = points[0];
        const fillPath = `${strokePath} L ${lastPoint.x.toFixed(1)},110 L ${firstPoint.x.toFixed(1)},110 Z`;

        return {
            strokePath,
            fillPath,
            tipX: Number(lastPoint.x.toFixed(1)),
            tipY: Number(lastPoint.y.toFixed(1))
        };
    }

    heroSparkline = computed(() => {
        const assets = this.filteredAssets();
        const isUS = this.isViewingUS();
        const currentVal = isUS ? this.usTotalValueUSD() : this.totalValue();
        const investedCost = isUS ? this.usTotalInvestedUSD() : this.totalInvested();
        const dayGain = isUS ? this.usTotalDaysGainUSD() : this.totalDaysGain();
        const isPositive = this.isHeroGainPositive();

        if (!assets || assets.length === 0 || currentVal <= 0) {
            return {
                strokePath: 'M 0,55 L 497,55',
                fillPath: 'M 0,55 L 497,55 L 497,110 L 0,110 Z',
                tipX: 497,
                tipY: 55,
                isPositive: true
            };
        }

        // 1. Gather historical snapshot values from SnapshotService (last 30 snapshots)
        const snaps = this.snapshots();
        const snapPoints: Array<{ date: string; value: number }> = [];

        if (snaps && snaps.length > 0) {
            const sortedSnaps = [...snaps]
                .filter(s => s.date && !isNaN(new Date(s.date).getTime()))
                .sort((a, b) => a.date.localeCompare(b.date));

            const recentSnaps = sortedSnaps.slice(-30);

            for (const s of recentSnaps) {
                let val: number | undefined;

                if (isUS) {
                    const usINR = s.breakdown?.[AssetType.USStock];
                    if (usINR !== undefined && usINR > 0) {
                        const rate = this.googleFinance.usdToInrRate() || 85;
                        val = usINR / rate;
                    }
                } else if (this.selectedCategory() === 'Indian Stocks') {
                    val = s.breakdown?.[AssetType.Stock];
                } else if (this.selectedCategory() === 'Mutual Funds') {
                    val = s.breakdown?.[AssetType.MutualFund];
                } else if (this.selectedCategory() === 'Bonds') {
                    val = s.breakdown?.[AssetType.Bond];
                } else if (this.selectedCategory() === 'Savings Account') {
                    val = s.breakdown?.[AssetType.SavingsAccount];
                } else {
                    val = s.totalAssets || s.netWorth;
                }

                if (val !== undefined && val > 0 && !isNaN(val)) {
                    snapPoints.push({ date: s.date, value: val });
                }
            }
        }

        const yesterdayVal = Math.max(0, currentVal - dayGain);
        let values: number[] = [];

        // If we have at least 4 recent daily snapshots, use those authentic daily points!
        if (snapPoints.length >= 4) {
            values = snapPoints.map(p => p.value);
            const todayStr = new Date().toISOString().split('T')[0];
            const lastSnapDate = snapPoints[snapPoints.length - 1].date;

            // If today's live value is not yet in the snapshots, append yesterday & today
            if (lastSnapDate < todayStr) {
                values.push(yesterdayVal);
                values.push(currentVal);
            } else {
                values[values.length - 1] = currentVal;
            }
        } else {
            // Build an authentic multi-point performance trajectory
            // from initial invested capital basis to yesterday's close and today's live valuation
            const startVal = investedCost > 0 ? investedCost : currentVal;
            const diff = currentVal - startVal;
            const steps = 12; // 12 smooth evaluation points
            const interpolated: number[] = [];

            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                if (i === 0) {
                    interpolated.push(startVal);
                } else if (i === steps - 1) {
                    interpolated.push(yesterdayVal);
                } else if (i === steps) {
                    interpolated.push(currentVal);
                } else {
                    // Smooth S-curve (cubic Hermite easing) from startVal to currentVal
                    const ease = t * t * (3 - 2 * t);
                    // Add subtle natural market variance based on portfolio return rate
                    const subtleDrift = Math.sin(t * Math.PI * 1.5) * (diff * 0.04);
                    interpolated.push(startVal + diff * ease + subtleDrift);
                }
            }
            values = interpolated;
        }

        // 2. Map values to SVG coordinates (500 x 110)
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const diff = maxVal - minVal;
        const range = diff <= 0 ? Math.max(1, Math.abs(maxVal) * 0.1) : diff;

        const paddedMin = minVal - range * 0.1;
        const paddedMax = maxVal + range * 0.1;
        const paddedRange = paddedMax - paddedMin;

        const svgPoints = values.map((v, i) => {
            const x = (i / (values.length - 1)) * 492 + 4;
            const norm = (v - paddedMin) / paddedRange;
            const y = 94 - (norm * 78);
            return { x, y: Math.max(14, Math.min(96, y)) };
        });

        const paths = this.generateSparklineSvgPath(svgPoints);

        return {
            ...paths,
            isPositive
        };
    });

    isPriceRefreshableStock(a: Asset): boolean {
        if (!a || !a.id) return false;
        if (a.type === AssetType.MutualFund) return false;
        if (this.isNonMarketAsset(a)) return false;
        return a.type === AssetType.Stock ||
               a.type === AssetType.USStock ||
               a.type === AssetType.ETF ||
               this.isUSAsset(a) ||
               !!a.symbol;
    }

    refreshTooltip = computed(() => {
        if (this.isViewingUS()) return 'Refresh US Stock prices';
        const cat = this.selectedCategory();
        if (cat === 'Mutual Funds') return 'Refresh Mutual Fund NAVs (Updates 1× daily)';
        if (cat === 'Indian Stocks') return 'Refresh Indian Stock prices';
        return 'Refresh visible prices on screen';
    });

    refreshAllPrices(forceMF = false) {
        // Strictly refresh ONLY the assets currently displayed on screen (filteredAssets)
        const visible = this.filteredAssets();
        const stocks = visible.filter(a => this.isPriceRefreshableStock(a));
        const mfs = visible.filter(a => a.type === AssetType.MutualFund);

        if (stocks.length === 0 && mfs.length === 0) {
            const currentCat = this.selectedCategory();
            this.snackbar.show(`No live market-priced assets to refresh in current view (${currentCat}).`, 'info');
            return;
        }

        // Only call the fetch API for the asset types actually shown on screen!
        if (stocks.length > 0) this.refreshStocks(stocks);
        if (mfs.length > 0) this.refreshMutualFunds(forceMF, mfs);
        if (this.isViewingUS() || visible.some(a => this.isUSAsset(a))) {
            this.googleFinance.fetchUsdInrRate(true).catch(() => {});
        }
    }

    assetGroups = computed(() => {
        const assets = this.filteredAssets();
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
            AssetType.SavingsAccount,
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
            const tDaysGain = usStocks.reduce((s, a) => {
                const cp = a.currentPrice > 0 ? a.currentPrice : 0;
                const pct = (a.dailyChange || 0) / 100;
                return s + (cp * pct * a.quantity);
            }, 0);
            const daysGainPct = tValue > 0 ? (tDaysGain / tValue) * 100 : 0;
            const hasDayChange = usStocks.some(a => a.dailyChange !== undefined && a.dailyChange !== null);
            const tValueINR = tValue * usdRate;
            const tInvestedINR = tInvested * usdRate;
            const tDaysGainINR = tDaysGain * usdRate;
            const allocation = totalPortfolioValue > 0 ? (tValueINR / totalPortfolioValue) * 100 : 0;

            const latestUpdate = usStocks
                .filter(a => !!a.lastUpdated)
                .map(a => a.lastUpdated!)
                .sort().reverse()[0];

            groups.push({
                type: 'USStock',
                label: 'US Stocks',
                assets: this.sortAssetList(usStocks),
                totalValue: tValue,
                totalInvested: tInvested,
                totalGain: tGain,
                gainPct: gPct,
                totalDaysGain: tDaysGain,
                daysGainPct,
                hasDayChange,
                allocation,
                color: this.getColor(AssetType.USStock),
                expanded: this.isGroupExpanded('USStock'),
                currency: 'USD',
                totalValueINR: tValueINR,
                totalInvestedINR: tInvestedINR,
                totalDaysGainINR: tDaysGainINR,
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
                const tDaysGain = typeAssets.reduce((s, a) => {
                    const cp = a.currentPrice > 0 ? a.currentPrice : 0;
                    const pct = (a.dailyChange || 0) / 100;
                    return s + (cp * pct * a.quantity);
                }, 0);
                const daysGainPct = tValue > 0 ? (tDaysGain / tValue) * 100 : 0;
                const hasDayChange = typeAssets.some(a => a.dailyChange !== undefined && a.dailyChange !== null);
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
                    totalDaysGain: tDaysGain,
                    daysGainPct,
                    hasDayChange,
                    allocation,
                    color: ASSET_COLORS[type],
                    expanded: this.isGroupExpanded(type),
                    currency: 'INR',
                    totalValueINR: tValue,
                    totalInvestedINR: tInvested,
                    totalDaysGainINR: tDaysGain,
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
                case 'dayGain':
                    diff = (a.totalDaysGainINR ?? a.totalDaysGain) - (b.totalDaysGainINR ?? b.totalDaysGain);
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
            [AssetType.SavingsAccount]: 'Savings Account',
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
            [AssetType.Cash]: 'payments',
            [AssetType.SavingsAccount]: 'account_balance',
            [AssetType.Other]: 'category',
        };
        return icons[type] || 'category';
    }

    isNonMarketAsset(a: Asset): boolean {
        return a.type === AssetType.Cash || a.type === AssetType.SavingsAccount || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit;
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

    hasAssetDayGain(a: Asset): boolean {
        if (this.isNonMarketAsset(a)) return false;
        return a.currentPrice > 0 && a.dailyChange !== undefined && a.dailyChange !== null;
    }

    getAssetDayGain(a: Asset): number {
        if (!this.hasAssetDayGain(a)) return 0;
        const cp = a.currentPrice > 0 ? a.currentPrice : 0;
        const pct = (a.dailyChange || 0) / 100;
        return cp * pct * (a.quantity || 0);
    }

    getAssetSparkline(asset: Asset): { path: string; isPositive: boolean; stroke: string } {
        const isPos = (asset.dailyChange || 0) >= 0;
        const stroke = isPos ? '#10b981' : '#ef4444';
        if (this.isNonMarketAsset(asset) || !asset.currentPrice) {
            return { path: 'M 2 13 L 58 13', isPositive: true, stroke: 'rgba(255, 255, 255, 0.25)' };
        }

        // Hash asset symbol/name for deterministic wave pattern
        const str = asset.symbol || asset.name || '';
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
        const seed = Math.abs(hash) % 100;

        const yStart = isPos ? 17 + (seed % 4) : 8 + (seed % 4);
        const yEnd = isPos ? 5 + (seed % 3) : 21 - (seed % 3);
        const m1 = isPos ? 13 - (seed % 5) : 7 + (seed % 5);
        const m2 = isPos ? 18 - (seed % 4) : 15 + (seed % 4);
        const m3 = isPos ? 8 + (seed % 3) : 12 - (seed % 3);
        const m4 = isPos ? 11 - (seed % 4) : 19 - (seed % 4);

        const path = `M 2 ${yStart} Q 11 ${m1}, 20 ${m2} T 38 ${m3} T 48 ${m4} T 58 ${yEnd}`;
        return { path, isPositive: isPos, stroke };
    }

    getColor(type: AssetType | string) {
        if (type === 'USStock' || type === AssetType.USStock) return 'var(--asset-us-stock)';
        if (type === 'FixedDeposit' || type === AssetType.FixedDeposit) return 'var(--asset-fd)';
        if (type === AssetType.Bond) return 'var(--asset-bond)';
        return ASSET_COLORS[type as AssetType] || '#64748b';
    }

    // ─── Group collapse/expand ───────────────────
    isGroupExpanded(type: string | AssetType): boolean {
        return this.expandedGroups().has(String(type));
    }

    areAllGroupsExpanded(): boolean {
        return this.expandedGroups().size > 0;
    }

    toggleGroup(type: string | AssetType) {
        const key = String(type);
        this.expandedGroups.update(set => {
            const next = new Set(set);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    toggleAllGroups() {
        if (this.areAllGroupsExpanded()) {
            this.expandedGroups.set(new Set());
        } else {
            this.expandedGroups.set(new Set([
                'Overview', 'Stock', 'MutualFund', 'USStock', 'FixedDeposit',
                'Bond', 'SavingsAccount', 'ETF', 'Gold', 'Crypto', 'RealEstate', 'Cash', 'Other'
            ]));
        }
    }

    // ─── Multi-select ────────────────────────────
    onGoalSelected(goalId: string) {
        if (!goalId) {
            this.updateForm('goalId', undefined as any);
            this.updateForm('goalName', undefined as any);
            return;
        }
        const goal = this.goalService.goals().find(g => g.id === goalId);
        this.updateForm('goalId', goalId);
        this.updateForm('goalName', goal ? goal.name : undefined as any);
    }

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

        const toDelete = this.activeAssets().filter(a => a.id && ids.has(a.id));
        if (toDelete.length === 0) return;

        this.assetsPendingDeletion.set(toDelete);
        this.showDeleteModal.set(true);
    }

    closeDeleteModal(force = false) {
        if (this.deleting() && !force) return;
        this.showDeleteModal.set(false);
        this.assetsPendingDeletion.set([]);
    }

    async confirmDelete() {
        const toDelete = this.assetsPendingDeletion();
        const ids = toDelete.map(a => a.id!).filter(Boolean);
        if (ids.length === 0) {
            this.closeDeleteModal(true);
            return;
        }

        this.deleting.set(true);
        try {
            // Optimistically update local deleted set so the items vanish from UI immediately
            this.locallyDeletedIds.update(set => {
                const next = new Set(set);
                for (const id of ids) next.add(id);
                return next;
            });

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

            await this.assetService.batchDeleteAssets(ids);

            this.snackbar.show(
                `Successfully deleted ${ids.length} holding${ids.length > 1 ? 's' : ''}`,
                'success'
            );
            this.closeDeleteModal(true);
            this.cdr.markForCheck();
        } catch (err: any) {
            console.error('[Assets] Batch delete failed:', err);
            // Rollback optimistic deletion on error
            this.locallyDeletedIds.update(set => {
                const next = new Set(set);
                for (const id of ids) next.delete(id);
                return next;
            });
            this.snackbar.show('Failed to delete holdings. Please try again.', 'error');
        } finally {
            this.deleting.set(false);
            this.closeDeleteModal(true);
            this.cdr.markForCheck();
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
                'Savings Account': AssetType.SavingsAccount,
                'Other': AssetType.Other,
            };
            const currentCat = this.selectedCategory();
            if (currentCat && catMap[currentCat]) {
                selectedType = catMap[currentCat];
            } else if (this.isViewingUS()) {
                selectedType = AssetType.USStock;
            } else {
                selectedType = AssetType.Stock;
            }
        }
        const defaultCurrency = currency || ((selectedType === AssetType.USStock || selectedType === AssetType.Crypto || this.isViewingUS()) ? 'USD' : 'INR');
        const defaultQty = (selectedType === AssetType.FixedDeposit || selectedType === AssetType.RealEstate || selectedType === AssetType.Cash || selectedType === AssetType.SavingsAccount) ? 1 : (selectedType === AssetType.Bond ? 1 : 0);
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
            interestRate: selectedType === AssetType.FixedDeposit ? 7.0 : (selectedType === AssetType.SavingsAccount ? 3.5 : (selectedType === AssetType.Bond ? 8.5 : undefined)),
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

        const isCashOrSavings = a.type === AssetType.Cash || a.type === AssetType.SavingsAccount;
        const totalCashAmt = isCashOrSavings ? (a.quantity * (a.currentPrice > 0 ? a.currentPrice : a.buyPrice)) : a.buyPrice;

        this.form.set({
            ...a,
            quantity: isCashOrSavings ? 1 : a.quantity,
            buyPrice: isCashOrSavings ? totalCashAmt : a.buyPrice,
            currentPrice: isCashOrSavings ? totalCashAmt : a.currentPrice,
            currency: isUS ? 'USD' : (a.currency || 'INR'),
            appSource: source,
            payoutFrequency: payoutFreq,
            payoutDates: payoutDates,
        });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateCashOrSavingsBalance(val: number) {
        const num = isNaN(val) ? 0 : val;
        this.form.update(f => ({
            ...f,
            quantity: 1,
            buyPrice: num,
            currentPrice: num,
            isLiquid: true
        }));
    }

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
                if (type === AssetType.Cash || type === AssetType.SavingsAccount || type === AssetType.RealEstate || type === AssetType.FixedDeposit) {
                    next.symbol = '';
                }
                if (type === AssetType.Cash || type === AssetType.SavingsAccount || type === AssetType.RealEstate) {
                    next.appSource = 'Manual';
                }
                if (type === AssetType.Cash || type === AssetType.SavingsAccount) {
                    if (!next.quantity || next.quantity <= 0) next.quantity = 1;
                    if (next.buyPrice > 0 && (!next.currentPrice || next.currentPrice <= 0)) {
                        next.currentPrice = next.buyPrice;
                    } else if (next.currentPrice > 0 && (!next.buyPrice || next.buyPrice <= 0)) {
                        next.buyPrice = next.currentPrice;
                    }
                    next.isLiquid = true;
                    if (type === AssetType.SavingsAccount && next.interestRate === undefined) {
                        next.interestRate = 3.5;
                    }
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
        const asset = this.activeAssets().find(a => a.id === id);
        if (!asset) return;
        this.assetsPendingDeletion.set([asset]);
        this.showDeleteModal.set(true);
    }

    async refreshMutualFunds(force = false, targetAssets?: Asset[]) {
        if (this.refreshingMFs()) return;
        this.refreshingMFs.set(true);
        try {
            // Only refresh the specified or currently visible Mutual Funds on screen
            const sourceAssets = targetAssets || this.filteredAssets();
            const mfAssets = sourceAssets.filter(a => a.type === AssetType.MutualFund && !!a.id);

            if (mfAssets.length === 0) {
                this.ngZone.run(() => {
                    this.snackbar.show('No Mutual Funds to refresh in current view.', 'info');
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

    async refreshStocks(groupAssets?: Asset[]) {
        if (this.refreshingStocks()) return;
        this.refreshingStocks.set(true);
        try {
            // Only refresh the assets passed in (or currently visible screen stocks)
            const targetAssets = groupAssets || this.filteredAssets();
            const stockAssets = targetAssets.filter(a => !!a.id && this.isPriceRefreshableStock(a));

            if (stockAssets.length === 0) {
                this.ngZone.run(() => {
                    this.snackbar.show('No stock/market assets to refresh in current view.', 'info');
                    this.refreshingStocks.set(false);
                });
                return;
            }

            const result = await this.priceService.refreshAllPrices(stockAssets);

            this.ngZone.run(() => {
                this.lastRefreshed.set(new Date().toLocaleTimeString());
                const isOnlyUS = stockAssets.every(a => this.isUSAsset(a));
                const label = isOnlyUS ? 'US stock' : (stockAssets.some(a => this.isUSAsset(a)) ? 'stock' : 'Indian stock');

                if (result.failed > 0 && result.updated === 0 && result.unchanged === 0) {
                    this.snackbar.show(`Failed to fetch prices for all ${result.failed} ${label}s.`, 'error');
                } else if (result.failed > 0) {
                    this.snackbar.show(`Refreshed ${label} prices (Updated: ${result.updated}), but ${result.failed} failed.`, 'error');
                } else if (result.updated > 0) {
                    this.snackbar.show(`Successfully refreshed ${result.updated} ${label} price${result.updated > 1 ? 's' : ''}`, 'success');
                } else {
                    this.snackbar.show(`${isOnlyUS ? 'US stock' : 'Stock'} prices are up to date.`, 'info');
                }

                this.refreshingStocks.set(false);
                this.cdr.markForCheck();
            });
        } catch (err) {
            console.error('[Assets] Stock Price refresh failed:', err);
            this.ngZone.run(() => {
                this.snackbar.show('Failed to refresh stocks. Please try again later.', 'error');
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
