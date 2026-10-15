import { Component, Input, OnChanges, AfterViewInit, ElementRef, ViewChild, OnDestroy, inject, effect } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { ThemeService } from '../../services/theme.service';
import { ChartPalette, ChartType } from '../../models/finance.models';

Chart.register(...registerables);

export interface DynamicChartDataset {
    label?: string;
    data: number[];
    backgroundColor?: any;
    borderColor?: any;
    borderWidth?: number;
    fill?: boolean;
    tension?: number;
    borderRadius?: number;
    type?: any;
}

@Component({
    selector: 'app-dynamic-chart',
    standalone: true,
    templateUrl: './dynamic-chart.component.html',
    styleUrl: './dynamic-chart.component.scss',
})
export class DynamicChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;
    
    @Input() chartType: ChartType = 'bar';
    @Input() labels: string[] = [];
    @Input() dataset: number[] = [];
    @Input() datasets?: DynamicChartDataset[];
    @Input() palette: ChartPalette = 'default';
    @Input() showLegend?: boolean;
    @Input() isCurrency = true;
    @Input() height = 240;

    private themeService = inject(ThemeService);
    private chart?: Chart;

    constructor() {
        effect(() => {
            if (this.themeService.isDark() !== undefined && this.chart) {
                this.updateChart();
            }
        });
    }

    ngAfterViewInit() { 
        if (this.hasData()) this.buildChart(); 
    }
    
    ngOnChanges() { 
        if (this.chart) {
            this.chart.destroy(); 
            this.chart = undefined;
        }
        if (this.hasData()) {
            setTimeout(() => this.buildChart(), 0);
        }
    }
    
    ngOnDestroy() { 
        this.chart?.destroy(); 
    }

    public hasData(): boolean {
        if (this.datasets && this.datasets.length > 0) {
            return this.datasets.some(d => d.data && d.data.length > 0);
        }
        return this.labels.length > 0 && this.dataset.length > 0;
    }

    private resolveColor(varName: string, fallback: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
    }

    private getPaletteColors(isDark: boolean): string[] {
        switch (this.palette) {
            case 'emerald':
                return ['#10b981', '#059669', '#34d399', '#14b8a6', '#6ee7b7', '#047857', '#0d9488', '#2dd4bf'];
            case 'sunset':
                return ['#f97316', '#fb923c', '#f43f5e', '#e11d48', '#f59e0b', '#fbbf24', '#ea580c', '#be123c'];
            case 'cyber':
                return ['#8b5cf6', '#06b6d4', '#ec4899', '#3b82f6', '#a855f7', '#6366f1', '#d946ef', '#14b8a6'];
            case 'ocean':
                return ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#38bdf8', '#22d3ee', '#2563eb', '#0891b2'];
            case 'monochrome':
                return isDark
                    ? ['#ffffff', '#e4e4e7', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155']
                    : ['#000000', '#18181b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'];
            case 'default':
            default:
                return [
                    isDark ? '#38bdf8' : '#000000',
                    this.resolveColor('--asset-stock', '#3b82f6'),
                    this.resolveColor('--asset-mf', '#8b5cf6'),
                    this.resolveColor('--asset-etf', '#ec4899'),
                    this.resolveColor('--asset-gold', '#eab308'),
                    this.resolveColor('--asset-cash', '#10b981'),
                    this.resolveColor('--asset-bond', '#14b8a6'),
                    this.resolveColor('--asset-us-stock', '#06b6d4'),
                    this.resolveColor('--asset-re', '#f97316'),
                    '#6366f1', '#64748b', '#d97706'
                ];
        }
    }

    private buildChart() {
        if (!this.canvasRef) return;
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const isDark = this.themeService.isDark();
        const textColor = isDark ? '#cbd5e1' : '#475569';
        const legendColor = isDark ? '#f1f5f9' : '#1e293b';
        const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
        const bgCard = isDark ? '#111111' : '#ffffff';

        const paletteColors = this.getPaletteColors(isDark);
        const primaryColor = paletteColors[0];

        const isCircular = this.chartType === 'pie' || this.chartType === 'doughnut';
        const isRadial = this.chartType === 'polarArea' || this.chartType === 'radar';
        const isArea = this.chartType === 'area';
        const actualType = (isArea ? 'line' : this.chartType) as keyof import('chart.js').ChartTypeRegistry;

        const shouldDisplayLegend = this.showLegend !== undefined 
            ? this.showLegend 
            : (isCircular || isRadial || (this.datasets && this.datasets.length > 1));

        let chartDatasets: any[] = [];

        if (this.datasets && this.datasets.length > 0) {
            chartDatasets = this.datasets.map((ds, idx) => {
                const color = ds.borderColor || ds.backgroundColor || paletteColors[idx % paletteColors.length];
                return {
                    label: ds.label || `Series ${idx + 1}`,
                    data: ds.data,
                    backgroundColor: ds.backgroundColor || (isArea || ds.fill ? `${color}33` : color),
                    borderColor: ds.borderColor || color,
                    borderWidth: ds.borderWidth !== undefined ? ds.borderWidth : 2,
                    fill: ds.fill !== undefined ? ds.fill : isArea,
                    tension: ds.tension !== undefined ? ds.tension : 0.3,
                    borderRadius: ds.borderRadius !== undefined ? ds.borderRadius : (actualType === 'bar' ? 4 : 0),
                    type: ds.type
                };
            });
        } else {
            let bg: any = primaryColor;
            let border: any = primaryColor;

            if (isCircular || isRadial) {
                bg = paletteColors;
                border = isDark ? '#0d0d0d' : '#ffffff';
            } else if (isArea) {
                // Gradient fill for area charts
                const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
                gradient.addColorStop(0, `${primaryColor}66`); // 40% opacity
                gradient.addColorStop(1, `${primaryColor}05`); // 2% opacity
                bg = gradient;
                border = primaryColor;
            }

            chartDatasets = [{
                data: this.dataset,
                backgroundColor: bg,
                borderColor: border,
                borderWidth: isCircular ? 2 : (actualType === 'bar' ? 1.5 : 2.5),
                borderRadius: actualType === 'bar' ? 4 : 0,
                fill: isArea,
                tension: actualType === 'line' || isArea ? 0.3 : 0
            }];
        }

        // Setup Scales based on chart family
        let scalesConfig: any = {};
        if (isRadial) {
            scalesConfig = {
                r: {
                    grid: { color: borderColor },
                    angleLines: { color: borderColor },
                    ticks: {
                        color: textColor,
                        backdropColor: 'transparent',
                        font: { family: 'Inter', size: 10, weight: 600 }
                    }
                }
            };
        } else if (!isCircular) {
            scalesConfig = {
                x: {
                    grid: { color: borderColor, display: false },
                    ticks: { 
                        color: textColor, 
                        font: { family: 'Inter', size: 10, weight: 600 }, 
                        maxRotation: 45, 
                        minRotation: 0 
                    },
                    border: { display: true, color: borderColor }
                },
                y: {
                    grid: { color: borderColor },
                    ticks: {
                        color: textColor,
                        font: { family: 'Inter', size: 10, weight: 600 },
                        callback: (val: any) => {
                            if (!this.isCurrency) return val;
                            const num = Number(val);
                            if (Math.abs(num) >= 10000000) return '₹' + (num / 10000000).toFixed(1) + 'Cr';
                            if (Math.abs(num) >= 100000) return '₹' + (num / 100000).toFixed(1) + 'L';
                            if (Math.abs(num) >= 1000) return '₹' + (num / 1000).toFixed(0) + 'k';
                            return '₹' + num;
                        },
                    },
                    border: { display: false }
                },
            };
        }

        this.chart = new Chart(ctx, {
            type: actualType,
            data: {
                labels: this.labels,
                datasets: chartDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: shouldDisplayLegend,
                        position: isCircular || isRadial ? 'right' : 'top',
                        labels: { 
                            color: legendColor, 
                            font: { family: 'Inter', size: 11, weight: 600 },
                            usePointStyle: true,
                            boxWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: bgCard,
                        titleColor: isDark ? '#f8fafc' : '#0f172a',
                        bodyColor: isDark ? '#cbd5e1' : '#334155',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            label: (context) => {
                                const label = context.dataset.label || context.label || '';
                                const rawVal = context.raw as number;
                                if (!this.isCurrency) return ` ${label}: ${rawVal.toLocaleString()}`;
                                return ` ${label}: ₹${Math.round(rawVal).toLocaleString('en-IN')}`;
                            }
                        }
                    },
                },
                scales: scalesConfig,
                elements: actualType === 'line' || isArea ? {
                    point: { 
                        radius: 2, 
                        hoverRadius: 6, 
                        backgroundColor: primaryColor, 
                        borderWidth: 2, 
                        borderColor: bgCard 
                    },
                    line: { tension: 0.3 }
                } : {},
            },
        });
    }

    private updateChart() {
        if (!this.chart) return;
        this.chart.destroy();
        this.buildChart(); 
    }
}
