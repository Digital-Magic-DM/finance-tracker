import { Component, EventEmitter, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomChartConfig } from '../../../models/finance.models';
import { AnalyticsBuilderService } from '../../../services/analytics-builder.service';
import { DynamicChartComponent } from '../../../shared/dynamic-chart/dynamic-chart.component';

@Component({
    selector: 'app-custom-analytics-builder',
    standalone: true,
    imports: [CommonModule, FormsModule, DynamicChartComponent],
    templateUrl: './custom-analytics-builder.component.html',
    styleUrl: './custom-analytics-builder.component.scss'
})
export class CustomAnalyticsBuilderComponent {
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
        limit: 10
    });

    validationError = computed(() => {
        const c = this.config();
        if (!c.title.trim()) return 'Title is required.';
        if (c.displayType === 'chart') {
            if ((c.chartType === 'pie' || c.chartType === 'doughnut') && c.dimension === 'Time') {
                return 'Pie/Doughnut charts are not suitable for Time series data. Use Bar or Line.';
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

    save() {
        if (this.validationError()) return;
        this.analyticsBuilder.saveConfig(this.config());
        this.close.emit();
    }

    cancel() {
        this.close.emit();
    }
}
