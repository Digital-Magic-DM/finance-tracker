import {
    Component, Input, OnChanges, AfterViewInit,
    ElementRef, ViewChild, OnDestroy
} from '@angular/core';
import {
    Chart, LineController, LineElement, PointElement,
    LinearScale, CategoryScale, Filler, Tooltip
} from 'chart.js';
import { NetWorthPoint } from '../../models/finance.models';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

@Component({
    selector: 'app-networth-chart',
    standalone: true,
    template: `<div class="chart-wrap" [style.height.px]="height"><canvas #canvas></canvas></div>`,
    styles: [`.chart-wrap { width: 100%; } canvas { max-width: 100%; }`],
})
export class NetworthChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @Input() data: NetWorthPoint[] = [];
    @Input() height = 240;

    private chart?: Chart;

    ngAfterViewInit() { this.buildChart(); }
    ngOnChanges() { if (this.chart) this.updateChart(); }
    ngOnDestroy() { this.chart?.destroy(); }

    private buildChart() {
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
        gradient.addColorStop(0, 'rgba(108, 99, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(108, 99, 255, 0.0)');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: this.getChartData(gradient),
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ₹${(ctx.raw as number).toLocaleString('en-IN')}`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#4a5568', font: { family: 'Inter', size: 11 }, maxTicksLimit: 8 },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: '#4a5568',
                            font: { family: 'Inter', size: 11 },
                            callback: (val) => '₹' + (Number(val) / 100000).toFixed(1) + 'L',
                        },
                    },
                },
                elements: {
                    point: { radius: 4, hoverRadius: 7, backgroundColor: '#6C63FF', borderWidth: 2, borderColor: '#fff' },
                    line: { tension: 0.4 },
                },
            },
        });
    }

    private getChartData(gradient?: CanvasGradient | string) {
        return {
            labels: this.data.map((d) => d.date),
            datasets: [{
                data: this.data.map((d) => d.value),
                borderColor: '#6C63FF',
                backgroundColor: gradient || 'rgba(108,99,255,0.1)',
                fill: true,
                borderWidth: 2,
            }],
        };
    }

    private updateChart() {
        if (!this.chart) return;
        this.chart.data.labels = this.data.map((d) => d.date);
        this.chart.data.datasets[0].data = this.data.map((d) => d.value);
        this.chart.update();
    }
}
