import { Component, Input, OnChanges, AfterViewInit, ElementRef, ViewChild, OnDestroy, inject, effect } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { ThemeService } from '../../services/theme.service';

Chart.register(...registerables);

@Component({
    selector: 'app-dynamic-chart',
    standalone: true,
    templateUrl: './dynamic-chart.component.html',
    styleUrl: './dynamic-chart.component.scss',
})
export class DynamicChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;
    
    @Input() chartType: 'bar' | 'line' | 'pie' | 'doughnut' = 'bar';
    @Input() labels: string[] = [];
    @Input() dataset: number[] = [];
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
        if (this.labels.length > 0) this.buildChart(); 
    }
    
    ngOnChanges() { 
        if (this.chart) {
            this.chart.destroy(); 
            this.chart = undefined;
        }
        if (this.labels.length > 0) {
            // Need setTimeout to allow the view to render the canvas if transitioning from empty state
            setTimeout(() => this.buildChart(), 0);
        }
    }
    
    ngOnDestroy() { 
        this.chart?.destroy(); 
    }

    private resolveColor(varName: string, fallback: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
    }

    private buildChart() {
        if (!this.canvasRef) return;
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const textColor = this.resolveColor('--text-muted', '#666666');
        const borderColor = this.resolveColor('--border-light', 'rgba(0,0,0,0.1)');
        const primaryColor = this.resolveColor('--text-primary', '#000000');
        const bgPrimary = this.resolveColor('--bg-card', '#ffffff');

        const colorPalette = [
            primaryColor,
            this.resolveColor('--asset-stock', '#FF5252'),
            this.resolveColor('--asset-mf', '#FF4081'),
            this.resolveColor('--asset-etf', '#E040FB'),
            this.resolveColor('--asset-gold', '#FFD740'),
            this.resolveColor('--asset-cash', '#69F0AE'),
            this.resolveColor('--asset-re', '#40C4FF'),
            this.resolveColor('--text-secondary', '#888'),
            '#333', '#aaa', '#4a4a4a', '#8a8a8a', '#111'
        ];

        const isCircular = this.chartType === 'pie' || this.chartType === 'doughnut';

        this.chart = new Chart(ctx, {
            type: this.chartType,
            data: {
                labels: this.labels,
                datasets: [{
                    data: this.dataset,
                    backgroundColor: isCircular ? colorPalette : primaryColor,
                    borderColor: isCircular ? bgPrimary : primaryColor,
                    borderWidth: isCircular ? 2 : 2,
                    borderRadius: this.chartType === 'bar' ? 0 : 0 // brutalist
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: isCircular,
                        position: 'right',
                        labels: { color: textColor, font: { family: 'Inter', size: 10, weight: 600 } }
                    },
                    tooltip: {
                        backgroundColor: bgPrimary,
                        titleColor: primaryColor,
                        bodyColor: this.resolveColor('--text-secondary', '#333'),
                        borderColor: primaryColor,
                        borderWidth: 2,
                        padding: 12,
                        cornerRadius: 0,
                    },
                },
                scales: isCircular ? {} : {
                    x: {
                        grid: { color: borderColor, display: false },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 }, maxRotation: 45, minRotation: 0 },
                        border: { display: true, color: primaryColor }
                    },
                    y: {
                        grid: { color: borderColor },
                        ticks: {
                            color: textColor,
                            font: { family: 'Inter', size: 10 },
                            callback: (val) => '₹' + (Number(val) / 1000).toFixed(0) + 'k',
                        },
                        border: { display: false }
                    },
                },
                elements: this.chartType === 'line' ? {
                    point: { radius: 0, hoverRadius: 6, backgroundColor: primaryColor, borderWidth: 2, borderColor: bgPrimary },
                    line: { tension: 0, borderWidth: 3 }, // Brutal tension 0
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
