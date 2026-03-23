import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, TransactionType, TRANSACTION_CATEGORIES } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportTransactionsComponent } from './import-transactions/import-transactions.component';

@Component({
    selector: 'app-transactions',
    standalone: true,
    imports: [CommonModule, FormsModule, DatePipe, ImportTransactionsComponent],
    templateUrl: './transactions.component.html',
    styleUrl: './transactions.component.scss',
})
export class TransactionsComponent {
    private txService = inject(TransactionService);

    all = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showModal = signal(false);
    showImport = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    filterType = signal<string>('All');
    searchQuery = signal('');

    // Multi-select state
    selectMode = signal(false);
    selectedIds = signal<Set<string>>(new Set());
    deleting = signal(false);

    txTypes = ['All', ...Object.values(TransactionType)];
    categories = TRANSACTION_CATEGORIES;

    form = signal<Omit<Transaction, 'id'>>({
        type: TransactionType.Expense,
        amount: 0,
        description: '',
        category: 'Other',
        date: new Date(),
        notes: '',
    });

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
        return list;
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
        this.form.set({ type: TransactionType.Expense, amount: 0, description: '', category: 'Other', date: new Date(), notes: '' });
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

    async deleteSelected() {
        const ids = Array.from(this.selectedIds());
        if (ids.length === 0) return;

        const confirmText = `Delete ${ids.length} selected transactions?`;
        if (!confirm(confirmText)) return;

        this.deleting.set(true);
        try {
            for (const id of ids) {
                await this.txService.deleteTransaction(id);
            }
            this.selectedIds.set(new Set());
            this.selectMode.set(false);
        } catch (err) {
            console.error('[Transactions] Batch delete failed:', err);
        } finally {
            this.deleting.set(false);
        }
    }

    async delete(id: string) {
        if (confirm('Delete this transaction?')) await this.txService.deleteTransaction(id);
    }

    getTypeClass(type: TransactionType) {
        return type === TransactionType.Income || type === TransactionType.Sell ? 'positive' : 'negative';
    }

    getTypeIcon(type: TransactionType) {
        const icons: Record<string, string> = { Income: 'arrow_upward', Sell: 'arrow_upward', Expense: 'arrow_downward', Buy: 'add_circle' };
        return icons[type] || 'circle';
    }

    formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
