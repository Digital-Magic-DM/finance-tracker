import { Component, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, TransactionType, TRANSACTION_CATEGORIES } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-transactions',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, FormsModule],
    templateUrl: './transactions.component.html',
    styleUrl: './transactions.component.scss',
})
export class TransactionsComponent {
    private txService = inject(TransactionService);

    all = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showModal = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    filterType = signal<string>('All');
    searchQuery = signal('');

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

    async delete(id: string) {
        if (confirm('Delete this transaction?')) await this.txService.deleteTransaction(id);
    }

    getTypeClass(type: TransactionType) {
        return type === TransactionType.Income || type === TransactionType.Sell ? 'positive' : 'negative';
    }

    getTypeIcon(type: TransactionType) {
        const icons = { Income: '↑', Sell: '↑', Expense: '↓', Buy: '◈' };
        return icons[type] || '•';
    }

    formatDate(date: any): Date {
        if (date instanceof Date) return date;
        if (date?.seconds) return new Date(date.seconds * 1000);
        return new Date(date);
    }
}
