import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SipService } from '../../services/sip.service';
import { MarketCalendarService } from '../../services/market-calendar.service';
import { SnackbarService } from '../../services/snackbar.service';
import { AssetService } from '../../services/asset.service';
import { ReportExportService } from '../../services/report-export.service';
import {
  Sip,
  SipCategory,
  SipFrequency,
  SipInstallment,
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
  private snackbar = inject(SnackbarService);
  private assetService = inject(AssetService);
  public reportExport = inject(ReportExportService);

  // ── Navigation & View State ──
  readonly activeTab = signal<'active' | 'calendar' | 'history' | 'calculator'>('active');
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

  // ── Form State (Add / Edit) ──
  sipFormName = '';
  sipFormCategory: SipCategory = 'MutualFund';
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
  sipFormNotes = '';

  // ── User's Existing Assets (for linking) ──
  readonly userAssets = signal<Asset[]>([]);

  // ── Calendar Simulator State ──
  readonly calendarYear = signal<number>(new Date().getFullYear());
  readonly calendarSimulatorDay = signal<number>(10);
  readonly selectedSipInCalendar = signal<string>('custom');

  // Available Years for Market Calendar (2024 to 2027)
  readonly availableYears = [2024, 2025, 2026, 2027];

  // Common SIP date presets (1, 5, 10, 15, 20, 25, 28)
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
          (s.fundHouse && s.fundHouse.toLowerCase().includes(q)) ||
          (s.folioNumber && s.folioNumber.toLowerCase().includes(q)) ||
          (s.mandateAccount && s.mandateAccount.toLowerCase().includes(q))
      );
    }

    return list;
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

  // ── Holidays for the Selected Calendar Year ──
  readonly yearHolidays = computed<MarketHoliday[]>(() => {
    return this.calendarService.getHolidaysForYear(this.calendarYear());
  });

  // ── All Executed Installments Across All SIPs (Audit Trail) ──
  readonly allExecutedInstallments = computed<
    Array<{ sip: Sip; installment: SipInstallment }>
  >(() => {
    const list: Array<{ sip: Sip; installment: SipInstallment }> = [];
    for (const sip of this.sipService.sips()) {
      for (const inst of sip.installments || []) {
        list.push({ sip, installment: inst });
      }
    }
    return list.sort((a, b) => b.installment.executionDate.localeCompare(a.installment.executionDate));
  });

  // ── SIP Wealth Calculator Projections ──
  readonly calculatorResults = computed(() => {
    const baseP = this.calcMonthlyInvestment;
    const r = this.calcExpectedReturnPct / 100 / 12; // monthly rate
    const n = this.calcTenureYears * 12; // total months
    const stepUp = this.calcStepUpEnabled ? this.calcStepUpPct / 100 : 0;

    let totalInvested = 0;
    let futureValue = 0;
    let currentMonthly = baseP;

    // Month by month compounding calculation with annual step up
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
      estimatedWealthGain,
      futureValue: roundedFV,
      wealthMultiplier: totalInvested > 0 ? (roundedFV / totalInvested).toFixed(1) : '1.0',
    };
  });

  // ── Quick Popular Fund Presets ──
  readonly popularFundPresets = [
    { name: 'Parag Parikh Flexi Cap Fund - Direct Growth', house: 'PPFAS Mutual Fund', cat: 'MutualFund' as SipCategory },
    { name: 'UTI Nifty 50 Index Fund - Direct Growth', house: 'UTI Mutual Fund', cat: 'MutualFund' as SipCategory },
    { name: 'Quant Small Cap Fund - Direct Growth', house: 'Quant Mutual Fund', cat: 'MutualFund' as SipCategory },
    { name: 'Mirae Asset Large Cap Fund - Direct Growth', house: 'Mirae Asset Mutual Fund', cat: 'MutualFund' as SipCategory },
    { name: 'Nippon India ETF Gold BeES', house: 'Nippon India Mutual Fund', cat: 'Gold' as SipCategory },
    { name: 'HDFC Mid-Cap Opportunities Fund', house: 'HDFC Mutual Fund', cat: 'MutualFund' as SipCategory },
  ];

  selectFundPreset(preset: { name: string; house: string; cat: SipCategory }) {
    this.sipFormName = preset.name;
    this.sipFormFundHouse = preset.house;
    this.sipFormCategory = preset.cat;
  }

  // ── Simulator Calendar Day / SIP Select ──
  onSimulatorSipChange(val: string) {
    this.selectedSipInCalendar.set(val);
    if (val !== 'custom') {
      const found = this.sipService.sips().find((s) => s.id === val);
      if (found) {
        this.calendarSimulatorDay.set(found.sipDay || 10);
      }
    }
  }

  setSimulatorDay(day: number) {
    this.calendarSimulatorDay.set(day);
    this.selectedSipInCalendar.set('custom');
  }

  setCalendarYear(year: number) {
    this.calendarYear.set(year);
  }

  // ── Open Add/Edit Modal ──
  openAddModal() {
    this.editingSipId.set(null);
    this.sipFormName = '';
    this.sipFormCategory = 'MutualFund';
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
    this.sipFormNotes = '';
    this.showAddEditModal.set(true);
  }

  openEditModal(sip: Sip) {
    this.editingSipId.set(sip.id);
    this.sipFormName = sip.name;
    this.sipFormCategory = sip.category;
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
    this.sipFormNotes = sip.notes || '';
    this.showAddEditModal.set(true);
  }

  closeAddEditModal() {
    this.showAddEditModal.set(false);
    this.editingSipId.set(null);
  }

  async saveSip() {
    if (!this.sipFormName.trim()) {
      this.snackbar.show('Please provide a fund or asset name.', 'info');
      return;
    }

    if (this.sipFormAmount <= 0) {
      this.snackbar.show('Please provide a valid SIP installment amount.', 'info');
      return;
    }

    const sipData = {
      name: this.sipFormName.trim(),
      category: this.sipFormCategory,
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
      this.snackbar.show(`SIP "${sipData.name}" updated successfully.`, 'success');
    } else {
      await this.sipService.addSip(sipData);
      this.snackbar.show(`SIP "${sipData.name}" created and scheduled!`, 'success');
    }

    this.closeAddEditModal();
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

  async executeNow(sip: Sip) {
    await this.sipService.manuallyExecuteNow(sip.id);
  }

  async skipNext(sip: Sip) {
    await this.sipService.skipNextInstallment(sip.id);
  }

  async deleteSip(sip: Sip) {
    if (confirm(`Are you sure you want to delete SIP for "${sip.name}"? Past recorded transactions will remain safe in your transactions ledger.`)) {
      await this.sipService.deleteSip(sip.id);
      this.snackbar.show(`Deleted SIP "${sip.name}".`, 'info');
    }
  }

  async runAutoDebitCheck() {
    await this.sipService.checkAndAutoExecuteSips(true);
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
        ['Plan Name', 'Category', 'Frequency', 'Debit Day', 'Amount (INR)', 'Status', 'Next Execution Date', 'Annual Step-Up']
      ];
      sips.forEach((s) => {
        rows.push([
          `"${(s.name || '').replace(/"/g, '""')}"`,
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
