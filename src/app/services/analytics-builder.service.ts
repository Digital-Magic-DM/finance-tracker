import { Injectable, inject, computed, signal } from '@angular/core';
import { AssetService } from './asset.service';
import { TransactionService } from './transaction.service';
import { PriceService } from './price.service';
import { GoogleFinanceService } from './google-finance.service';
import { CustomChartConfig, TransactionType, AssetType, getAssetAppSource } from '../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AnalyticsBuilderService {
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private priceService = inject(PriceService);
    private googleFinance = inject(GoogleFinanceService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });

    savedConfigs = signal<CustomChartConfig[]>(this.loadConfigs());

    private loadConfigs(): CustomChartConfig[] {
        try {
            const stored = localStorage.getItem('custom_analytics_configs');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    private saveToStorage(configs: CustomChartConfig[]) {
        localStorage.setItem('custom_analytics_configs', JSON.stringify(configs));
    }

    saveConfig(config: CustomChartConfig) {
        // Generate pseudo-uuid if crypto is unavailable or not working
        if (!config.id) config.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        
        this.savedConfigs.update(configs => {
            const index = configs.findIndex(c => c.id === config.id);
            let newConfigs = [];
            if (index > -1) {
                newConfigs = [...configs];
                newConfigs[index] = config;
            } else {
                newConfigs = [...configs, config];
            }
            this.saveToStorage(newConfigs);
            return newConfigs;
        });
    }

    deleteConfig(id: string) {
        this.savedConfigs.update(configs => {
            const newConfigs = configs.filter(c => c.id !== id);
            this.saveToStorage(newConfigs);
            return newConfigs;
        });
    }

    // THE CORE TRANSFORMATION PIPELINE
    // Returns a highly reactive computed signal tightly coupled to config AND raw data
    buildChartData(config: CustomChartConfig) {
        return computed(() => {
            const txs = this.transactions() || [];
            const asts = this.assets() || [];

            // 1. Fetch & Base Filtering
            let rawData: any[] = [];
            if (config.dataSource === 'Income') {
                rawData = txs.filter(t => t.type === TransactionType.Income || t.type === TransactionType.Sell);
            } else if (config.dataSource === 'Expense') {
                rawData = txs.filter(t => t.type === TransactionType.Expense || t.type === TransactionType.Buy);
            } else if (config.dataSource === 'Assets') {
                rawData = asts;
            }

            if (!rawData.length) return { labels: [], data: [] };

            // 2. Filter (Dimension Filtering and Date ranges)
            const filters = config.filters || {};
            let filtered = rawData;

            if (filters.dateRange?.startDate) {
                const start = new Date(filters.dateRange.startDate).getTime();
                filtered = filtered.filter(item => {
                    const dateVal = item.date ? (item.date.seconds ? item.date.seconds * 1000 : new Date(item.date).getTime()) : (item.purchaseDate ? new Date(item.purchaseDate).getTime() : 0);
                    return dateVal >= start;
                });
            }
            if (filters.dateRange?.endDate) {
                const end = new Date(filters.dateRange.endDate).getTime();
                filtered = filtered.filter(item => {
                    const dateVal = item.date ? (item.date.seconds ? item.date.seconds * 1000 : new Date(item.date).getTime()) : (item.purchaseDate ? new Date(item.purchaseDate).getTime() : 0);
                    return dateVal <= end;
                });
            }
            if (filters.categories?.length && config.dataSource !== 'Assets') {
                filtered = filtered.filter(item => filters.categories!.includes(item.category));
            }
            if (filters.assetTypes?.length && config.dataSource === 'Assets') {
                filtered = filtered.filter(item => filters.assetTypes!.includes(item.type));
            }
            if (filters.appSources?.length && config.dataSource === 'Assets') {
                filtered = filtered.filter(item => {
                    const itemAppSource = getAssetAppSource(item);
                    return filters.appSources!.includes(itemAppSource);
                });
            }

            // 3. Group
            const grouped: Record<string, number> = {};
            filtered.forEach(item => {
                let groupKey = 'Total';
                
                if (config.displayType !== 'widget') {
                    if (config.dimension === 'Category') groupKey = item.category || 'Uncategorized';
                    else if (config.dimension === 'Type') groupKey = item.type || 'Unknown';
                    else if (config.dimension === 'AppSource') groupKey = getAssetAppSource(item);
                    else if (config.dimension === 'Time') {
                        const dateObj = item.date ? (item.date.seconds ? new Date(item.date.seconds * 1000) : new Date(item.date)) : (item.purchaseDate ? new Date(item.purchaseDate) : new Date());
                        groupKey = dateObj.toLocaleString('default', { month: 'short', year: '2-digit' });
                    }
                }

                // 4. Aggregate with multi-currency FX rate and safe unpriced asset handling
                let valueToAdd = 0;
                if (config.metric === 'Count') {
                    valueToAdd = 1;
                } else if (config.dataSource === 'Assets') {
                    const cp = item.currentPrice > 0 ? item.currentPrice : (item.type === AssetType.Cash || item.type === AssetType.RealEstate ? item.buyPrice : 0);
                    const fx = this.priceService.isUSAsset(item) ? this.googleFinance.usdToInrRate() : 1;
                    valueToAdd = item.quantity * cp * fx;
                } else {
                    valueToAdd = Number(item.amount) || 0;
                }
                    
                grouped[groupKey] = (grouped[groupKey] || 0) + Number(valueToAdd || 0);
            });

            // 5. Sort & Limit
            let results = Object.entries(grouped).map(([label, value]) => ({ label, value }));
            
            if (config.sortBy === 'value_desc') results.sort((a, b) => b.value - a.value);
            else if (config.sortBy === 'value_asc') results.sort((a, b) => a.value - b.value);
            else if (config.sortBy === 'label_asc') results.sort((a, b) => a.label.localeCompare(b.label));
            else if (config.sortBy === 'label_desc') results.sort((a, b) => b.label.localeCompare(a.label));
            else if (config.sortBy === 'time_asc') {
                results.sort((a,b) => {
                    const dA = new Date('01 ' + a.label);
                    const dB = new Date('01 ' + b.label);
                    return dA.getTime() - dB.getTime();
                });
            }

            if (config.limit && config.limit > 0) {
                results = results.slice(0, config.limit);
            }

            // 6. Format for Charting Layer
            return {
                labels: results.map(r => r.label),
                data: results.map(r => r.value)
            };
        });
    }
}
