import {
    Component, Input, OnChanges, AfterViewInit,
    ElementRef, ViewChild, OnDestroy, inject, effect,
    signal, computed, SimpleChanges
} from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import {
    Chart, LineController, LineElement, PointElement,
    LinearScale, CategoryScale, Filler, Tooltip
} from 'chart.js';
import { NetWorthPoint } from '../../models/finance.models';
import { ThemeService } from '../../services/theme.service';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

export type NetworthPeriod = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
export type NetworthGrouping = 'ALL' | 'WEEK' | 'MONTH' | 'YEAR';

@Component({
    selector: 'app-networth-chart',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe],
    template: `
        <div class="networth-chart-container">
            <!-- Top Controls Toolbar -->
            <div class="chart-controls-bar">
                <div class="controls-left-group">
                    <!-- Period / Timeframe Selector -->
                    <div class="range-selector" role="group" aria-label="Time period selector">
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === '1W'" 
                            (click)="setPeriod('1W')"
                            title="Last 1 Week (7 Days)">
                            1W
                        </button>
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === '1M'" 
                            (click)="setPeriod('1M')"
                            title="Last 1 Month (30 Days)">
                            1M
                        </button>
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === '3M'" 
                            (click)="setPeriod('3M')"
                            title="Last 3 Months">
                            3M
                        </button>
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === '6M'" 
                            (click)="setPeriod('6M')"
                            title="Last 6 Months">
                            6M
                        </button>
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === '1Y'" 
                            (click)="setPeriod('1Y')"
                            title="Last 1 Year">
                            1Y
                        </button>
                        <button 
                            type="button" 
                            class="range-btn" 
                            [class.active]="selectedPeriod() === 'ALL'" 
                            (click)="setPeriod('ALL')"
                            title="All Time">
                            ALL
                        </button>
                    </div>

                    <!-- Granularity / Group By Selector -->
                    <div class="group-selector" role="group" aria-label="Aggregation granularity">
                        <span class="group-label">Group:</span>
                        <button 
                            type="button" 
                            class="group-btn" 
                            [class.active]="selectedGrouping() === 'ALL'" 
                            (click)="setGrouping('ALL')"
                            title="Daily / All raw points">
                            All
                        </button>
                        <button 
                            type="button" 
                            class="group-btn" 
                            [class.active]="selectedGrouping() === 'WEEK'" 
                            (click)="setGrouping('WEEK')"
                            title="Group by Weeks">
                            Weeks
                        </button>
                        <button 
                            type="button" 
                            class="group-btn" 
                            [class.active]="selectedGrouping() === 'MONTH'" 
                            (click)="setGrouping('MONTH')"
                            title="Group by Months">
                            Months
                        </button>
                        <button 
                            type="button" 
                            class="group-btn" 
                            [class.active]="selectedGrouping() === 'YEAR'" 
                            (click)="setGrouping('YEAR')"
                            title="Group by Years">
                            Years
                        </button>
                    </div>
                </div>

                <div class="period-badge-wrap">
                    @if (periodChange() !== 0) {
                        <span class="period-change-badge" [class.positive]="periodChange() >= 0" [class.negative]="periodChange() < 0">
                            {{ periodChange() >= 0 ? '▲ +' : '▼ -' }}{{ abs(periodChange()) | currency:'INR':'symbol':'1.0-0' }} ({{ periodChangePct() | number:'1.1-1' }}%)
                        </span>
                    }
                    <span class="period-badge">{{ periodSummaryLabel() }}</span>
                </div>
            </div>

            <!-- Legend & Interactive Track Toggles -->
            <div class="metric-legend-pills">
                <!-- Net Worth Pill -->
                <button 
                    type="button"
                    class="legend-pill networth-pill" 
                    [class.active]="showNetWorth()"
                    [class.muted]="!showNetWorth()"
                    (click)="toggleTrack('netWorth')"
                    title="Click to toggle Net Worth line">
                    <span class="pill-dot networth-dot"></span>
                    <div class="pill-meta">
                        <span class="pill-label">Net Worth</span>
                        <span class="pill-value">{{ currentNetWorth() | currency:'INR':'symbol':'1.0-0' }}</span>
                    </div>
                    <span class="material-icons toggle-icon">{{ showNetWorth() ? 'check' : 'add' }}</span>
                </button>

                <!-- Invested Pill -->
                <button 
                    type="button"
                    class="legend-pill invested-pill" 
                    [class.active]="showInvested()"
                    [class.muted]="!showInvested()"
                    (click)="toggleTrack('invested')"
                    title="Click to toggle Invested Amount line">
                    <span class="pill-dot invested-dot"></span>
                    <div class="pill-meta">
                        <span class="pill-label">Invested</span>
                        <span class="pill-value">{{ currentInvested() | currency:'INR':'symbol':'1.0-0' }}</span>
                    </div>
                    <span class="material-icons toggle-icon">{{ showInvested() ? 'check' : 'add' }}</span>
                </button>

                <!-- Profit Pill -->
                <button 
                    type="button"
                    class="legend-pill profit-pill" 
                    [class.active]="showProfit()"
                    [class.muted]="!showProfit()"
                    [class.negative]="currentProfit() < 0"
                    (click)="toggleTrack('profit')"
                    title="Click to toggle Profit line">
                    <span class="pill-dot profit-dot"></span>
                    <div class="pill-meta">
                        <span class="pill-label">Profit</span>
                        <span class="pill-value">
                            {{ currentProfit() >= 0 ? '+' : '' }}{{ currentProfit() | currency:'INR':'symbol':'1.0-0' }}
                            <span class="pill-sub-pct">({{ currentProfitPct() >= 0 ? '+' : '' }}{{ currentProfitPct() | number:'1.1-1' }}%)</span>
                        </span>
                    </div>
                    <span class="material-icons toggle-icon">{{ showProfit() ? 'check' : 'add' }}</span>
                </button>
            </div>

            <!-- Canvas Wrapper -->
            <div class="chart-canvas-wrap" [style.height.px]="height">
                <canvas #canvas></canvas>
            </div>
        </div>
    `,
    styles: [`
        .networth-chart-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            width: 100%;
        }

        .chart-controls-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }

        .controls-left-group {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }

        .range-selector, .group-selector {
            display: inline-flex;
            align-items: center;
            background: var(--bg-secondary, #fafafa);
            border: 1px solid var(--border-light, #e0e0e0);
            padding: 2px;
            gap: 2px;
            border-radius: 6px;

            .range-btn, .group-btn {
                background: transparent;
                border: none;
                padding: 4px 8px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
                color: var(--text-secondary, #94a3b8);
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;

                &:hover {
                    color: var(--text-primary);
                    background: rgba(128, 128, 128, 0.1);
                }

                &.active {
                    background: var(--text-primary);
                    color: var(--bg-primary);
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
                }
            }
        }

        .group-label {
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted);
            padding: 0 2px 0 6px;
        }

        .period-badge-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;

            .period-change-badge {
                font-size: 11px;
                font-weight: 700;
                padding: 3px 8px;
                border-radius: 12px;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                font-feature-settings: 'tnum';

                &.positive {
                    color: #10b981;
                    background: rgba(16, 185, 129, 0.12);
                    border: 1px solid rgba(16, 185, 129, 0.3);
                }

                &.negative {
                    color: #ef4444;
                    background: rgba(239, 68, 68, 0.12);
                    border: 1px solid rgba(239, 68, 68, 0.3);
                }
            }

            .period-badge {
                font-size: 11px;
                font-weight: 600;
                color: var(--text-muted);
                background: var(--bg-secondary, #f3f4f6);
                border: 1px solid var(--border-light, #e5e7eb);
                padding: 3px 8px;
                border-radius: 12px;
            }
        }

        .metric-legend-pills {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;

            @media (max-width: 600px) {
                gap: 6px;
            }
        }

        .legend-pill {
            flex: 1 1 auto;
            min-width: 110px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--bg-card);
            border: 1px solid var(--border-light, #e0e0e0);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: left;
            font-family: inherit;

            &:hover {
                border-color: var(--text-muted);
                transform: translateY(-1px);
            }

            &.muted {
                opacity: 0.45;
                border-style: dashed;
            }

            .pill-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .networth-dot {
                background: #0ea5e9;
            }

            .invested-dot {
                background: #8b5cf6;
            }

            .profit-dot {
                background: #10b981;
            }

            &.negative .profit-dot {
                background: #ef4444;
            }

            .pill-meta {
                display: flex;
                flex-direction: column;
                line-height: 1.2;
                flex: 1;
            }

            .pill-label {
                font-size: 10px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: var(--text-muted);
            }

            .pill-value {
                font-size: 12.5px;
                font-weight: 700;
                color: var(--text-primary);
                font-feature-settings: "tnum";
            }

            .pill-sub-pct {
                font-size: 11px;
                font-weight: 600;
                color: var(--accent-success-blend, #10b981);
                margin-left: 2px;
            }

            &.negative .pill-sub-pct {
                color: var(--accent-danger-blend, #ef4444);
            }

            .toggle-icon {
                font-size: 14px;
                color: var(--text-muted);
                margin-left: 2px;
            }

            @media (max-width: 600px) {
                padding: 5px 8px;
                .pill-label { font-size: 9px; }
                .pill-value { font-size: 11.5px; }
            }
        }

        .chart-canvas-wrap {
            position: relative;
            width: 100%;
        }

        canvas {
            max-width: 100%;
        }
    `]
})
export class NetworthChartComponent implements AfterViewInit, OnChanges, OnDestroy {
    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @Input() data: NetWorthPoint[] = [];
    @Input() height = 260;
    @Input() defaultPeriod: NetworthPeriod = 'ALL';

    private themeService = inject(ThemeService);
    private chart?: Chart;

    selectedPeriod = signal<NetworthPeriod>('ALL');
    selectedGrouping = signal<NetworthGrouping>('ALL');
    showNetWorth = signal(true);
    showInvested = signal(true);
    showProfit = signal(true);
    rawPoints = signal<NetWorthPoint[]>([]);

    filteredData = computed(() => {
        const inWindow = this.filterPoints(this.selectedPeriod(), this.rawPoints());
        return this.applyGrouping(inWindow, this.selectedGrouping());
    });

    currentNetWorth = computed(() => {
        const pts = this.filteredData();
        return pts.length ? pts[pts.length - 1].value : 0;
    });

    currentInvested = computed(() => {
        const pts = this.filteredData();
        return pts.length ? (pts[pts.length - 1].invested ?? pts[pts.length - 1].value) : 0;
    });

    currentProfit = computed(() => {
        const pts = this.filteredData();
        return pts.length ? (pts[pts.length - 1].profit ?? (this.currentNetWorth() - this.currentInvested())) : 0;
    });

    currentProfitPct = computed(() => {
        const inv = this.currentInvested();
        return inv > 0 ? (this.currentProfit() / inv) * 100 : 0;
    });

    periodChange = computed(() => {
        const pts = this.filteredData();
        if (pts.length < 2) return 0;
        const first = pts[0].value;
        const last = pts[pts.length - 1].value;
        return last - first;
    });

    periodChangePct = computed(() => {
        const pts = this.filteredData();
        if (pts.length < 2) return 0;
        const first = pts[0].value;
        if (first <= 0) return 0;
        return (this.periodChange() / first) * 100;
    });

    abs(val: number): number {
        return Math.abs(val);
    }

    periodSummaryLabel = computed(() => {
        const p = this.selectedPeriod();
        const g = this.selectedGrouping();
        const count = this.filteredData().length;
        let pLabel = 'All Time';
        if (p === '1W') pLabel = 'Last 1 Week';
        else if (p === '1M') pLabel = 'Last 1 Month';
        else if (p === '3M') pLabel = 'Last 3 Months';
        else if (p === '6M') pLabel = 'Last 6 Months';
        else if (p === '1Y') pLabel = 'Last 1 Year';

        let gLabel = '';
        if (g === 'WEEK') gLabel = ' · Weekly';
        else if (g === 'MONTH') gLabel = ' · Monthly';
        else if (g === 'YEAR') gLabel = ' · Yearly';

        return `${pLabel}${gLabel} (${count} pts)`;
    });

    constructor() {
        effect(() => {
            // Track reactive signals
            this.themeService.isDark();
            this.selectedPeriod();
            this.selectedGrouping();
            this.showNetWorth();
            this.showInvested();
            this.showProfit();
            this.filteredData();

            if (this.chart) {
                this.updateChart();
            }
        });
    }

    ngOnInit() {
        if (this.defaultPeriod) {
            this.selectedPeriod.set(this.defaultPeriod);
        }
        this.rawPoints.set(this.data || []);
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['data']) {
            this.rawPoints.set(this.data || []);
        }
    }

    ngAfterViewInit() {
        this.buildChart();
    }

    ngOnDestroy() {
        this.chart?.destroy();
    }

    setPeriod(period: NetworthPeriod) {
        this.selectedPeriod.set(period);
        if ((period === '1W' || period === '1M') && this.selectedGrouping() === 'YEAR') {
            this.selectedGrouping.set('ALL');
        }
    }

    setGrouping(grouping: NetworthGrouping) {
        this.selectedGrouping.set(grouping);
    }

    toggleTrack(track: 'netWorth' | 'invested' | 'profit') {
        const activeCount = (this.showNetWorth() ? 1 : 0) + (this.showInvested() ? 1 : 0) + (this.showProfit() ? 1 : 0);
        if (track === 'netWorth') {
            if (this.showNetWorth() && activeCount <= 1) return;
            this.showNetWorth.update(v => !v);
        } else if (track === 'invested') {
            if (this.showInvested() && activeCount <= 1) return;
            this.showInvested.update(v => !v);
        } else if (track === 'profit') {
            if (this.showProfit() && activeCount <= 1) return;
            this.showProfit.update(v => !v);
        }
    }

    private resolveColor(varName: string, fallback: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
    }

    private filterPoints(period: NetworthPeriod, allPoints: NetWorthPoint[]): NetWorthPoint[] {
        if (!allPoints || allPoints.length === 0) return [];
        if (period === 'ALL') return allPoints;

        const now = new Date();
        let cutoffDate = new Date();

        if (period === '1W') {
            cutoffDate.setDate(now.getDate() - 7);
        } else if (period === '1M') {
            cutoffDate.setMonth(now.getMonth() - 1);
        } else if (period === '3M') {
            cutoffDate.setMonth(now.getMonth() - 3);
        } else if (period === '6M') {
            cutoffDate.setMonth(now.getMonth() - 6);
        } else if (period === '1Y') {
            cutoffDate.setFullYear(now.getFullYear() - 1);
        }

        const cutoffStr = cutoffDate.toISOString().split('T')[0];
        const filtered = allPoints.filter(p => p.date >= cutoffStr);

        // If no points fall inside the window, return the last available point
        if (filtered.length === 0) {
            return [allPoints[allPoints.length - 1]];
        }

        // Anchor point at window boundary if prior point exists
        const priorPoints = allPoints.filter(p => p.date < cutoffStr);
        if (priorPoints.length > 0 && filtered[0].date > cutoffStr) {
            const lastPrior = priorPoints[priorPoints.length - 1];
            return [{
                date: cutoffStr,
                value: lastPrior.value,
                invested: lastPrior.invested,
                profit: lastPrior.profit
            }, ...filtered];
        }

        return filtered;
    }

    private applyGrouping(points: NetWorthPoint[], grouping: NetworthGrouping): NetWorthPoint[] {
        if (!points || points.length <= 1 || grouping === 'ALL') {
            return points;
        }

        if (grouping === 'WEEK') {
            const weekMap = new Map<string, NetWorthPoint>();
            for (const p of points) {
                const d = new Date(p.date);
                if (isNaN(d.getTime())) continue;
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d);
                monday.setDate(diff);
                const weekKey = monday.toISOString().split('T')[0];
                weekMap.set(weekKey, p);
            }
            const res = Array.from(weekMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            return res.length >= 2 ? res : points;
        }

        if (grouping === 'MONTH') {
            const monthMap = new Map<string, NetWorthPoint>();
            for (const p of points) {
                const monthKey = p.date.substring(0, 7);
                monthMap.set(monthKey, p);
            }
            const res = Array.from(monthMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            return res.length >= 2 ? res : points;
        }

        if (grouping === 'YEAR') {
            const yearMap = new Map<string, NetWorthPoint>();
            for (const p of points) {
                const yearKey = p.date.substring(0, 4);
                yearMap.set(yearKey, p);
            }
            const res = Array.from(yearMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            return res.length >= 2 ? res : points;
        }

        return points;
    }

    private formatAxisDate(dateStr: string): string {
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            const period = this.selectedPeriod();
            const grouping = this.selectedGrouping();

            if (grouping === 'YEAR') {
                return d.toLocaleDateString('en-IN', { year: 'numeric' });
            }
            if (grouping === 'MONTH') {
                return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
            }

            if (period === '1W') {
                return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
            }
            if (period === '1M') {
                return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            }

            const pts = this.filteredData();
            if (pts.length >= 2) {
                const first = new Date(pts[0].date).getTime();
                const last = new Date(pts[pts.length - 1].date).getTime();
                const days = (last - first) / (1000 * 3600 * 24);
                if (days > 365) {
                    return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
                }
            }
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        } catch {
            return dateStr;
        }
    }

    private formatINRCompact(val: number): string {
        const abs = Math.abs(val);
        const sign = val < 0 ? '-' : '';
        if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
        if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
        if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(0)}k`;
        return `${sign}₹${abs}`;
    }

    private buildChart() {
        if (!this.canvasRef?.nativeElement) return;
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        if (this.chart) {
            this.chart.destroy();
        }

        const pts = this.filteredData();
        const isDark = this.themeService.isDark();
        const textColor = isDark ? '#cbd5e1' : '#475569';
        const borderColor = this.resolveColor('--border-light', isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)');
        const networthColor = isDark ? '#38bdf8' : '#0284c7';
        const investedColor = isDark ? '#a78bfa' : '#7c3aed';
        const profitColor = this.currentProfit() >= 0 
            ? (isDark ? '#34d399' : '#059669') 
            : (isDark ? '#f87171' : '#dc2626');

        const networthGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        networthGrad.addColorStop(0, isDark ? 'rgba(56, 189, 248, 0.20)' : 'rgba(14, 165, 233, 0.15)');
        networthGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: pts.map(p => this.formatAxisDate(p.date)),
                datasets: [
                    {
                        label: 'Net Worth',
                        data: pts.map(p => p.value),
                        borderColor: networthColor,
                        backgroundColor: networthGrad,
                        fill: true,
                        tension: 0.25,
                        borderWidth: 2.5,
                        hidden: !this.showNetWorth(),
                        pointRadius: pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0),
                        pointHoverRadius: 6,
                        pointBackgroundColor: networthColor,
                        pointBorderColor: this.resolveColor('--bg-primary', '#ffffff'),
                        pointBorderWidth: 2,
                    },
                    {
                        label: 'Invested',
                        data: pts.map(p => p.invested ?? p.value),
                        borderColor: investedColor,
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.2,
                        borderWidth: 2,
                        borderDash: [5, 4],
                        hidden: !this.showInvested(),
                        pointRadius: pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0),
                        pointHoverRadius: 6,
                        pointBackgroundColor: investedColor,
                        pointBorderColor: this.resolveColor('--bg-primary', '#ffffff'),
                        pointBorderWidth: 2,
                    },
                    {
                        label: 'Profit',
                        data: pts.map(p => p.profit ?? (p.value - (p.invested ?? p.value))),
                        borderColor: profitColor,
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.25,
                        borderWidth: 2,
                        hidden: !this.showProfit(),
                        pointRadius: pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0),
                        pointHoverRadius: 6,
                        pointBackgroundColor: profitColor,
                        pointBorderColor: this.resolveColor('--bg-primary', '#ffffff'),
                        pointBorderWidth: 2,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: isDark ? '#111111' : '#ffffff',
                        titleColor: isDark ? '#f8fafc' : '#0f172a',
                        bodyColor: isDark ? '#cbd5e1' : '#334155',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                        borderWidth: 1,
                        padding: 10,
                        boxPadding: 4,
                        usePointStyle: true,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const pt = pts[idx];
                                if (pt) {
                                    try {
                                        const d = new Date(pt.date);
                                        if (!isNaN(d.getTime())) {
                                            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                                        }
                                    } catch {}
                                    return pt.date;
                                }
                                return items[0].label;
                            },
                            label: (ctx) => {
                                const val = Number(ctx.raw) || 0;
                                const sign = val >= 0 && ctx.dataset.label === 'Profit' ? '+' : '';
                                return ` ${ctx.dataset.label}: ${sign}₹${val.toLocaleString('en-IN')}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: borderColor, display: false },
                        ticks: {
                            color: textColor,
                            font: { family: 'Inter', size: 10, weight: 600 },
                            maxTicksLimit: 7,
                        },
                        border: { display: true, color: borderColor }
                    },
                    y: {
                        grid: { color: borderColor },
                        ticks: {
                            color: textColor,
                            font: { family: 'Inter', size: 10, weight: 600 },
                            callback: (val) => this.formatINRCompact(Number(val))
                        },
                        border: { display: false }
                    }
                }
            }
        });
    }

    private updateChart() {
        if (!this.chart || !this.canvasRef?.nativeElement) return;
        const ctx = this.canvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const pts = this.filteredData();
        const isDark = this.themeService.isDark();
        const textColor = isDark ? '#cbd5e1' : '#475569';
        const borderColor = this.resolveColor('--border-light', isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)');
        const networthColor = isDark ? '#38bdf8' : '#0284c7';
        const investedColor = isDark ? '#a78bfa' : '#7c3aed';
        const profitColor = this.currentProfit() >= 0 
            ? (isDark ? '#34d399' : '#059669') 
            : (isDark ? '#f87171' : '#dc2626');

        const networthGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        networthGrad.addColorStop(0, isDark ? 'rgba(56, 189, 248, 0.20)' : 'rgba(14, 165, 233, 0.15)');
        networthGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.chart.data.labels = pts.map(p => this.formatAxisDate(p.date));

        // Dataset 0: Net Worth
        if (this.chart.data.datasets[0]) {
            this.chart.data.datasets[0].data = pts.map(p => p.value);
            this.chart.data.datasets[0].borderColor = networthColor;
            this.chart.data.datasets[0].backgroundColor = networthGrad;
            this.chart.data.datasets[0].hidden = !this.showNetWorth();
            (this.chart.data.datasets[0] as any).pointRadius = pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0);
            (this.chart.data.datasets[0] as any).pointBackgroundColor = networthColor;
        }

        // Dataset 1: Invested
        if (this.chart.data.datasets[1]) {
            this.chart.data.datasets[1].data = pts.map(p => p.invested ?? p.value);
            this.chart.data.datasets[1].borderColor = investedColor;
            this.chart.data.datasets[1].hidden = !this.showInvested();
            (this.chart.data.datasets[1] as any).pointRadius = pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0);
            (this.chart.data.datasets[1] as any).pointBackgroundColor = investedColor;
        }

        // Dataset 2: Profit
        if (this.chart.data.datasets[2]) {
            this.chart.data.datasets[2].data = pts.map(p => p.profit ?? (p.value - (p.invested ?? p.value)));
            this.chart.data.datasets[2].borderColor = profitColor;
            this.chart.data.datasets[2].hidden = !this.showProfit();
            (this.chart.data.datasets[2] as any).pointRadius = pts.length <= 1 ? 5 : (pts.length <= 12 ? 3 : 0);
            (this.chart.data.datasets[2] as any).pointBackgroundColor = profitColor;
        }

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

        // Update tooltip
        if (this.chart.options.plugins?.tooltip) {
            const tooltip = this.chart.options.plugins.tooltip as any;
            tooltip.backgroundColor = isDark ? '#111111' : '#ffffff';
            tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
            tooltip.bodyColor = isDark ? '#cbd5e1' : '#334155';
            tooltip.borderColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
            if (tooltip.callbacks) {
                tooltip.callbacks.title = (items: any[]) => {
                    if (!items.length) return '';
                    const idx = items[0].dataIndex;
                    const pt = pts[idx];
                    if (pt) {
                        try {
                            const d = new Date(pt.date);
                            if (!isNaN(d.getTime())) {
                                return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                            }
                        } catch {}
                        return pt.date;
                    }
                    return items[0].label;
                };
            }
        }

        this.chart.update();
    }
}
