import { Component, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { PwaService } from '../../services/pwa.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from './import-data/import-data.component';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [AsyncPipe, ImportDataComponent],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss',
})
export class SettingsComponent {
    authService = inject(AuthService);
    themeService = inject(ThemeService);
    pwaService = inject(PwaService);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);

    user$ = this.authService.currentUser$;
    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showImport = signal(false);

    onImportComplete(count: number) {
        this.showImport.set(false);
    }

    exportCSV() {
        const txs = this.transactions();
        const rows = [
            ['Date', 'Type', 'Description', 'Category', 'Amount'],
            ...txs.map((t) => {
                const d = (t.date as any).seconds ? new Date((t.date as any).seconds * 1000) : new Date(t.date);
                return [d.toLocaleDateString(), t.type, t.description, t.category, t.amount.toString()];
            }),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'transactions.csv';
        a.click();
    }

    exportPortfolio() {
        const asts = this.assets();
        const rows = [
            ['Name', 'Symbol', 'Type', 'Quantity', 'Buy Price', 'Current Price', 'Currency', 'Notes'],
            ...asts.map((a) => {
                return [
                    `"${a.name || ''}"`,
                    a.symbol || '',
                    a.type || '',
                    a.quantity.toString(),
                    a.buyPrice.toString(),
                    a.currentPrice.toString(),
                    a.currency || 'INR',
                    `"${a.notes || ''}"`
                ];
            }),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'portfolio_export.csv';
        a.click();
    }

    signOut() {
        this.authService.signOut().subscribe();
    }
}
