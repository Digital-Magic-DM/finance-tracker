import {
    Component, Input, OnChanges, AfterViewInit,
    ElementRef, ViewChild, OnDestroy
} from '@angular/core';
import {
    Chart, DoughnutController, ArcElement, Tooltip, Legend
} from 'chart.js';
import { AssetAllocation } from '../../models/finance.models';

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

    private chart?: Chart;

    ngAfterViewInit() { this.buildChart(); }

    ngOnChanges() { if (this.chart) this.updateChart(); }

    ngOnDestroy() { this.chart?.destroy(); }

    private buildChart() {
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;
        this.chart = new Chart(ctx, {
            type: 'doughnut',
            data: this.getChartData(),
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#8896b0',
                            font: { family: 'Inter', size: 12 },
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                        },
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw as number;
                                return ` ₹${val.toLocaleString('en-IN')} (${ctx.label})`;
                            },
                        },
                    },
                },
            },
        });
    }

    private getChartData() {
        return {
            labels: this.allocations.map((a) => a.label),
            datasets: [{
                data: this.allocations.map((a) => a.value),
                backgroundColor: this.allocations.map((a) => a.color),
                hoverBackgroundColor: this.allocations.map((a) => a.color + 'CC'),
                borderWidth: 2,
                borderColor: 'transparent',
                hoverBorderColor: 'transparent',
                hoverOffset: 6,
            }],
        };
    }

    private updateChart() {
        if (!this.chart) return;
        this.chart.data = this.getChartData();
        this.chart.update('active');
    }
}
