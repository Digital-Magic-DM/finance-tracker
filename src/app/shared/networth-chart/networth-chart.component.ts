import {
    Component, Input, OnChanges, AfterViewInit,
    ElementRef, ViewChild, OnDestroy, inject, effect
} from '@angular/core';
import {
    Chart, LineController, LineElement, PointElement,
    LinearScale, CategoryScale, Filler, Tooltip
} from 'chart.js';
import { NetWorthPoint } from '../../models/finance.models';
import { ThemeService } from '../../services/theme.service';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

@Component({
    selector: 'app-networth-chart',
    standalone: true,
    template: `<div class="chart-wrap" [style.height.px]="height"><canvas #canvas></canvas></div>`,
    styles: [`.chart-wrap { width: 100%; height: auto; } canvas { max-width: 100%; }`],
})
export class NetworthChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @Input() data: NetWorthPoint[] = [];
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

    ngAfterViewInit() { this.buildChart(); }
    ngOnChanges() { if (this.chart) this.updateChart(); }
    ngOnDestroy() { this.chart?.destroy(); }

    private resolveColor(varName: string, fallback: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
    }

    private buildChart() {
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const textColor = this.resolveColor('--text-muted', '#666666');
        const borderColor = this.resolveColor('--border-light', 'rgba(0,0,0,0.1)');
        const primaryColor = this.resolveColor('--text-primary', '#000000');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: this.getChartData(primaryColor),
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: this.resolveColor('--bg-card', '#fff'),
                        titleColor: this.resolveColor('--text-primary', '#000'),
                        bodyColor: this.resolveColor('--text-secondary', '#333'),
                        borderColor: this.resolveColor('--border-color', '#000'),
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 0,
                        callbacks: {
                            label: (ctx) => ` ₹${(ctx.raw as number).toLocaleString('en-IN')}`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: borderColor, display: false },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10, weight: 600 }, maxTicksLimit: 8 },
                        border: { display: true, color: borderColor }
                    },
                    y: {
                        grid: { color: borderColor },
                        ticks: {
                            color: textColor,
                            font: { family: 'Inter', size: 10, weight: 600 },
                            callback: (val) => '₹' + (Number(val) / 100000).toFixed(1) + 'L',
                        },
                        border: { display: false }
                    },
                },
                elements: {
                    point: { 
                        radius: 0, 
                        hoverRadius: 6, 
                        backgroundColor: primaryColor, 
                        borderWidth: 2, 
                        borderColor: this.resolveColor('--bg-primary', '#fff') 
                    },
                    line: { tension: 0.1, borderWidth: 3 },
                },
            },
        });
    }

    private getChartData(color: string) {
        return {
            labels: this.data.map((d) => d.date),
            datasets: [{
                data: this.data.map((d) => d.value),
                borderColor: color,
                backgroundColor: 'transparent',
                fill: false,
            }],
        };
    }

    private updateChart() {
        if (!this.chart) return;
        
        const textColor = this.resolveColor('--text-muted', '#666666');
        const borderColor = this.resolveColor('--border-light', 'rgba(0,0,0,0.1)');
        const primaryColor = this.resolveColor('--text-primary', '#000000');
        const bgPrimary = this.resolveColor('--bg-primary', '#fff');

        // Update scales
        const xScale = this.chart.options.scales!['x'] as any;
        const yScale = this.chart.options.scales!['y'] as any;
        
        if (xScale) {
            xScale.ticks.color = textColor;
            if (xScale.grid) xScale.grid.color = borderColor;
            if (xScale.border) xScale.border.color = borderColor;
        }
        
        if (yScale) {
            yScale.ticks.color = textColor;
            if (yScale.grid) yScale.grid.color = borderColor;
        }

        // Update elements
        this.chart.options.elements!.point!.backgroundColor = primaryColor;
        this.chart.options.elements!.point!.borderColor = bgPrimary;

        // Update tooltip
        this.chart.options.plugins!.tooltip!.backgroundColor = this.resolveColor('--bg-card', '#fff');
        this.chart.options.plugins!.tooltip!.titleColor = primaryColor;
        this.chart.options.plugins!.tooltip!.bodyColor = this.resolveColor('--text-secondary', '#333');
        this.chart.options.plugins!.tooltip!.borderColor = this.resolveColor('--border-color', '#000');

        // Update data
        this.chart.data.labels = this.data.map((d) => d.date);
        this.chart.data.datasets[0].data = this.data.map((d) => d.value);
        this.chart.data.datasets[0].borderColor = primaryColor;
        
        this.chart.update('none'); // Update without animation for theme switch
    }
}
