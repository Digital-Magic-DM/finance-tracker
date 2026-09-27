import { Component, inject, signal, computed, output, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportDataService, ParsedImportRow, ImportPlatform } from '../../../services/import-data.service';
import { AssetService } from '../../../services/asset.service';
import { SnackbarService } from '../../../services/snackbar.service';

@Component({
    selector: 'app-import-data',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './import-data.component.html',
    styleUrl: './import-data.component.scss',
})
export class ImportDataComponent {
    private importService = inject(ImportDataService);
    private assetService = inject(AssetService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);
    private snackbar = inject(SnackbarService);

    closed = output<void>();
    imported = output<number>();

    step = signal<'upload' | 'preview' | 'done'>('upload');
    detectedPlatform = signal<ImportPlatform>('unknown');
    rows = signal<ParsedImportRow[]>([]);
    importing = signal(false);
    importedCount = signal(0);
    updatedCount = signal(0);
    skippedCount = signal(0);
    dragOver = signal(false);
    error = signal('');
    fileName = signal('');

    // Strategy for existing matching assets: 'update' | 'create' | 'skip'
    duplicateMode = signal<'update' | 'create' | 'skip'>('update');
    showActionModal = signal(false);

    existingCount = computed(() => this.rows().filter(r => r.selected && r.isDuplicate).length);
    newCount = computed(() => this.rows().filter(r => r.selected && !r.isDuplicate).length);

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
        if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
            this.error.set('Please upload a CSV, Excel (.xlsx / .xls), or PDF holding statement.');
            return;
        }
        this.error.set('');
        this.fileName.set(file.name);

        try {
            const result = await this.importService.parseFile(file);
            const existingAssets = await this.assetService.getAssetsSnapshot();
            const matchedRows = this.importService.matchWithExisting(result.rows, existingAssets);

            this.ngZone.run(() => {
                this.detectedPlatform.set(result.platform);

                if (matchedRows.length === 0) {
                    this.error.set('No valid data found. Please check the file format.');
                    return;
                }

                this.rows.set(matchedRows);
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
        if (p === 'indmoney-us') return 'INDmoney (US Stocks)';
        if (p === 'indmoney-pdf') return 'INDmoney (PDF Statement)';
        if (p === 'cdsl-pdf') return 'CDSL / NSDL (PDF Statement)';
        return 'CSV / Excel';
    }

    setDuplicateMode(mode: 'update' | 'create' | 'skip') {
        this.duplicateMode.set(mode);
    }

    onImportClick() {
        if (this.importing() || this.selectedCount === 0) return;

        // If existing assets are present, show prompt modal asking how to handle them
        if (this.existingCount() > 0) {
            this.showActionModal.set(true);
        } else {
            this.confirmImport();
        }
    }

    async confirmImport(mode?: 'update' | 'create' | 'skip') {
        if (mode) {
            this.duplicateMode.set(mode);
        }
        this.showActionModal.set(false);

        if (this.importing()) return;
        this.importing.set(true);
        this.error.set('');

        try {
            const { created, updated, skipped } = await this.importService.importAssets(
                this.rows(),
                this.duplicateMode()
            );

            this.ngZone.run(() => {
                this.importedCount.set(created);
                this.updatedCount.set(updated);
                this.skippedCount.set(skipped);
                this.step.set('done');
                this.importing.set(false);
                this.cdr.markForCheck();
                this.imported.emit(created + updated);

                let msg = '✅ Import complete!';
                if (created > 0 && updated > 0) {
                    msg = `✅ Import complete! ${created} added, ${updated} updated.`;
                } else if (updated > 0) {
                    msg = `✅ Updated ${updated} existing asset${updated !== 1 ? 's' : ''}!`;
                } else {
                    msg = `✅ Added ${created} new asset${created !== 1 ? 's' : ''}!`;
                }
                this.snackbar.show(msg, 'success');
            });
        } catch (err: any) {
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
        this.fileName.set('');
        this.importedCount.set(0);
        this.updatedCount.set(0);
        this.skippedCount.set(0);
        this.showActionModal.set(false);
    }
}
