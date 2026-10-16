import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { updateProfile } from '@angular/fire/auth';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { PwaService } from '../../services/pwa.service';
import { AiService } from '../../services/ai.service';
import { SnackbarService } from '../../services/snackbar.service';
import { GoogleFinanceService } from '../../services/google-finance.service';
import { PinSecurityService } from '../../services/pin-security.service';
import { DeviceSessionService } from '../../services/device-session.service';
import { ReportExportService } from '../../services/report-export.service';
import { ImportDataComponent } from './import-data/import-data.component';
import { CustomSelectDirective } from '../../shared/directives/custom-select.directive';
import { AssetType, TransactionType, getAssetAppSource } from '../../models/finance.models';
import { McpAuthService } from '../../services/mcp-auth.service';

export type SettingsSubPage = 'basic' | 'reports' | 'pin' | 'devices' | 'mcp';
export type ReportCategory = 'all' | 'portfolio' | 'stocks' | 'mf' | 'fixed_income' | 'transactions';
export type DatePreset = 'this_month' | 'last_month' | 'last_3_months' | 'current_fy' | 'last_fy' | 'this_year' | 'all' | 'custom';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, ImportDataComponent, RouterLink, FormsModule, CustomSelectDirective],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
    authService = inject(AuthService);
    themeService = inject(ThemeService);
    pwaService = inject(PwaService);
    aiService = inject(AiService);
    snackbar = inject(SnackbarService);
    pinSecurity = inject(PinSecurityService);
    deviceService = inject(DeviceSessionService);
    reportExport = inject(ReportExportService);
    mcpAuth = inject(McpAuthService);
    private assetService = inject(AssetService);
    private txService = inject(TransactionService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    // Sub-page navigation
    activeSubPage = signal<SettingsSubPage>('basic');
    reportCategory = signal<ReportCategory>('all');

    // Date-wise Report Filtering
    datePreset = signal<DatePreset>('this_month');
    fromDate = signal<string>('');
    toDate = signal<string>('');

    user = this.authService.firebaseUser;
    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });
    showImport = signal(false);

    // Profile editing
    isEditingProfile = signal(false);
    displayNameInput = signal('');

    // Google Finance Settings
    gfService = inject(GoogleFinanceService);
    gfUrl = signal(this.gfService.apiUrl() || '');
    isTestingGf = signal(false);
    showGfGuide = signal(false);

    // AI Settings
    geminiKey = signal(this.aiService.getApiKey() || '');
    geminiModel = signal(this.aiService.getSavedModel() || 'auto');

    // Security PIN State
    newPin = signal('');
    confirmPin = signal('');
    pinSetupError = signal('');
    isSubmittingPin = signal(false);

    currentPin = signal('');
    changeNewPin = signal('');
    changeConfirmPin = signal('');
    pinChangeError = signal('');

    removePinInput = signal('');
    showRemovePinModal = signal(false);
    removePinError = signal('');

    // Stocks filter in reports
    stockFilter = signal<'all' | 'india' | 'us'>('all');
    // Fixed Income filter
    fixedIncomeFilter = signal<'all' | 'fd' | 'bond'>('all');
    // Transactions filter
    txTypeFilter = signal<'all' | 'Income' | 'Expense'>('all');

    ngOnInit() {
        this.setDatePreset('this_month');

        // Read initial tab from query param if provided
        this.route.queryParamMap.subscribe((params) => {
            const tab = params.get('tab') as SettingsSubPage | null;
            if (tab && ['basic', 'reports', 'pin', 'devices', 'mcp'].includes(tab)) {
                this.activeSubPage.set(tab);
            }
            const cat = params.get('category') as ReportCategory | null;
            if (cat && ['all', 'portfolio', 'stocks', 'mf', 'fixed_income', 'transactions'].includes(cat)) {
                this.reportCategory.set(cat);
            }
            const from = params.get('from');
            const to = params.get('to');
            if (from || to) {
                this.datePreset.set('custom');
                if (from) this.fromDate.set(from);
                if (to) this.toDate.set(to);
            }
        });

        // Initialize display name input
        const currentUser = this.authService.getCurrentUser();
        if (currentUser?.displayName) {
            this.displayNameInput.set(currentUser.displayName);
        }
    }

    setSubPage(page: SettingsSubPage) {
        this.activeSubPage.set(page);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: page },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    setReportCategory(cat: ReportCategory) {
        this.reportCategory.set(cat);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { category: cat },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    setDatePreset(preset: DatePreset) {
        this.datePreset.set(preset);
        if (preset === 'all') {
            this.fromDate.set('');
            this.toDate.set('');
            return;
        }

        const now = new Date();
        let start: Date;
        let end: Date;

        switch (preset) {
            case 'this_month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'last_month':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'last_3_months':
                start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'current_fy': {
                // Indian Financial Year: 01 April to 31 March
                const curMonth = now.getMonth();
                const startYear = curMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                start = new Date(startYear, 3, 1);
                end = new Date(startYear + 1, 2, 31);
                break;
            }
            case 'last_fy': {
                const curMonth = now.getMonth();
                const startYear = (curMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1) - 1;
                start = new Date(startYear, 3, 1);
                end = new Date(startYear + 1, 2, 31);
                break;
            }
            case 'this_year':
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                return;
        }

        this.fromDate.set(this.formatToDateString(start));
        this.toDate.set(this.formatToDateString(end));
    }

    onCustomDateChange() {
        this.datePreset.set('custom');
    }

    formatToDateString(d: Date): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    toValidDate(dateVal: any): Date {
        if (!dateVal) return new Date();
        if (dateVal instanceof Date) return dateVal;
        if (dateVal.toDate && typeof dateVal.toDate === 'function') return dateVal.toDate();
        if (dateVal.seconds) return new Date(dateVal.seconds * 1000);
        const parsed = new Date(dateVal);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    dateRangeLabel = computed(() => {
        const preset = this.datePreset();
        const from = this.fromDate();
        const to = this.toDate();

        if (preset === 'all' || (!from && !to)) {
            return 'All Time';
        }

        const formatD = (str: string) => {
            if (!str) return '';
            const [y, m, d] = str.split('-').map(Number);
            if (!y || !m || !d) return str;
            const date = new Date(y, m - 1, d);
            return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        };

        if (from && to) {
            return `${formatD(from)} – ${formatD(to)}`;
        } else if (from) {
            return `From ${formatD(from)}`;
        } else if (to) {
            return `Up to ${formatD(to)}`;
        }
        return 'All Time';
    });

    dateRangeDays = computed(() => {
        const from = this.fromDate();
        const to = this.toDate();
        if (!from || !to) return null;
        const d1 = new Date(from).getTime();
        const d2 = new Date(to).getTime();
        if (isNaN(d1) || isNaN(d2)) return null;
        const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
        return diff > 0 ? diff : null;
    });

    // -------------------------------------------------------------------------
    // BASIC DETAILS METHODS
    // -------------------------------------------------------------------------
    startEditingProfile() {
        this.displayNameInput.set(this.authService.getCurrentUser()?.displayName || '');
        this.isEditingProfile.set(true);
    }

    async saveDisplayName() {
        const user = this.authService.getCurrentUser();
        const newName = this.displayNameInput().trim();
        if (!user || !newName) return;

        try {
            await updateProfile(user, { displayName: newName });
            this.snackbar.show('Profile display name updated!', 'success');
            this.isEditingProfile.set(false);
        } catch (err: any) {
            this.snackbar.show('Failed to update name: ' + err.message, 'error');
        }
    }

    saveApiKey() {
        this.aiService.setApiKey(this.geminiKey());
        this.aiService.setSavedModel(this.geminiModel());
        if (this.geminiKey()) {
            this.snackbar.show(`Gemini settings saved successfully.`, 'success');
        } else {
            this.snackbar.show('Gemini API Key removed.', 'info');
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

    signOut() {
        this.deviceService.removeCurrentSession().finally(() => {
            this.authService.signOut().subscribe();
        });
    }

    // -------------------------------------------------------------------------
    // PIN SECURITY METHODS
    // -------------------------------------------------------------------------
    async handleSetupPin() {
        this.pinSetupError.set('');
        const pin = this.newPin().trim();
        const confirm = this.confirmPin().trim();

        if (!/^\d{4,6}$/.test(pin)) {
            this.pinSetupError.set('PIN must be 4 to 6 numeric digits.');
            return;
        }

        if (pin !== confirm) {
            this.pinSetupError.set('PIN and Confirm PIN do not match.');
            return;
        }

        this.isSubmittingPin.set(true);
        try {
            const res = await this.pinSecurity.setPin(pin);
            if (res.success) {
                this.newPin.set('');
                this.confirmPin.set('');
                this.pinSetupError.set('');
            } else {
                this.pinSetupError.set(res.message);
            }
        } finally {
            this.isSubmittingPin.set(false);
        }
    }

    async handleChangePin() {
        this.pinChangeError.set('');
        const cur = this.currentPin().trim();
        const np = this.changeNewPin().trim();
        const cnp = this.changeConfirmPin().trim();

        if (!cur) {
            this.pinChangeError.set('Please enter your current PIN.');
            return;
        }

        if (!/^\d{4,6}$/.test(np)) {
            this.pinChangeError.set('New PIN must be 4 to 6 numeric digits.');
            return;
        }

        if (np !== cnp) {
            this.pinChangeError.set('New PIN and Confirm PIN do not match.');
            return;
        }

        this.isSubmittingPin.set(true);
        try {
            const res = await this.pinSecurity.changePin(cur, np);
            if (res.success) {
                this.currentPin.set('');
                this.changeNewPin.set('');
                this.changeConfirmPin.set('');
                this.pinChangeError.set('');
            } else {
                this.pinChangeError.set(res.message);
            }
        } finally {
            this.isSubmittingPin.set(false);
        }
    }

    async handleRemovePin() {
        this.removePinError.set('');
        const cur = this.removePinInput().trim();
        if (!cur) {
            this.removePinError.set('Please enter your current PIN to confirm removal.');
            return;
        }

        const res = await this.pinSecurity.removePin(cur);
        if (res.success) {
            this.removePinInput.set('');
            this.showRemovePinModal.set(false);
            this.removePinError.set('');
            this.snackbar.show('PIN reset. Security PIN is mandatory — please set up a new PIN.', 'info');
            this.router.navigate(['/setup-pin']);
        } else {
            this.removePinError.set(res.message);
        }
    }

    lockAppNow() {
        this.pinSecurity.lock();
    }

    // -------------------------------------------------------------------------
    // REPORTS COMPUTED METRICS & DATA
    // -------------------------------------------------------------------------
    // 1. Overall Portfolio Report
    portfolioSummary = computed(() => {
        const asts = this.assets();
        let totalVal = 0;
        let totalInv = 0;

        const breakdownMap = new Map<AssetType, { count: number; value: number; invested: number }>();

        for (const a of asts) {
            const currentVal = (a.quantity || 0) * (a.currentPrice || a.buyPrice || 0);
            const investedVal = (a.quantity || 0) * (a.buyPrice || 0);
            totalVal += currentVal;
            totalInv += investedVal;

            const existing = breakdownMap.get(a.type) || { count: 0, value: 0, invested: 0 };
            existing.count += 1;
            existing.value += currentVal;
            existing.invested += investedVal;
            breakdownMap.set(a.type, existing);
        }

        const breakdownList = Array.from(breakdownMap.entries()).map(([type, stats]) => {
            const pct = totalVal > 0 ? (stats.value / totalVal) * 100 : 0;
            const pl = stats.value - stats.invested;
            const plPct = stats.invested > 0 ? (pl / stats.invested) * 100 : 0;
            return {
                type,
                count: stats.count,
                invested: stats.invested,
                value: stats.value,
                profit: pl,
                profitPct: plPct,
                allocationPct: pct
            };
        }).sort((a, b) => b.value - a.value);

        const totalProfit = totalVal - totalInv;
        const totalProfitPct = totalInv > 0 ? (totalProfit / totalInv) * 100 : 0;

        return {
            totalValue: totalVal,
            totalInvested: totalInv,
            totalProfit,
            totalProfitPct,
            assetCount: asts.length,
            txCount: this.transactions().length,
            breakdownList
        };
    });

    // 2. Stocks Report
    stocksReport = computed(() => {
        const asts = this.assets().filter(a => a.type === AssetType.Stock || a.type === AssetType.USStock);
        const filter = this.stockFilter();

        const filtered = asts.filter(a => {
            if (filter === 'india') return a.type === AssetType.Stock;
            if (filter === 'us') return a.type === AssetType.USStock;
            return true;
        });

        let totalVal = 0;
        let totalInv = 0;

        const rows = filtered.map(a => {
            const qty = a.quantity || 0;
            const buyPrice = a.buyPrice || 0;
            const curPrice = a.currentPrice != null ? a.currentPrice : buyPrice;
            const invested = qty * buyPrice;
            const value = qty * curPrice;
            const pl = value - invested;
            const plPct = invested > 0 ? (pl / invested) * 100 : 0;
            totalVal += value;
            totalInv += invested;

            return {
                ...a,
                invested,
                value,
                profit: pl,
                profitPct: plPct,
                isIndian: a.type === AssetType.Stock,
                exchange: a.symbol?.includes('.BO') ? 'BSE' : (a.type === AssetType.USStock ? 'US/NASDAQ' : 'NSE')
            };
        }).sort((a, b) => b.value - a.value);

        const totalProfit = totalVal - totalInv;
        const totalProfitPct = totalInv > 0 ? (totalProfit / totalInv) * 100 : 0;

        return {
            rows,
            totalValue: totalVal,
            totalInvested: totalInv,
            totalProfit,
            totalProfitPct,
            count: rows.length
        };
    });

    // 3. Mutual Funds Report
    mfReport = computed(() => {
        const asts = this.assets().filter(a => a.type === AssetType.MutualFund);
        let totalVal = 0;
        let totalInv = 0;

        const rows = asts.map(a => {
            const units = a.quantity || 0;
            const buyNav = a.buyPrice || 0;
            const curNav = a.currentPrice != null ? a.currentPrice : buyNav;
            const invested = units * buyNav;
            const value = units * curNav;
            const pl = value - invested;
            const plPct = invested > 0 ? (pl / invested) * 100 : 0;
            totalVal += value;
            totalInv += invested;

            return {
                ...a,
                units,
                buyNav,
                curNav,
                invested,
                value,
                profit: pl,
                profitPct: plPct
            };
        }).sort((a, b) => b.value - a.value);

        const totalProfit = totalVal - totalInv;
        const totalProfitPct = totalInv > 0 ? (totalProfit / totalInv) * 100 : 0;

        return {
            rows,
            totalValue: totalVal,
            totalInvested: totalInv,
            totalProfit,
            totalProfitPct,
            count: rows.length
        };
    });

    // 4. Fixed Deposits & Bonds Report
    fixedIncomeReport = computed(() => {
        const asts = this.assets().filter(a => a.type === AssetType.FixedDeposit || a.type === AssetType.Bond);
        const filter = this.fixedIncomeFilter();

        const filtered = asts.filter(a => {
            if (filter === 'fd') return a.type === AssetType.FixedDeposit;
            if (filter === 'bond') return a.type === AssetType.Bond;
            return true;
        });

        let totalVal = 0;
        let totalPrincipal = 0;
        let totalInterestRateSum = 0;
        let rateCount = 0;

        const rows = filtered.map(a => {
            const principal = (a.quantity || 1) * (a.buyPrice || 0);
            const curVal = (a.quantity || 1) * (a.currentPrice || a.buyPrice || 0);
            totalVal += curVal;
            totalPrincipal += principal;

            if (a.interestRate && a.interestRate > 0) {
                totalInterestRateSum += a.interestRate;
                rateCount++;
            }

            return {
                ...a,
                principal,
                curVal,
                subType: a.subType || (a.type === AssetType.FixedDeposit ? 'Fixed Deposit' : 'Bond'),
                interestRate: a.interestRate || 0,
                maturityDate: a.maturityDate || 'Not specified'
            };
        }).sort((a, b) => b.curVal - a.curVal);

        const avgRate = rateCount > 0 ? totalInterestRateSum / rateCount : 0;
        const accruedGain = totalVal - totalPrincipal;

        return {
            rows,
            totalValue: totalVal,
            totalPrincipal,
            avgRate,
            accruedGain,
            count: rows.length
        };
    });

    // 5. Filtered Transactions & Transactions Report (Date-Wise)
    filteredTransactions = computed(() => {
        let list = this.transactions();
        const from = this.fromDate();
        const to = this.toDate();

        if (from) {
            const fromMs = new Date(from).setHours(0, 0, 0, 0);
            list = list.filter(t => this.toValidDate(t.date).getTime() >= fromMs);
        }
        if (to) {
            const toMs = new Date(to).setHours(23, 59, 59, 999);
            list = list.filter(t => this.toValidDate(t.date).getTime() <= toMs);
        }

        const typeFilter = this.txTypeFilter();
        if (typeFilter !== 'all') {
            list = list.filter(t => t.type === typeFilter);
        }

        return list.sort((a, b) => this.toValidDate(b.date).getTime() - this.toValidDate(a.date).getTime());
    });

    transactionsReport = computed(() => {
        const filtered = this.filteredTransactions();
        let totalIncome = 0;
        let totalExpense = 0;
        let totalBuy = 0;
        let totalSell = 0;

        for (const t of filtered) {
            if (t.type === TransactionType.Income) totalIncome += t.amount || 0;
            else if (t.type === TransactionType.Expense) totalExpense += t.amount || 0;
            else if (t.type === TransactionType.Buy) totalBuy += t.amount || 0;
            else if (t.type === TransactionType.Sell) totalSell += t.amount || 0;
        }

        const netSavings = totalIncome - totalExpense;

        return {
            rows: filtered,
            totalIncome,
            totalExpense,
            totalBuy,
            totalSell,
            netSavings,
            count: filtered.length
        };
    });

    // -------------------------------------------------------------------------
    // EXPORT ACTIONS (PDF & EXCEL WITH BRANDING & LOGO)
    // -------------------------------------------------------------------------
    exportMaster(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportMasterReport(format, {
            portfolio: this.portfolioSummary(),
            txSummary: this.transactionsReport(),
            txs: this.filteredTransactions(),
            user: currentUser,
            periodLabel: this.dateRangeLabel(),
            fromDate: this.fromDate(),
            toDate: this.toDate()
        });
    }

    exportTransactions(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportTransactionsReport(format, {
            txSummary: this.transactionsReport(),
            txs: this.filteredTransactions(),
            user: currentUser,
            periodLabel: this.dateRangeLabel(),
            fromDate: this.fromDate(),
            toDate: this.toDate()
        });
    }

    exportPortfolioReport(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportPortfolioReport(format, {
            portfolio: this.portfolioSummary(),
            assets: this.assets(),
            user: currentUser,
            periodLabel: this.dateRangeLabel()
        });
    }

    exportStocks(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportStocksReport(format, {
            stocks: this.stocksReport(),
            user: currentUser,
            periodLabel: this.dateRangeLabel()
        });
    }

    exportMutualFunds(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportMutualFundsReport(format, {
            mf: this.mfReport(),
            user: currentUser,
            periodLabel: this.dateRangeLabel()
        });
    }

    exportFixedIncome(format: 'pdf' | 'excel') {
        const currentUser = this.authService.getCurrentUser();
        this.reportExport.exportFixedIncomeReport(format, {
            fi: this.fixedIncomeReport(),
            user: currentUser,
            periodLabel: this.dateRangeLabel()
        });
    }

    exportCSV() {
        const txs = this.filteredTransactions();
        const rangeStr = this.dateRangeLabel();
        const rows = [
            ['# FinTracker Transactions Statement'],
            [`# Period: ${rangeStr}`],
            [`# Exported: ${new Date().toLocaleString('en-IN')}`],
            [`# Total Transactions: ${txs.length}`],
            [`# Net Savings: ${this.transactionsReport().netSavings}`],
            [],
            ['Date', 'Type', 'Description', 'Category', 'Bank', 'Amount'],
            ...txs.map((t: any) => {
                const d = this.toValidDate(t.date);
                return [
                    this.formatToDateString(d),
                    t.type,
                    `"${(t.description || '').replace(/"/g, '""')}"`,
                    t.category || '',
                    t.bank || '',
                    (t.amount || 0).toString()
                ];
            }),
        ];
        const fStr = this.fromDate() || 'all';
        const tStr = this.toDate() || 'present';
        this.downloadFile(rows.map((r) => r.join(',')).join('\n'), `transactions_${fStr}_to_${tStr}.csv`, 'text/csv');
    }

    exportMasterReportCSV() {
        const rangeStr = this.dateRangeLabel();
        const portfolio = this.portfolioSummary();
        const txSummary = this.transactionsReport();
        const txs = this.filteredTransactions();

        const lines: string[] = [
            `# FINTRACKER MASTER FINANCIAL STATEMENT`,
            `# Reporting Period: ${rangeStr}`,
            `# Export Date: ${new Date().toLocaleString('en-IN')}`,
            ``,
            `=== 1. PORTFOLIO NET WORTH SUMMARY ===`,
            `Total Net Worth,${portfolio.totalValue}`,
            `Total Invested,${portfolio.totalInvested}`,
            `Total Gain / Loss,${portfolio.totalProfit}`,
            `Overall Returns %,${portfolio.totalProfitPct.toFixed(2)}%`,
            `Total Asset Holdings,${portfolio.assetCount}`,
            ``,
            `=== 2. ASSET ALLOCATION BREAKDOWN ===`,
            `Asset Category,Holdings,Invested Value,Current Value,Profit / Loss,Allocation %`,
            ...portfolio.breakdownList.map(b => 
                `"${b.type}",${b.count},${b.invested.toFixed(2)},${b.value.toFixed(2)},${b.profit.toFixed(2)},${b.allocationPct.toFixed(1)}%`
            ),
            ``,
            `=== 3. PERIOD CASH FLOW SUMMARY (${rangeStr}) ===`,
            `Total Income / Inflow,${txSummary.totalIncome}`,
            `Total Expenses / Outflow,${txSummary.totalExpense}`,
            `Net Savings / Cashflow,${txSummary.netSavings}`,
            `Transactions Count,${txSummary.count}`,
            ``,
            `=== 4. DETAILED TRANSACTIONS LOG (${rangeStr}) ===`,
            `Date,Type,Description,Category,Bank,Amount`,
            ...txs.map(t => {
                const d = this.toValidDate(t.date);
                return `${this.formatToDateString(d)},${t.type},"${(t.description || '').replace(/"/g, '""')}",${t.category || ''},${t.bank || ''},${t.amount || 0}`;
            })
        ];

        const fStr = this.fromDate() || 'all';
        const tStr = this.toDate() || 'present';
        this.downloadFile(lines.join('\n'), `financial_master_report_${fStr}_to_${tStr}.csv`, 'text/csv');
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
        this.downloadFile(rows.map((r) => r.join(',')).join('\n'), `portfolio_export_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    }

    exportStocksCSV() {
        const rep = this.stocksReport();
        const rows = [
            ['Name', 'Symbol', 'Exchange', 'Quantity', 'Avg Buy Price', 'Current Price', 'Total Invested', 'Current Value', 'Gain/Loss', 'Returns %'],
            ...rep.rows.map((r: any) => [
                `"${(r.name || '').replace(/"/g, '""')}"`,
                r.symbol || '',
                r.exchange || '',
                r.quantity || 0,
                r.buyPrice || 0,
                r.currentPrice || 0,
                r.invested.toFixed(2),
                r.value.toFixed(2),
                r.profit.toFixed(2),
                r.profitPct.toFixed(2) + '%'
            ])
        ];
        this.downloadFile(rows.map(r => r.join(',')).join('\n'), `stocks_report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    }

    exportMutualFundsCSV() {
        const rep = this.mfReport();
        const rows = [
            ['Scheme Name', 'Units', 'Buy NAV', 'Current NAV', 'NAV Date', 'Total Invested', 'Current Value', 'Gain/Loss', 'Returns %'],
            ...rep.rows.map((r: any) => [
                `"${(r.name || '').replace(/"/g, '""')}"`,
                r.units || 0,
                r.buyNav || 0,
                r.curNav || 0,
                r.navDate || '',
                r.invested.toFixed(2),
                r.value.toFixed(2),
                r.profit.toFixed(2),
                r.profitPct.toFixed(2) + '%'
            ])
        ];
        this.downloadFile(rows.map(r => r.join(',')).join('\n'), `mutual_funds_report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    }

    exportFixedIncomeCSV() {
        const rep = this.fixedIncomeReport();
        const rows = [
            ['Institution / Asset Name', 'Sub-Type', 'Principal Invested', 'Interest Rate / Yield %', 'Maturity Date', 'Current / Maturity Value'],
            ...rep.rows.map((r: any) => [
                `"${(r.name || '').replace(/"/g, '""')}"`,
                r.subType || '',
                r.principal.toFixed(2),
                (r.interestRate || 0) + '%',
                r.maturityDate || '',
                r.curVal.toFixed(2)
            ])
        ];
        this.downloadFile(rows.map(r => r.join(',')).join('\n'), `fixed_income_report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    }

    exportPortfolioJSON() {
        const data = {
            exportedAt: new Date().toISOString(),
            portfolioSummary: this.portfolioSummary(),
            assets: this.assets(),
            transactions: this.transactions()
        };
        const json = JSON.stringify(data, null, 2);
        this.downloadFile(json, `fintracker_data_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    }

    printReport() {
        window.print();
    }

    private downloadFile(content: string, filename: string, type: string) {
        const blob = new Blob([content], { type: `${type};charset=utf-8;` });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        this.snackbar.show(`Exported ${filename}`, 'success');
    }

    formatCurrency(val: number): string {
        return '₹' + (val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }

    formatDate(dateVal: any): string {
        if (!dateVal) return '-';
        const d = dateVal?.seconds ? new Date(dateVal.seconds * 1000) : new Date(dateVal);
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
    }

    // =========================================================================
    // MCP (Model Context Protocol) & AI Assistant Key Management
    // =========================================================================
    showMcpToken = signal(false);
    activeMcpSnippetTab = signal<'claude' | 'antigravity' | 'cursor' | 'url'>('claude');
    copiedSnippet = signal<string | null>(null);

    toggleShowMcpToken() {
        this.showMcpToken.update((v) => !v);
    }

    setMcpSnippetTab(tab: 'claude' | 'antigravity' | 'cursor' | 'url') {
        this.activeMcpSnippetTab.set(tab);
    }

    async generateMcpKey(label = 'Personal AI Assistant') {
        await this.mcpAuth.generatePersonalMcpKey(label);
        this.showMcpToken.set(true);
    }

    async revokeMcpKey() {
        if (confirm('Are you sure you want to revoke this AI key? Any connected AI assistants (Claude, Antigravity, Cursor) will immediately lose access.')) {
            await this.mcpAuth.revokePersonalMcpKey();
            this.showMcpToken.set(false);
        }
    }

    copyMcpSnippet(text: string, snippetId: string) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(
            () => {
                this.copiedSnippet.set(snippetId);
                this.snackbar.show('Copied to clipboard!', 'success');
                setTimeout(() => {
                    if (this.copiedSnippet() === snippetId) {
                        this.copiedSnippet.set(null);
                    }
                }, 2500);
            },
            () => {
                this.snackbar.show('Failed to copy. Please copy manually.', 'error');
            }
        );
    }
}
