import {
    Component, Input, OnChanges, AfterViewInit,
    ElementRef, ViewChild, OnDestroy, inject, effect
} from '@angular/core';
import {
    Chart, DoughnutController, ArcElement, Tooltip, Legend
} from 'chart.js';
import { AssetAllocation } from '../../models/finance.models';
import { ThemeService } from '../../services/theme.service';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

@Component({
    selector: 'app-portfolio-chart',
    standalone: true,
    template: `<div class="chart-wrap"><canvas #canvas></canvas></div>`,
    styles: [`
    .chart-wrap { display: flex; align-items: center; justify-content: center; padding: 10px; height: 240px; }
    canvas { max-height: 240px; }
  `],
})
export class PortfolioChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @Input() allocations: AssetAllocation[] = [];

    private themeService = inject(ThemeService);
    private chart?: Chart;

    constructor() {
        effect(() => {
            if (this.themeService.isDark() !== undefined && this.chart) {
                this.updateChart();
            }
        });
    }

    ngAfterViewInit() { this.buildChart(); }

    ngOnChanges() { if (this.chart) this.updateChart(); }

    ngOnDestroy() { this.chart?.destroy(); }

    private buildChart() {
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;
        const isDark = this.themeService.isDark();
        const legendColor = isDark ? '#f1f5f9' : '#1e293b';

        this.chart = new Chart(ctx, {
            type: 'doughnut',
            data: this.getChartData(),
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                animation: {
                    duration: 0 // Faster updates when colors change or data refreshes
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: legendColor,
                            font: { family: 'Inter', size: 11, weight: 600 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyleWidth: 8,
                            generateLabels: (chart) => {
                                const data = chart.data;
                                if (!data.labels?.length || !data.datasets.length) return [];
                                const dataset = data.datasets[0];
                                const total = (dataset.data as number[]).reduce((s, v) => s + (Number(v) || 0), 0);
                                const darkNow = this.themeService.isDark();
                                const fontColor = darkNow ? '#f1f5f9' : '#1e293b';
                                return data.labels.map((label, i) => {
                                    const val = Number(dataset.data[i]) || 0;
                                    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                                    return {
                                        text: `${label} (${pct}%)`,
                                        fillStyle: (dataset.backgroundColor as string[])[i],
                                        strokeStyle: darkNow ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                                        lineWidth: 1,
                                        pointStyle: 'circle',
                                        hidden: isNaN(val) || (chart as any)._hiddenIndices?.[i],
                                        index: i,
                                        fontColor: fontColor
                                    };
                                });
                            }
                        },
                    },
                    tooltip: {
                        backgroundColor: isDark ? '#111111' : '#ffffff',
                        titleColor: isDark ? '#f8fafc' : '#0f172a',
                        bodyColor: isDark ? '#e2e8f0' : '#334155',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                        borderWidth: 1,
                        padding: 10,
                        boxPadding: 4,
                        usePointStyle: true,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw as number;
                                const total = (ctx.chart.data.datasets[0].data as number[]).reduce((s, v) => s + (Number(v) || 0), 0);
                                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                                return ` ₹${val.toLocaleString('en-IN')} (${pct}%)`;
                            },
                        },
                    },
                },
            },
        });
    }

    private resolveColor(color: string): string {
        if (color.startsWith('var(')) {
            const varName = color.substring(4, color.length - 1);
            return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888888';
        }
        return color;
    }

    private getChartData() {
        const isDark = this.themeService.isDark();
        return {
            labels: this.allocations.map((a) => a.label),
            datasets: [{
                data: this.allocations.map((a) => a.value),
                backgroundColor: this.allocations.map((a) => this.resolveColor(a.color)),
                hoverBackgroundColor: this.allocations.map((a) => this.resolveColor(a.color) + 'CC'),
                borderWidth: 2,
                borderColor: isDark ? '#000000' : '#ffffff',
                hoverBorderColor: isDark ? '#ffffff' : '#000000',
                hoverOffset: 6,
            }],
        };
    }

    private updateChart() {
        if (!this.chart) return;
        const isDark = this.themeService.isDark();
        const legendColor = isDark ? '#f1f5f9' : '#1e293b';

        // Update legend color
        if (this.chart.options.plugins?.legend?.labels) {
            this.chart.options.plugins.legend.labels.color = legendColor;
        }

        // Update tooltip colors
        if (this.chart.options.plugins?.tooltip) {
            this.chart.options.plugins.tooltip.backgroundColor = isDark ? '#111111' : '#ffffff';
            this.chart.options.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
            this.chart.options.plugins.tooltip.bodyColor = isDark ? '#e2e8f0' : '#334155';
            this.chart.options.plugins.tooltip.borderColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
        }
        
        // Update data and colors
        this.chart.data = this.getChartData();
        
        this.chart.update('none');
    }
}
