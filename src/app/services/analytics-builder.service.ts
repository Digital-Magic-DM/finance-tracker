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
        if (!config.id) {
            config.id = Date.now().toString(36) + Math.random().toString(36).substring(2);
        }
        
        this.savedConfigs.update(configs => {
            const index = configs.findIndex(c => c.id === config.id);
            let newConfigs: CustomChartConfig[] = [];
            if (index > -1) {
                newConfigs = [...configs];
                newConfigs[index] = { ...config };
            } else {
                newConfigs = [...configs, { ...config }];
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

            // 2. Filter (Dimension Filtering, Amounts, and Date ranges)
            const filters = config.filters || {};
            let filtered = rawData;

            // Date filtering
            let startTime: number | null = null;
            let endTime: number | null = null;

            if (filters.dateRange?.preset && filters.dateRange.preset !== 'all' && filters.dateRange.preset !== 'custom') {
                const now = new Date();
                endTime = now.getTime();
                switch (filters.dateRange.preset) {
                    case '1m':
                        startTime = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();
                        break;
                    case '3m':
                        startTime = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).getTime();
                        break;
                    case '6m':
                        startTime = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
                        break;
                    case 'this_year':
                        startTime = new Date(now.getFullYear(), 0, 1).getTime();
                        break;
                    case '1y':
                        startTime = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
                        break;
                }
            } else {
                if (filters.dateRange?.startDate) {
                    startTime = new Date(filters.dateRange.startDate).getTime();
                }
                if (filters.dateRange?.endDate) {
                    endTime = new Date(filters.dateRange.endDate).getTime();
                }
            }

            if (startTime !== null) {
                filtered = filtered.filter(item => {
                    const dateVal = item.date 
                        ? (item.date.seconds ? item.date.seconds * 1000 : new Date(item.date).getTime()) 
                        : (item.purchaseDate ? new Date(item.purchaseDate).getTime() : 0);
                    return dateVal >= startTime!;
                });
            }
            if (endTime !== null) {
                filtered = filtered.filter(item => {
                    const dateVal = item.date 
                        ? (item.date.seconds ? item.date.seconds * 1000 : new Date(item.date).getTime()) 
                        : (item.purchaseDate ? new Date(item.purchaseDate).getTime() : 0);
                    return dateVal <= endTime!;
                });
            }

            // Categories filter
            if (filters.categories?.length && config.dataSource !== 'Assets') {
                filtered = filtered.filter(item => filters.categories!.includes(item.category));
            }

            // Banks filter
            if (filters.banks?.length && config.dataSource !== 'Assets') {
                filtered = filtered.filter(item => filters.banks!.includes(item.bank || 'None'));
            }

            // Min/Max amount filter for transactions
            if (filters.minAmount !== undefined && config.dataSource !== 'Assets') {
                filtered = filtered.filter(item => (item.amount || 0) >= filters.minAmount!);
            }
            if (filters.maxAmount !== undefined && config.dataSource !== 'Assets') {
                filtered = filtered.filter(item => (item.amount || 0) <= filters.maxAmount!);
            }

            // Asset types filter
            if (filters.assetTypes?.length && config.dataSource === 'Assets') {
                filtered = filtered.filter(item => filters.assetTypes!.includes(item.type));
            }

            // App sources filter
            if (filters.appSources?.length && config.dataSource === 'Assets') {
                filtered = filtered.filter(item => {
                    const itemAppSource = getAssetAppSource(item);
                    return filters.appSources!.includes(itemAppSource);
                });
            }

            // 3. Group and Accumulate Values
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const grouped: Record<string, number[]> = {};

            filtered.forEach(item => {
                let groupKey = 'Total';
                
                if (config.displayType !== 'widget') {
                    if (config.dimension === 'Category') {
                        groupKey = item.category || 'Uncategorized';
                    } else if (config.dimension === 'Type') {
                        groupKey = item.type || 'Unknown';
                    } else if (config.dimension === 'AppSource') {
                        groupKey = getAssetAppSource(item);
                    } else if (config.dimension === 'Bank') {
                        groupKey = item.bank || 'None / Cash';
                    } else if (config.dimension === 'DayOfWeek') {
                        const dateObj = item.date 
                            ? (item.date.seconds ? new Date(item.date.seconds * 1000) : new Date(item.date)) 
                            : (item.purchaseDate ? new Date(item.purchaseDate) : new Date());
                        groupKey = days[dateObj.getDay()] || 'Unknown';
                    } else if (config.dimension === 'Time') {
                        const dateObj = item.date 
                            ? (item.date.seconds ? new Date(item.date.seconds * 1000) : new Date(item.date)) 
                            : (item.purchaseDate ? new Date(item.purchaseDate) : new Date());
                        groupKey = dateObj.toLocaleString('default', { month: 'short', year: '2-digit' });
                    }
                }

                // Calculate value
                let valueToAdd = 0;
                if (config.metric === 'Count') {
                    valueToAdd = 1;
                } else if (config.dataSource === 'Assets') {
                    const cp = item.currentPrice > 0 ? item.currentPrice : (item.type === AssetType.Cash || item.type === AssetType.RealEstate || item.type === AssetType.Bond || item.type === AssetType.FixedDeposit ? item.buyPrice : 0);
                    const fx = this.priceService.isUSAsset(item) ? this.googleFinance.usdToInrRate() : 1;
                    valueToAdd = item.quantity * cp * fx;
                } else {
                    valueToAdd = Number(item.amount) || 0;
                }
                    
                if (!grouped[groupKey]) {
                    grouped[groupKey] = [];
                }
                grouped[groupKey].push(valueToAdd);
            });

            // 4. Compute Aggregate Metrics (Sum, Count, Average, Max, Min)
            const aggregated = Object.entries(grouped).map(([label, list]) => {
                let val = 0;
                if (config.metric === 'Count') {
                    val = list.length;
                } else if (config.metric === 'Average') {
                    val = list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
                } else if (config.metric === 'Max') {
                    val = list.length ? Math.max(...list) : 0;
                } else if (config.metric === 'Min') {
                    val = list.length ? Math.min(...list) : 0;
                } else {
                    // Default: 'Sum'
                    val = list.reduce((a, b) => a + b, 0);
                }
                return { label, value: Math.round(val * 100) / 100 };
            });

            // 5. Sort & Limit
            let results = aggregated;
            if (config.sortBy === 'value_desc') results.sort((a, b) => b.value - a.value);
            else if (config.sortBy === 'value_asc') results.sort((a, b) => a.value - b.value);
            else if (config.sortBy === 'label_asc') results.sort((a, b) => a.label.localeCompare(b.label));
            else if (config.sortBy === 'label_desc') results.sort((a, b) => b.label.localeCompare(a.label));
            else if (config.sortBy === 'time_asc') {
                if (config.dimension === 'DayOfWeek') {
                    results.sort((a, b) => days.indexOf(a.label) - days.indexOf(b.label));
                } else {
                    results.sort((a, b) => {
                        const dA = new Date('01 ' + a.label);
                        const dB = new Date('01 ' + b.label);
                        return dA.getTime() - dB.getTime();
                    });
                }
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

    /**
     * Starter templates for users wanting fast, stunning custom charts.
     */
    getStarterTemplates(): Partial<CustomChartConfig>[] {
        return [
            {
                title: 'Top 5 Expense Categories',
                displayType: 'chart',
                dataSource: 'Expense',
                metric: 'Sum',
                dimension: 'Category',
                chartType: 'doughnut',
                sortBy: 'value_desc',
                limit: 5,
                palette: 'sunset',
                cardWidth: 'half'
            },
            {
                title: 'Asset Allocation by Class',
                displayType: 'chart',
                dataSource: 'Assets',
                metric: 'Sum',
                dimension: 'Type',
                chartType: 'polarArea',
                sortBy: 'value_desc',
                palette: 'cyber',
                cardWidth: 'half'
            },
            {
                title: 'Monthly Cash Flow Trend',
                displayType: 'chart',
                dataSource: 'Expense',
                metric: 'Sum',
                dimension: 'Time',
                chartType: 'area',
                sortBy: 'time_asc',
                palette: 'emerald',
                cardWidth: 'full'
            },
            {
                title: 'Portfolio by Broker / App',
                displayType: 'chart',
                dataSource: 'Assets',
                metric: 'Sum',
                dimension: 'AppSource',
                chartType: 'pie',
                sortBy: 'value_desc',
                palette: 'ocean',
                cardWidth: 'half'
            },
            {
                title: 'Spending by Bank Account',
                displayType: 'chart',
                dataSource: 'Expense',
                metric: 'Sum',
                dimension: 'Bank',
                chartType: 'bar',
                sortBy: 'value_desc',
                palette: 'default',
                cardWidth: 'half'
            },
            {
                title: 'Weekly Spending Rhythm',
                displayType: 'chart',
                dataSource: 'Expense',
                metric: 'Sum',
                dimension: 'DayOfWeek',
                chartType: 'bar',
                sortBy: 'time_asc',
                palette: 'cyber',
                cardWidth: 'half'
            }
        ];
    }
}
