import { Component, inject, signal, output, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportDataService, ParsedImportRow, ImportPlatform } from '../../../services/import-data.service';

@Component({
    selector: 'app-import-data',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './import-data.component.html',
    styleUrl: './import-data.component.scss',
})
export class ImportDataComponent {
    private importService = inject(ImportDataService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    closed = output<void>();
    imported = output<number>();

    step = signal<'upload' | 'preview' | 'done'>('upload');
    detectedPlatform = signal<ImportPlatform>('unknown');
    rows = signal<ParsedImportRow[]>([]);
    importing = signal(false);
    importedCount = signal(0);
    updatedCount = signal(0);
    dragOver = signal(false);
    error = signal('');
    fileName = signal('');

    onDragOver(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        this.dragOver.set(true);
    }

    onDragLeave(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        this.dragOver.set(false);
    }

    onDrop(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        this.dragOver.set(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) this.processFile(file);
    }

    onFileSelected(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) this.processFile(file);
    }

    private async processFile(file: File) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
            this.error.set('Please upload a CSV or Excel (.xlsx / .xls) file.');
            return;
        }
        this.error.set('');
        this.fileName.set(file.name);

        try {
            const result = await this.importService.parseFile(file);
            this.ngZone.run(() => {
                this.detectedPlatform.set(result.platform);

                if (result.rows.length === 0) {
                    this.error.set('No valid data found. Please check the file format.');
                    return;
                }

                this.rows.set(result.rows);
                this.step.set('preview');
                this.cdr.markForCheck();
            });
        } catch (err: any) {
            this.ngZone.run(() => {
                this.error.set(err?.message || 'Failed to parse file. Please check the format.');
                this.cdr.markForCheck();
            });
        }
    }

    toggleRow(index: number) {
        this.rows.update(rows => {
            const copy = [...rows];
            copy[index] = { ...copy[index], selected: !copy[index].selected };
            return copy;
        });
    }

    toggleAll() {
        const allSelected = this.rows().every(r => r.selected);
        this.rows.update(rows => rows.map(r => ({ ...r, selected: !allSelected })));
    }

    get selectedCount(): number {
        return this.rows().filter(r => r.selected).length;
    }

    get platformLabel(): string {
        const p = this.detectedPlatform();
        if (p === 'groww-stock') return 'Groww (Stocks)';
        if (p === 'groww-mf') return 'Groww (Mutual Funds)';
        if (p === 'indmoney') return 'INDmoney';
        return 'CSV / Excel';
    }

    async confirmImport() {
        if (this.importing()) return;
        console.log('[ImportComponent] confirmImport called, selected:', this.selectedCount);
        this.importing.set(true);
        this.error.set('');
        try {
            console.log('[ImportComponent] Calling importAssets...');
            const { created, updated } = await this.importService.importAssets(this.rows());
            console.log('[ImportComponent] Import result:', { created, updated });
            this.ngZone.run(() => {
                this.importedCount.set(created);
                this.updatedCount.set(updated);
                this.step.set('done');
                this.importing.set(false);
                this.cdr.markForCheck();
                this.imported.emit(created + updated);
            });
        } catch (err: any) {
            console.error('[ImportComponent] Import error:', err);
            this.ngZone.run(() => {
                this.error.set(err?.message || 'Import failed. Please try again.');
                this.importing.set(false);
                this.cdr.markForCheck();
            });
        }
    }

    close() {
        this.closed.emit();
    }

    reset() {
        this.step.set('upload');
        this.rows.set([]);
        this.error.set('');
        this.importedCount.set(0);
        this.updatedCount.set(0);
        this.fileName.set('');
    }
}
