import { Component, EventEmitter, Input, Output, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
    CustomChartConfig, 
    AssetType, 
    getAssetAppSource, 
    TRANSACTION_CATEGORIES,
    ChartType,
    ChartPalette
} from '../../../models/finance.models';
import { AnalyticsBuilderService } from '../../../services/analytics-builder.service';
import { DynamicChartComponent } from '../../../shared/dynamic-chart/dynamic-chart.component';
import { CustomSelectDirective } from '../../../shared/directives/custom-select.directive';

@Component({
    selector: 'app-custom-analytics-builder',
    standalone: true,
    imports: [CommonModule, FormsModule, DynamicChartComponent, CustomSelectDirective],
    templateUrl: './custom-analytics-builder.component.html',
    styleUrl: './custom-analytics-builder.component.scss'
})
export class CustomAnalyticsBuilderComponent implements OnInit {
    @Input() editConfig?: CustomChartConfig | null = null;
    @Output() close = new EventEmitter<void>();

    private analyticsBuilder = inject(AnalyticsBuilderService);

    config = signal<CustomChartConfig>({
        id: '',
        title: 'New Custom Analytics',
        displayType: 'chart',
        dataSource: 'Expense',
        metric: 'Sum',
        dimension: 'Category',
        filters: {},
        chartType: 'doughnut',
        sortBy: 'value_desc',
        limit: 10,
        palette: 'default',
        cardWidth: 'half'
    });

    starterTemplates = this.analyticsBuilder.getStarterTemplates();
    categories = TRANSACTION_CATEGORIES;
    availableAssetTypes = Object.values(AssetType);

    chartTypesList: { id: ChartType; label: string; icon: string }[] = [
        { id: 'doughnut', label: 'Donut', icon: 'donut_large' },
        { id: 'pie', label: 'Pie', icon: 'pie_chart' },
        { id: 'bar', label: 'Bar', icon: 'bar_chart' },
        { id: 'line', label: 'Line', icon: 'show_chart' },
        { id: 'area', label: 'Area', icon: 'stacked_line_chart' },
        { id: 'polarArea', label: 'Polar', icon: 'track_changes' },
        { id: 'radar', label: 'Radar', icon: 'hub' }
    ];

    palettesList: { id: ChartPalette; label: string; preview: string[] }[] = [
        { id: 'default', label: 'Vibrant Classic', preview: ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981'] },
        { id: 'emerald', label: 'Emerald Mint', preview: ['#10b981', '#059669', '#34d399', '#14b8a6'] },
        { id: 'sunset', label: 'Sunset Coral', preview: ['#f97316', '#fb923c', '#f43f5e', '#e11d48'] },
        { id: 'cyber', label: 'Cyber Neon', preview: ['#8b5cf6', '#06b6d4', '#ec4899', '#3b82f6'] },
        { id: 'ocean', label: 'Deep Ocean', preview: ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6'] },
        { id: 'monochrome', label: 'High Contrast', preview: ['#ffffff', '#a1a1aa', '#52525b', '#18181b'] }
    ];

    availableAppSources = computed(() => {
        const assets = this.analyticsBuilder.assets() || [];
        const sources = new Set<string>();
        assets.forEach(item => {
            sources.add(getAssetAppSource(item));
        });
        return Array.from(sources).sort();
    });

    availableBanks = computed(() => {
        const txs = this.analyticsBuilder.transactions() || [];
        const banks = new Set<string>();
        txs.forEach(t => {
            if (t.bank) banks.add(t.bank);
        });
        return Array.from(banks).sort();
    });

    ngOnInit(): void {
        if (this.editConfig) {
            this.config.set({
                ...this.editConfig,
                filters: {
                    ...this.editConfig.filters,
                    categories: this.editConfig.filters.categories ? [...this.editConfig.filters.categories] : undefined,
                    assetTypes: this.editConfig.filters.assetTypes ? [...this.editConfig.filters.assetTypes] : undefined,
                    appSources: this.editConfig.filters.appSources ? [...this.editConfig.filters.appSources] : undefined,
                    banks: this.editConfig.filters.banks ? [...this.editConfig.filters.banks] : undefined,
                    dateRange: this.editConfig.filters.dateRange ? { ...this.editConfig.filters.dateRange } : undefined
                }
            });
        }
    }

    applyTemplate(tmpl: Partial<CustomChartConfig>) {
        this.config.update(c => ({
            ...c,
            ...tmpl,
            id: c.id, // Preserve existing ID if editing
            filters: { ...tmpl.filters }
        }));
    }

    validationError = computed(() => {
        const c = this.config();
        if (!c.title.trim()) return 'Chart title is required.';
        if (c.displayType === 'chart') {
            if ((c.chartType === 'pie' || c.chartType === 'doughnut') && c.dimension === 'Time') {
                return 'Pie & Donut charts are not suitable for chronological Time data. Please use Bar, Line, or Area.';
            }
        }
        return null;
    });

    previewData = computed(() => {
        const c = this.config();
        if (this.validationError()) return null;
        return this.analyticsBuilder.buildChartData(c)();
    });

    updateConfig(key: keyof CustomChartConfig, value: any) {
        this.config.update(c => ({ ...c, [key]: value }));
    }

    setDatePreset(preset: string) {
        this.config.update(c => {
            const currentDr = c.filters.dateRange || {};
            return {
                ...c,
                filters: {
                    ...c.filters,
                    dateRange: {
                        ...currentDr,
                        preset: preset as any,
                        startDate: preset === 'custom' ? currentDr.startDate : undefined,
                        endDate: preset === 'custom' ? currentDr.endDate : undefined
                    }
                }
            };
        });
    }

    setStartDate(val: string) {
        this.config.update(c => ({
            ...c,
            filters: {
                ...c.filters,
                dateRange: {
                    ...(c.filters.dateRange || {}),
                    preset: 'custom',
                    startDate: val || undefined
                }
            }
        }));
    }

    setEndDate(val: string) {
        this.config.update(c => ({
            ...c,
            filters: {
                ...c.filters,
                dateRange: {
                    ...(c.filters.dateRange || {}),
                    preset: 'custom',
                    endDate: val || undefined
                }
            }
        }));
    }

    toggleCategory(cat: string) {
        this.config.update(c => {
            const current = c.filters.categories || [];
            const next = current.includes(cat) ? current.filter(x => x !== cat) : [...current, cat];
            return {
                ...c,
                filters: { ...c.filters, categories: next.length ? next : undefined }
            };
        });
    }

    toggleBank(bank: string) {
        this.config.update(c => {
            const current = c.filters.banks || [];
            const next = current.includes(bank) ? current.filter(x => x !== bank) : [...current, bank];
            return {
                ...c,
                filters: { ...c.filters, banks: next.length ? next : undefined }
            };
        });
    }

    toggleAssetType(type: AssetType) {
        this.config.update(c => {
            const current = c.filters.assetTypes || [];
            const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type];
            return {
                ...c,
                filters: { ...c.filters, assetTypes: next.length ? next : undefined }
            };
        });
    }

    toggleAppSource(source: string) {
        this.config.update(c => {
            const current = c.filters.appSources || [];
            const next = current.includes(source) ? current.filter(s => s !== source) : [...current, source];
            return {
                ...c,
                filters: { ...c.filters, appSources: next.length ? next : undefined }
            };
        });
    }

    save() {
        if (this.validationError()) return;
        this.analyticsBuilder.saveConfig(this.config());
        this.close.emit();
    }

    cancel() {
        this.close.emit();
    }
}
