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
import { GoogleFinanceService } from '../../services/google-finance.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ImportDataComponent } from './import-data/import-data.component';
import { getAssetAppSource } from '../../models/finance.models';

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

    // Google Finance Settings
    gfService = inject(GoogleFinanceService);
    gfUrl = signal(this.gfService.apiUrl() || '');
    isTestingGf = signal(false);
    showGfGuide = signal(false);

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

    saveGfUrl() {
        this.gfService.setUrl(this.gfUrl());
        this.gfUrl.set(this.gfService.apiUrl());
        this.snackbar.show('Google Finance API URL saved successfully.', 'success');
    }

    resetGfToDefault() {
        this.gfService.resetToDefault();
        this.gfUrl.set(this.gfService.apiUrl());
        this.snackbar.show('Reset to built-in FinTracker Google Finance API.', 'info');
    }

    async testGfConnection() {
        this.isTestingGf.set(true);
        try {
            const res = await this.gfService.testConnection(this.gfUrl());
            if (res.success) {
                this.snackbar.show(res.message, 'success');
            } else {
                this.snackbar.show(res.message, 'error');
            }
        } finally {
            this.isTestingGf.set(false);
        }
    }

    copyScriptCode() {
        const code = `function doGet(e) {
  try {
    var tickersParam = e.parameter.tickers || e.parameter.ticker || e.parameter.q;
    if (!tickersParam) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "Missing tickers parameter. Example: ?tickers=NSE:RELIANCE,NSE:TCS"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var tickers = tickersParam.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("_gf_api") || ss.insertSheet("_gf_api");
    sheet.clear();

    var formulas = tickers.map(function(ticker) {
      if (ticker.indexOf('CURRENCY:') === 0 || ticker === 'USDINR') {
        var cPair = ticker.indexOf(':') === -1 ? 'CURRENCY:' + ticker : ticker;
        return [
          '=GOOGLEFINANCE("' + cPair + '")',
          '=""',
          '=""',
          '="US Dollar / Indian Rupee"',
          '=""'
        ];
      }
      var sym = ticker.indexOf(':') === -1 ? 'NSE:' + ticker : ticker;
      return [
        '=GOOGLEFINANCE("' + sym + '", "price")',
        '=GOOGLEFINANCE("' + sym + '", "change")',
        '=GOOGLEFINANCE("' + sym + '", "changepct")',
        '=GOOGLEFINANCE("' + sym + '", "name")',
        '=GOOGLEFINANCE("' + sym + '", "closeyest")'
      ];
    });

    sheet.getRange(1, 1, formulas.length, 5).setFormulas(formulas);
    SpreadsheetApp.flush();
    Utilities.sleep(150);

    var values = sheet.getRange(1, 1, formulas.length, 5).getValues();
    var results = {};

    tickers.forEach(function(ticker, i) {
      var row = values[i];
      var price = row[0];
      if (typeof price === 'number' && !isNaN(price) && price > 0) {
        results[ticker] = {
          ticker: ticker,
          price: price,
          change: typeof row[1] === 'number' ? row[1] : 0,
          changePercent: typeof row[2] === 'number' ? row[2] : 0,
          name: typeof row[3] === 'string' ? row[3] : ticker,
          prevClose: typeof row[4] === 'number' ? row[4] : price,
          status: 'SUCCESS'
        };
      } else {
        results[ticker] = {
          ticker: ticker,
          status: 'NOT_FOUND',
          error: String(price)
        };
      }
    });

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      data: results
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code);
            this.snackbar.show('Google Apps Script copied to clipboard!', 'success');
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
            ['Name', 'Symbol', 'Type', 'Quantity', 'Buy Price', 'Current Price', 'Currency', 'App Source', 'Notes'],
            ...asts.map((a: any) => {
                const cp = a.currentPrice != null ? a.currentPrice.toString() : '';
                const bp = a.buyPrice != null ? a.buyPrice.toString() : '0';
                const qty = a.quantity != null ? a.quantity.toString() : '0';
                return [
                    `"${(a.name || '').replace(/"/g, '""')}"`,
                    a.symbol || '',
                    a.type || '',
                    qty,
                    bp,
                    cp,
                    a.currency || 'INR',
                    `"${getAssetAppSource(a)}"`,
                    `"${(a.notes || '').replace(/"/g, '""')}"`
                ];
            }),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `portfolio_export_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    signOut() {
        this.authService.signOut().subscribe();
    }
}
