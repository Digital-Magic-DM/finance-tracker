import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { PwaService } from '../../services/pwa.service';
import { AiService } from '../../services/ai.service';
import { SnackbarService } from '../../services/snackbar.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from './import-data/import-data.component';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [ImportDataComponent, RouterLink, FormsModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss',
})
export class SettingsComponent {
    authService = inject(AuthService);
    themeService = inject(ThemeService);
    pwaService = inject(PwaService);
    aiService = inject(AiService);
    snackbar = inject(SnackbarService);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    
    user = this.authService.firebaseUser;
    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showImport = signal(false);

    // AI Settings
    geminiKey = signal(this.aiService.getApiKey() || '');
    geminiModel = signal(this.aiService.getSavedModel() || 'auto');

    saveApiKey() {
        this.aiService.setApiKey(this.geminiKey());
        this.aiService.setSavedModel(this.geminiModel());
        if (this.geminiKey()) {
            this.snackbar.show(`Gemini settings saved successfully.`);
        } else {
            this.snackbar.show('Gemini API Key removed.');
        }
    }

    onImportComplete(count: number) {
        void count;
        this.showImport.set(false);
    }

    exportCSV() {
        const txs = this.transactions();
        const rows = [
            ['Date', 'Type', 'Description', 'Category', 'Amount'],
            ...txs.map((t: any) => {
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
            ...asts.map((a: any) => {
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
