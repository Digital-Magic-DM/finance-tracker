import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { SnackbarService } from '../../services/snackbar.service';
import { Transaction, TransactionType, TRANSACTION_CATEGORIES } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportTransactionsComponent } from './import-transactions/import-transactions.component';
import { CustomSelectDirective } from '../../shared/directives/custom-select.directive';

@Component({
    selector: 'app-transactions',
    standalone: true,
    imports: [CommonModule, FormsModule, DatePipe, CurrencyPipe, ImportTransactionsComponent, CustomSelectDirective],
    templateUrl: './transactions.component.html',
    styleUrl: './transactions.component.scss',
})
export class TransactionsComponent {
    private txService = inject(TransactionService);
    private snackbar = inject(SnackbarService);

    all = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showModal = signal(false);
    showImport = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    filterType = signal<string>('All');
    searchQuery = signal('');
    fromDate = signal<string>('');
    toDate = signal<string>('');

    // Multi-select state
    selectMode = signal(false);
    selectedIds = signal<Set<string>>(new Set());
    selectedCount = computed(() => this.selectedIds().size);
    deleting = signal(false);
    showDeleteModal = signal(false);
    txPendingDeletion = signal<Transaction[]>([]);

    deleteTotalAmount = computed(() =>
        this.txPendingDeletion().reduce((sum, t) => sum + (t.amount || 0), 0)
    );

    txTypes = ['All', ...Object.values(TransactionType)];
    categories = TRANSACTION_CATEGORIES;
    banks = ['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'CBP', 'Cash', 'Other'];

    form = signal<Omit<Transaction, 'id'>>({
        type: TransactionType.Expense,
        amount: 0,
        description: '',
        category: 'Other',
        bank: '',
        date: new Date(),
        notes: '',
    });

    hasDateFilter = computed(() => !!(this.fromDate() || this.toDate()));

    filtered = computed(() => {
        let list = this.all();
        if (this.filterType() !== 'All') {
            list = list.filter((t) => t.type === this.filterType());
        }
        const q = this.searchQuery().toLowerCase();
        if (q) {
            list = list.filter(
                (t) => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
            );
        }
        const from = this.fromDate();
        const to = this.toDate();
        if (from) {
            const fromMs = new Date(from).setHours(0, 0, 0, 0);
            list = list.filter((t) => this.formatDate(t.date).getTime() >= fromMs);
        }
        if (to) {
            const toMs = new Date(to).setHours(23, 59, 59, 999);
            list = list.filter((t) => this.formatDate(t.date).getTime() <= toMs);
        }
        return list.sort((a, b) => this.formatDate(b.date).getTime() - this.formatDate(a.date).getTime());
    });

    totalIncome = computed(() =>
        this.all().filter((t) => t.type === TransactionType.Income || t.type === TransactionType.Sell)
            .reduce((s, t) => s + t.amount, 0)
    );

    totalExpense = computed(() =>
        this.all().filter((t) => t.type === TransactionType.Expense || t.type === TransactionType.Buy)
            .reduce((s, t) => s + t.amount, 0)
    );

    monthlyIncome = computed(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        return this.all().filter((t) => {
            const d = this.formatDate(t.date);
            return (t.type === TransactionType.Income || t.type === TransactionType.Sell) &&
                d.getMonth() === month && d.getFullYear() === year;
        }).reduce((s, t) => s + t.amount, 0);
    });

    monthlyExpense = computed(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        return this.all().filter((t) => {
            const d = this.formatDate(t.date);
            return (t.type === TransactionType.Expense || t.type === TransactionType.Buy) &&
                d.getMonth() === month && d.getFullYear() === year;
        }).reduce((s, t) => s + t.amount, 0);
    });

    monthlySpent = computed(() => this.monthlyExpense());

    openAdd() {
        this.editingId.set(null);
        this.form.set({ type: TransactionType.Expense, amount: 0, description: '', category: 'Other', bank: '', date: new Date(), notes: '' });
        this.showModal.set(true);
    }

    openEdit(t: Transaction) {
        this.editingId.set(t.id!);
        this.form.set({ ...t });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateForm(field: keyof Omit<Transaction, 'id'>, value: any) {
        this.form.update((f) => ({ ...f, [field]: value }));
    }

    async save() {
        if (this.saving()) return;
        this.saving.set(true);
        try {
            const id = this.editingId();
            if (id) await this.txService.updateTransaction(id, this.form());
            else await this.txService.addTransaction(this.form());
            this.closeModal();
        } finally { this.saving.set(false); }
    }

    // ─── Multi-select & Delete ───────────────────
    toggleSelectMode() {
        if (this.selectMode()) {
            this.selectMode.set(false);
            this.selectedIds.set(new Set());
        } else {
            this.selectMode.set(true);
        }
    }

    toggleSelection(id: string) {
        this.selectedIds.update(set => {
            const next = new Set(set);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    isSelected(id: string): boolean {
        return this.selectedIds().has(id);
    }

    selectAll() {
        const allIds = this.filtered().filter(t => t.id).map(t => t.id!);
        this.selectedIds.set(new Set(allIds));
    }

    deselectAll() {
        this.selectedIds.set(new Set());
    }

    deleteSelected() {
        const ids = this.selectedIds();
        if (ids.size === 0) return;

        const toDelete = this.all().filter(t => t.id && ids.has(t.id));
        if (toDelete.length === 0) return;

        this.txPendingDeletion.set(toDelete);
        this.showDeleteModal.set(true);
    }

    delete(id: string) {
        const tx = this.all().find(t => t.id === id);
        if (!tx) return;

        this.txPendingDeletion.set([tx]);
        this.showDeleteModal.set(true);
    }

    closeDeleteModal() {
        if (this.deleting()) return;
        this.showDeleteModal.set(false);
        this.txPendingDeletion.set([]);
    }

    async confirmDelete() {
        const toDelete = this.txPendingDeletion();
        const ids = toDelete.map(t => t.id!).filter(Boolean);
        if (ids.length === 0) {
            this.closeDeleteModal();
            return;
        }

        this.deleting.set(true);
        try {
            await this.txService.batchDeleteTransactions(ids);

            this.selectedIds.update(set => {
                const next = new Set(set);
                for (const id of ids) {
                    next.delete(id);
                }
                return next;
            });

            if (this.selectedIds().size === 0) {
                this.selectMode.set(false);
            }

            this.snackbar.show(
                `Successfully deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`,
                'success'
            );
            this.closeDeleteModal();
        } catch (err: any) {
            console.error('[Transactions] Batch delete failed:', err);
            this.snackbar.show('Failed to delete transactions. Please try again.', 'error');
        } finally {
            this.deleting.set(false);
        }
    }

    getTypeClass(type: TransactionType) {
        return type === TransactionType.Income || type === TransactionType.Sell ? 'positive' : 'negative';
    }

    getTypeIcon(type: TransactionType) {
        const icons: Record<string, string> = { Income: 'arrow_upward', Sell: 'arrow_upward', Expense: 'arrow_downward', Buy: 'add_circle' };
        return icons[type] || 'circle';
    }

    exportCSV() {
        const txs = this.filtered();
        if (txs.length === 0) return;
        const rows = [
            ['Date', 'Type', 'Description', 'Category', 'Bank', 'Amount', 'Notes'],
            ...txs.map((t: any) => {
                const d = this.formatDate(t.date);
                return [
                    d.toISOString().split('T')[0],
                    t.type,
                    `"${(t.description || '').replace(/"/g, '""')}"`,
                    `"${(t.category || '').replace(/"/g, '""')}"`,
                    `"${(t.bank || '').replace(/"/g, '""')}"`,
                    (t.amount || 0).toString(),
                    `"${(t.notes || '').replace(/"/g, '""')}"`
                ];
            }),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
