import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SipService } from '../../services/sip.service';
import { MarketCalendarService } from '../../services/market-calendar.service';
import { AmfiNavService } from '../../services/amfi-nav.service';
import { SnackbarService } from '../../services/snackbar.service';
import { AssetService } from '../../services/asset.service';
import { ReportExportService } from '../../services/report-export.service';
import {
  Sip,
  SipCategory,
  SipFrequency,
  SipInstallment,
  SipPlanType,
  SipOption,
  SipDataSource,
  SIP_CATEGORY_CONFIG,
  YearlyScheduleEntry,
  MarketHoliday,
} from '../../models/sip.models';
import { Asset } from '../../models/finance.models';

@Component({
  selector: 'app-sip',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './sip.component.html',
  styleUrls: ['./sip.component.scss'],
})
export class SipComponent implements OnInit {
  public sipService = inject(SipService);
  public calendarService = inject(MarketCalendarService);
  public navService = inject(AmfiNavService);
  private snackbar = inject(SnackbarService);
  private assetService = inject(AssetService);
  public reportExport = inject(ReportExportService);

  // ── Navigation & View State ──
  readonly activeTab = signal<'active' | 'reconcile' | 'calendar' | 'history' | 'calculator'>('active');
  readonly selectedCategory = signal<string>('All');
  readonly searchQuery = signal<string>('');
  readonly viewMode = signal<'cards' | 'table'>('cards');

  readonly SIP_CONFIG = SIP_CATEGORY_CONFIG;
  readonly sipCategories: SipCategory[] = [
    'MutualFund',
    'ETF',
    'Stock',
    'Gold',
    'Crypto',
    'Other',
  ];

  // ── Modals State ──
  readonly showAddEditModal = signal<boolean>(false);
  readonly editingSipId = signal<string | null>(null);

  readonly showScheduleModal = signal<boolean>(false);
  readonly selectedSipForSchedule = signal<Sip | null>(null);

  readonly showHistoryModal = signal<boolean>(false);
  readonly selectedSipForHistory = signal<Sip | null>(null);

  // ── Manual Confirmation Modal State ──
  readonly showManualAllotmentModal = signal<boolean>(false);
  readonly confirmingInstallment = signal<{ sip: Sip; installment: SipInstallment } | null>(null);
  confirmAllotmentDate = '';
  confirmNav = 0;
  confirmUnits = 0;
  confirmRef = '';
  confirmNotes = '';
  readonly isFetchingNav = signal<boolean>(false);

  // ── Form State (Add / Edit) ──
  sipFormName = '';
  sipFormCategory: SipCategory = 'MutualFund';
  sipFormSchemeCode = '';
  sipFormIsin = '';
  sipFormPlanType: SipPlanType = 'Direct';
  sipFormOption: SipOption = 'Growth';
  sipFormFundHouse = '';
  sipFormFolio = '';
  sipFormMandate = '';
  sipFormAmount = 5000;
  sipFormFrequency: SipFrequency = 'Monthly';
  sipFormDay = 10;
  sipFormStartDate = '';
  sipFormEndDate = '';
  sipFormAutoExecute = true;
  sipFormStepUpEnabled = false;
  sipFormStepUpType: 'percentage' | 'fixed' = 'percentage';
  sipFormStepUpValue = 10;
  sipFormLinkedAssetId = '';
  sipFormDataSource: SipDataSource = 'CAS';
  sipFormNotes = '';

  // Scheme Search Auto-Suggest
  readonly schemeSearchResults = signal<Array<{ schemeCode: string; schemeName: string }>>([]);
  readonly isSearchingSchemes = signal<boolean>(false);

  // ── User's Existing Assets (for linking) ──
  readonly userAssets = signal<Asset[]>([]);

  // ── Reconciliation Filter ──
  readonly reconcileFilter = signal<'pending' | 'confirmed' | 'failed' | 'all'>('pending');

  // ── Calendar Simulator State ──
  readonly calendarYear = signal<number>(new Date().getFullYear());
  readonly calendarSimulatorDay = signal<number>(10);
  readonly selectedSipInCalendar = signal<string>('custom');

  readonly availableYears = [2024, 2025, 2026, 2027];
  readonly commonSipDays = [1, 5, 10, 12, 15, 20, 25, 28];

  // ── SIP Wealth Calculator State ──
  calcMonthlyInvestment = 10000;
  calcExpectedReturnPct = 12;
  calcTenureYears = 10;
  calcStepUpEnabled = true;
  calcStepUpPct = 10;

  ngOnInit() {
    this.sipFormStartDate = this.calendarService.formatDate(new Date());
    this.loadUserAssets();
  }

  async loadUserAssets() {
    try {
      const assets = await this.assetService.getAssetsSnapshot();
      this.userAssets.set(assets);
    } catch {}
  }

  // ── Filtered SIPs ──
  readonly filteredSips = computed(() => {
    let list = this.sipService.sips();
    const cat = this.selectedCategory();
    const q = this.searchQuery().toLowerCase().trim();

    if (cat !== 'All') {
      list = list.filter((s) => s.category === cat);
    }

    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.schemeCode && s.schemeCode.includes(q)) ||
          (s.fundHouse && s.fundHouse.toLowerCase().includes(q)) ||
          (s.folioNumber && s.folioNumber.toLowerCase().includes(q)) ||
          (s.mandateAccount && s.mandateAccount.toLowerCase().includes(q))
      );
    }

    return list;
  });

  // ── Installments for Reconciliation View ──
  readonly reconcileInstallments = computed<
    Array<{ sip: Sip; installment: SipInstallment }>
  >(() => {
    const filter = this.reconcileFilter();
    const list: Array<{ sip: Sip; installment: SipInstallment }> = [];

    for (const sip of this.sipService.sips()) {
      for (const inst of sip.installments || []) {
        if (filter === 'pending') {
          // Awaiting allotment confirmation: scheduled date has arrived and allotment is pending
          if (inst.allotmentStatus === 'Pending') {
            list.push({ sip, installment: inst });
          }
        } else if (filter === 'confirmed') {
          if (inst.allotmentStatus === 'Confirmed') {
            list.push({ sip, installment: inst });
          }
        } else if (filter === 'failed') {
          if (inst.paymentStatus === 'Failed' || inst.allotmentStatus === 'Cancelled') {
            list.push({ sip, installment: inst });
          }
        } else {
          list.push({ sip, installment: inst });
        }
      }
    }

    // Sort: most recent execution date first
    return list.sort((a, b) => b.installment.scheduledDate.localeCompare(a.installment.scheduledDate));
  });

  // ── Live Preview of SIP Date in Add/Edit Modal ──
  readonly modalDateResolution = computed(() => {
    const day = this.sipFormDay || 10;
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), Math.min(day, 28));
    return this.calendarService.resolveTradingDay(target);
  });

  // ── Yearly Schedule for Simulator ──
  readonly simulatorSchedule = computed<YearlyScheduleEntry[]>(() => {
    const year = this.calendarYear();
    const day = this.calendarSimulatorDay();
    return this.calendarService.generateYearlySchedule(day, year);
  });

  // ── Simulator Statistics ──
  readonly simulatorStats = computed(() => {
    const sched = this.simulatorSchedule();
    const shifted = sched.filter((s) => s.wasShifted);
    const onTime = sched.filter((s) => !s.wasShifted);
    const totalShiftDays = shifted.reduce((sum, s) => sum + s.shiftDays, 0);
    const avgDelay = shifted.length > 0 ? (totalShiftDays / shifted.length).toFixed(1) : '0';

    return {
      totalInstallments: sched.length,
      onTimeCount: onTime.length,
      shiftedCount: shifted.length,
      avgDelayDays: avgDelay,
      totalDelayDays: totalShiftDays,
    };
  });

  readonly yearHolidays = computed<MarketHoliday[]>(() => {
    return this.calendarService.getHolidaysForYear(this.calendarYear());
  });

  readonly allExecutedInstallments = computed<
    Array<{ sip: Sip; installment: SipInstallment }>
  >(() => {
    const list: Array<{ sip: Sip; installment: SipInstallment }> = [];
    for (const sip of this.sipService.sips()) {
      for (const inst of sip.installments || []) {
        if (inst.allotmentStatus === 'Confirmed' || inst.status === 'Executed') {
          list.push({ sip, installment: inst });
        }
      }
    }
    return list.sort((a, b) => b.installment.executionDate.localeCompare(a.installment.executionDate));
  });

  // ── Calculator Projections ──
  readonly calculatorProjection = computed(() => {
    const monthly = this.calcMonthlyInvestment || 10000;
    const returnPct = this.calcExpectedReturnPct || 12;
    const years = this.calcTenureYears || 10;
    const stepUp = this.calcStepUpEnabled;
    const stepUpPct = this.calcStepUpPct || 10;

    const r = returnPct / 12 / 100;
    const totalMonths = years * 12;

    let invested = 0;
    let corpus = 0;
    let currentMonthly = monthly;

    const breakdown: Array<{
      year: number;
      yearlyInvestment: number;
      totalInvested: number;
      estimatedValue: number;
      wealthGained: number;
    }> = [];

    for (let m = 1; m <= totalMonths; m++) {
      if (stepUp && m > 1 && (m - 1) % 12 === 0) {
        currentMonthly += Math.round((currentMonthly * stepUpPct) / 100);
      }
      invested += currentMonthly;
      corpus = (corpus + currentMonthly) * (1 + r);

      if (m % 12 === 0) {
        const y = m / 12;
        breakdown.push({
          year: y,
          yearlyInvestment: currentMonthly * 12,
          totalInvested: Math.round(invested),
          estimatedValue: Math.round(corpus),
          wealthGained: Math.round(corpus - invested),
        });
      }
    }

    return {
      totalInvested: Math.round(invested),
      estimatedWealth: Math.round(corpus),
      wealthGain: Math.round(corpus - invested),
      growthMultiple: (corpus / invested).toFixed(1),
      yearlyBreakdown: breakdown,
    };
  });

  readonly calculatorResults = computed(() => {
    const baseP = this.calcMonthlyInvestment || 10000;
    const r = (this.calcExpectedReturnPct || 12) / 100 / 12;
    const n = (this.calcTenureYears || 10) * 12;
    const stepUp = this.calcStepUpEnabled ? (this.calcStepUpPct || 10) / 100 : 0;

    let totalInvested = 0;
    let futureValue = 0;
    let currentMonthly = baseP;

    for (let m = 1; m <= n; m++) {
      if (m > 1 && (m - 1) % 12 === 0 && stepUp > 0) {
        currentMonthly = Math.round(currentMonthly * (1 + stepUp));
      }
      totalInvested += currentMonthly;
      futureValue = (futureValue + currentMonthly) * (1 + r);
    }

    const estimatedWealthGain = Math.max(0, Math.round(futureValue - totalInvested));
    const roundedFV = Math.round(futureValue);

    return {
      totalInvested: Math.round(totalInvested),
      futureValue: roundedFV,
      estimatedWealthGain,
      wealthMultiplier: totalInvested > 0 ? (roundedFV / totalInvested).toFixed(1) : '1.0',
    };
  });

  readonly popularFundPresets = [
    { name: 'Parag Parikh Flexi Cap Fund - Direct Growth', house: 'PPFAS Mutual Fund', cat: 'MutualFund' as SipCategory, code: '122639' },
    { name: 'UTI Nifty 50 Index Fund - Direct Growth', house: 'UTI Mutual Fund', cat: 'MutualFund' as SipCategory, code: '120716' },
    { name: 'Quant Small Cap Fund - Direct Growth', house: 'Quant Mutual Fund', cat: 'MutualFund' as SipCategory, code: '120828' },
    { name: 'Mirae Asset Large Cap Fund - Direct Growth', house: 'Mirae Asset Mutual Fund', cat: 'MutualFund' as SipCategory, code: '118834' },
    { name: 'Nippon India ETF Gold BeES', house: 'Nippon India Mutual Fund', cat: 'Gold' as SipCategory, code: '105758' },
    { name: 'HDFC Mid-Cap Opportunities Fund - Direct Growth', house: 'HDFC Mutual Fund', cat: 'MutualFund' as SipCategory, code: '118989' },
  ];

  selectFundPreset(preset: { name: string; house: string; cat: SipCategory; code?: string }) {
    this.sipFormName = preset.name;
    this.sipFormFundHouse = preset.house;
    this.sipFormCategory = preset.cat;
    if (preset.code) {
      this.sipFormSchemeCode = preset.code;
    }
  }

  setSimulatorDay(day: number) {
    this.calendarSimulatorDay.set(day);
  }

  onSimulatorSipChange(val: string) {
    this.selectedSipInCalendar.set(val);
    if (val !== 'custom') {
      const found = this.sipService.sips().find((s) => s.id === val);
      if (found) {
        this.calendarSimulatorDay.set(found.sipDay);
      }
    }
  }

  // ── Scheme Search ──
  async onSearchSchemeInput(val: string) {
    if (!val || val.length < 3) {
      this.schemeSearchResults.set([]);
      return;
    }
    this.isSearchingSchemes.set(true);
    try {
      const results = await this.navService.searchSchemes(val);
      this.schemeSearchResults.set(results);
    } finally {
      this.isSearchingSchemes.set(false);
    }
  }

  selectScheme(scheme: { schemeCode: string; schemeName: string }) {
    this.sipFormName = scheme.schemeName;
    this.sipFormSchemeCode = scheme.schemeCode;
    this.schemeSearchResults.set([]);
  }

  // ── Open Add/Edit Modal ──
  openAddModal() {
    this.editingSipId.set(null);
    this.sipFormName = '';
    this.sipFormCategory = 'MutualFund';
    this.sipFormSchemeCode = '';
    this.sipFormIsin = '';
    this.sipFormPlanType = 'Direct';
    this.sipFormOption = 'Growth';
    this.sipFormFundHouse = '';
    this.sipFormFolio = '';
    this.sipFormMandate = 'HDFC Bank - OTM Autopay (...4819)';
    this.sipFormAmount = 5000;
    this.sipFormFrequency = 'Monthly';
    this.sipFormDay = 10;
    this.sipFormStartDate = this.calendarService.formatDate(new Date());
    this.sipFormEndDate = '';
    this.sipFormAutoExecute = true;
    this.sipFormStepUpEnabled = false;
    this.sipFormStepUpType = 'percentage';
    this.sipFormStepUpValue = 10;
    this.sipFormLinkedAssetId = '';
    this.sipFormDataSource = 'CAS';
    this.sipFormNotes = '';
    this.showAddEditModal.set(true);
  }

  openEditModal(sip: Sip) {
    this.editingSipId.set(sip.id);
    this.sipFormName = sip.name;
    this.sipFormCategory = sip.category;
    this.sipFormSchemeCode = sip.schemeCode || '';
    this.sipFormIsin = sip.isin || '';
    this.sipFormPlanType = sip.planType || 'Direct';
    this.sipFormOption = sip.option || 'Growth';
    this.sipFormFundHouse = sip.fundHouse || '';
    this.sipFormFolio = sip.folioNumber || '';
    this.sipFormMandate = sip.mandateAccount || '';
    this.sipFormAmount = sip.amount;
    this.sipFormFrequency = sip.frequency;
    this.sipFormDay = sip.sipDay;
    this.sipFormStartDate = sip.startDate;
    this.sipFormEndDate = sip.endDate || '';
    this.sipFormAutoExecute = sip.autoExecute !== undefined ? sip.autoExecute : true;
    this.sipFormStepUpEnabled = !!(sip.stepUp && sip.stepUp.enabled);
    this.sipFormStepUpType = sip.stepUp?.type || 'percentage';
    this.sipFormStepUpValue = sip.stepUp?.value || 10;
    this.sipFormLinkedAssetId = sip.linkedAssetId || '';
    this.sipFormDataSource = sip.dataSource || 'CAS';
    this.sipFormNotes = sip.notes || '';
    this.showAddEditModal.set(true);
  }

  closeAddEditModal() {
    this.showAddEditModal.set(false);
    this.editingSipId.set(null);
    this.schemeSearchResults.set([]);
  }

  async saveSip() {
    if (!this.sipFormName.trim()) {
      this.snackbar.show('Please provide a scheme or asset name.', 'info');
      return;
    }

    if (this.sipFormAmount <= 0) {
      this.snackbar.show('Please provide a valid SIP installment amount.', 'info');
      return;
    }

    const sipData = {
      name: this.sipFormName.trim(),
      category: this.sipFormCategory,
      schemeCode: this.sipFormSchemeCode.trim() || undefined,
      isin: this.sipFormIsin.trim() || undefined,
      planType: this.sipFormPlanType,
      option: this.sipFormOption,
      fundHouse: this.sipFormFundHouse.trim() || undefined,
      folioNumber: this.sipFormFolio.trim() || undefined,
      mandateAccount: this.sipFormMandate.trim() || undefined,
      amount: Number(this.sipFormAmount),
      frequency: this.sipFormFrequency,
      sipDay: Number(this.sipFormDay) || 10,
      startDate: this.sipFormStartDate || this.calendarService.formatDate(new Date()),
      endDate: this.sipFormEndDate.trim() || undefined,
      status: 'Active' as const,
      autoExecute: this.sipFormAutoExecute,
      executionMode: 'External' as const,
      dataSource: this.sipFormDataSource,
      stepUp: this.sipFormStepUpEnabled
        ? {
            enabled: true,
            type: this.sipFormStepUpType,
            value: Number(this.sipFormStepUpValue) || 10,
            frequencyMonths: 12,
          }
        : undefined,
      linkedAssetId: this.sipFormLinkedAssetId || undefined,
      notes: this.sipFormNotes.trim() || undefined,
    };

    if (this.editingSipId()) {
      await this.sipService.updateSip(this.editingSipId()!, sipData);
    } else {
      await this.sipService.createSip(sipData);
    }

    this.closeAddEditModal();
  }

  // ── Manual Allotment Confirmation Modal ──
  async openManualConfirmationModal(sip: Sip, inst: SipInstallment) {
    this.confirmingInstallment.set({ sip, installment: inst });
    this.confirmAllotmentDate = inst.executionDate;
    this.confirmRef = inst.externalReference || '';
    this.confirmNotes = '';

    // Pre-populate NAV if already available
    if (inst.nav && inst.nav > 0) {
      this.confirmNav = inst.nav;
      this.confirmUnits = inst.units || Math.round((inst.amount / inst.nav) * 1000) / 1000;
    } else {
      await this.fetchNavForConfirmationDate();
    }

    this.showManualAllotmentModal.set(true);
  }

  closeManualConfirmationModal() {
    this.showManualAllotmentModal.set(false);
    this.confirmingInstallment.set(null);
  }

  async fetchNavForConfirmationDate() {
    const item = this.confirmingInstallment();
    if (!item) return;

    this.isFetchingNav.set(true);
    try {
      const code = item.sip.schemeCode || item.sip.isin || item.sip.name;
      const snapshot = await this.navService.getNavForDate(code, this.confirmAllotmentDate);
      if (snapshot && snapshot.nav > 0) {
        this.confirmNav = snapshot.nav;
        this.confirmUnits = Math.round((item.installment.amount / snapshot.nav) * 1000) / 1000;
        this.snackbar.show(
          `Fetched AMFI NAV: ₹${snapshot.nav} (${snapshot.navDate})${snapshot.delayed ? ' [Prior Trading Session]' : ''}`,
          'info'
        );
      } else {
        this.snackbar.show('Could not automatically retrieve AMFI NAV. Please enter manually.', 'info');
      }
    } finally {
      this.isFetchingNav.set(false);
    }
  }

  onNavOrUnitsChange(field: 'nav' | 'units') {
    const item = this.confirmingInstallment();
    if (!item) return;

    if (field === 'nav' && this.confirmNav > 0) {
      this.confirmUnits = Math.round((item.installment.amount / this.confirmNav) * 1000) / 1000;
    } else if (field === 'units' && this.confirmUnits > 0) {
      this.confirmNav = Math.round((item.installment.amount / this.confirmUnits) * 1000) / 1000;
    }
  }

  async submitManualConfirmation() {
    const item = this.confirmingInstallment();
    if (!item) return;

    if (this.confirmNav <= 0 || this.confirmUnits <= 0) {
      this.snackbar.show('NAV and Allotted Units must be greater than zero.', 'error');
      return;
    }

    try {
      await this.sipService.confirmInstallmentManually(item.sip.id, item.installment.id, {
        allotmentDate: this.confirmAllotmentDate,
        nav: this.confirmNav,
        units: this.confirmUnits,
        externalRef: this.confirmRef,
        notes: this.confirmNotes,
      });
      this.closeManualConfirmationModal();
    } catch (e: any) {
      this.snackbar.show(e.message || 'Failed to confirm allotment.', 'error');
    }
  }

  // ── Open Single SIP Schedule Modal ──
  openScheduleModal(sip: Sip) {
    this.selectedSipForSchedule.set(sip);
    this.showScheduleModal.set(true);
  }

  closeScheduleModal() {
    this.showScheduleModal.set(false);
    this.selectedSipForSchedule.set(null);
  }

  // ── Open Single SIP History Modal ──
  openHistoryModal(sip: Sip) {
    this.selectedSipForHistory.set(sip);
    this.showHistoryModal.set(true);
  }

  closeHistoryModal() {
    this.showHistoryModal.set(false);
    this.selectedSipForHistory.set(null);
  }

  // ── Actions ──
  async togglePause(sip: Sip) {
    await this.sipService.togglePauseSip(sip.id);
  }

  async cancelPlan(sip: Sip) {
    if (confirm(`Are you sure you want to cancel the SIP plan "${sip.name}"? Historical confirmed investments will be strictly preserved.`)) {
      await this.sipService.cancelSip(sip.id);
    }
  }

  async deleteSip(sip: Sip) {
    if (confirm(`Are you sure you want to delete SIP for "${sip.name}"?`)) {
      await this.sipService.deleteSip(sip.id);
    }
  }

  async syncSchedules() {
    await this.sipService.syncAllSipSchedules(false);
  }

  // ── Helper formatters ──
  formatDateStr(str?: string): string {
    if (!str) return '—';
    return this.calendarService.formatReadableDate(str);
  }

  // ── Export Statements (PDF, Excel, CSV) ──
  async exportStatement(format: 'pdf' | 'excel') {
    try {
      await this.reportExport.exportSipsReport(format, {
        sips: this.sipService.sips(),
        metrics: this.sipService.summaryMetrics(),
      });
      this.snackbar.show(`Exported SIP Statement (${format.toUpperCase()})`, 'success');
    } catch (e: any) {
      this.snackbar.show(`Failed to export statement: ${e.message}`, 'error');
    }
  }

  exportCsv() {
    try {
      const sips = this.sipService.sips();
      const rows: (string | number)[][] = [
        [`# FinTracker Systematic Investment Plans (SIP) Export`],
        [`# Exported: ${new Date().toLocaleString('en-IN')}`],
        [],
        ['Plan Name', 'Scheme Code', 'Category', 'Frequency', 'Debit Day', 'Amount (INR)', 'Status', 'Next Execution Date', 'Annual Step-Up']
      ];
      sips.forEach((s) => {
        rows.push([
          `"${(s.name || '').replace(/"/g, '""')}"`,
          s.schemeCode || 'N/A',
          s.category,
          s.frequency,
          s.sipDay,
          s.amount,
          s.status,
          s.nextExecutionDate || '',
          s.stepUp?.enabled ? `${s.stepUp.value}%` : 'None'
        ]);
      });
      const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
      this.reportExport.downloadBlob(blob, `fintracker_sips_${new Date().toISOString().slice(0, 10)}.csv`);
      this.snackbar.show('Exported SIPs CSV', 'success');
    } catch (e: any) {
      this.snackbar.show(`Failed to export CSV: ${e.message}`, 'error');
    }
  }
}
