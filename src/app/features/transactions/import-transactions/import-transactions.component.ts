import { Component, inject, signal, output, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { TransactionImportService, ParsedTransactionRow } from '../../../services/transaction-import.service';
import { SnackbarService } from '../../../services/snackbar.service';

@Component({
    selector: 'app-import-transactions',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DatePipe],
    templateUrl: './import-transactions.component.html',
    styleUrl: './import-transactions.component.scss',
})
export class ImportTransactionsComponent {
    private importService = inject(TransactionImportService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);
    private snackbar = inject(SnackbarService);

    closed = output<void>();
    imported = output<number>();

    step = signal<'upload' | 'preview' | 'done'>('upload');
    rows = signal<ParsedTransactionRow[]>([]);
    importing = signal(false);
    importedCount = signal(0);
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
        if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
            this.error.set('Please upload a CSV, Excel, or PDF file.');
            return;
        }
        this.error.set('');
        this.fileName.set(file.name);

        try {
            const result = await this.importService.parseFile(file);
            this.ngZone.run(() => {
                if (result.rows.length === 0) {
                    this.error.set('No valid transaction data found. Please check the file format.');
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

    async confirmImport() {
        if (this.importing()) return;
        this.importing.set(true);
        this.error.set('');
        try {
            const { created } = await this.importService.importTransactions(this.rows());
            this.ngZone.run(() => {
                this.importedCount.set(created);
                this.step.set('done');
                this.importing.set(false);
                this.cdr.markForCheck();
                this.imported.emit(created);
                this.snackbar.show(
                    `✅ Import complete! ${created} transaction${created !== 1 ? 's' : ''} added successfully.`,
                    'success',
                );
            });
        } catch (err: any) {
            this.ngZone.run(() => {
                this.error.set(err?.message || 'Import failed. Please try again.');
                this.importing.set(false);
                this.cdr.markForCheck();
            });
        }
    }

    close() { this.closed.emit(); }

    reset() {
        this.step.set('upload');
        this.rows.set([]);
        this.error.set('');
        this.importedCount.set(0);
        this.fileName.set('');
    }
}
