import { Component, inject, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SipService } from '../../services/sip.service';
import { GoalService } from '../../services/goal.service';
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
import { Asset, AssetType } from '../../models/finance.models';

@Component({
  selector: 'app-sip',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './sip.component.html',
  styleUrls: ['./sip.component.scss'],
})
export class SipComponent implements OnInit {
  public sipService = inject(SipService);
  goalService = inject(GoalService);
  public calendarService = inject(MarketCalendarService);
  public navService = inject(AmfiNavService);
  private snackbar = inject(SnackbarService);

  showExportDropdown = signal(false);
  showDeleteModal = signal(false);
  sipPendingDeletion = signal<Sip | null>(null);
  deleting = signal(false);

  // ── Skip Modal State & Urgent 3-day Notice ──
  readonly showSkipModal = signal<boolean>(false);
  readonly sipToSkip = signal<Sip | null>(null);
  readonly skipWorkingDays = signal<number>(0);
  readonly dismissedUrgentSipIds = signal<Set<string>>(new Set());

  readonly urgentUpcomingSips = computed(() => {
    const todayStr = this.calendarService.formatDate(new Date());
    const dismissed = this.dismissedUrgentSipIds();

    return this.sipService
      .sips()
      .filter(
        (s) =>
          s.status === 'Active' &&
          s.nextExecutionDate &&
          s.nextExecutionDate >= todayStr &&
          !dismissed.has(s.id)
      )
      .map((s) => {
        const workingDays = this.calendarService.getTradingDaysRemaining(s.nextExecutionDate!);
        return {
          sip: s,
          workingDays,
          isUrgent: workingDays <= 3,
        };
      })
      .filter((item) => item.isUrgent)
      .sort((a, b) => a.workingDays - b.workingDays);
  });

  toggleExportDropdown(event?: Event) {
    if (event) event.stopPropagation();
    this.showExportDropdown.update(v => !v);
  }

  @HostListener('document:click')
  closeExportDropdown() {
    this.showExportDropdown.set(false);
  }
  private assetService = inject(AssetService);
  public reportExport = inject(ReportExportService);

  // ── Navigation & View State ──
  readonly activeTab = signal<'active' | 'reconcile' | 'calendar' | 'history' | 'calculator'>('active');
  readonly selectedCategory = signal<string>('All');
  readonly searchQuery = signal<string>('');
  readonly viewMode = signal<'cards' | 'table'>('table');

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
  sipFormGoalId = '';
  readonly showAdvancedModalFields = signal<boolean>(false);

  toggleAdvancedFields() {
    this.showAdvancedModalFields.update(v => !v);
  }

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
  readonly sipFormCategorySignal = signal<SipCategory>('MutualFund');
  readonly schemeSelectMode = signal<'asset' | 'amfi' | 'custom'>('asset');

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

  // ── User's Existing Assets (for linking and dropdown selection) ──
  readonly userAssets = signal<Asset[]>([]);

  readonly categoryAssets = computed<Asset[]>(() => {
    const cat = this.sipFormCategorySignal();
    const assets = this.userAssets();

    switch (cat) {
      case 'MutualFund':
        return assets.filter(
          (a) => a.type === AssetType.MutualFund || (a.type as string) === 'Mutual Fund'
        );
      case 'Stock':
        return assets.filter(
          (a) =>
            a.type === AssetType.Stock ||
            a.type === AssetType.USStock ||
            (a.type as string) === 'US Stock'
        );
      case 'ETF':
        return assets.filter((a) => a.type === AssetType.ETF);
      case 'Gold':
        return assets.filter((a) => a.type === AssetType.Gold);
      case 'Crypto':
        return assets.filter((a) => a.type === AssetType.Crypto);
      case 'Other':
        return assets.filter(
          (a) =>
            ![
              'MutualFund',
              'Mutual Fund',
              'Stock',
              'USStock',
              'US Stock',
              'ETF',
              'Gold',
              'Crypto',
            ].includes(a.type as string)
        );
      default:
        return assets;
    }
  });

  onCategoryChange(cat: SipCategory) {
    this.sipFormCategory = cat;
    this.sipFormCategorySignal.set(cat);

    const matching = this.categoryAssets();
    if (this.sipFormLinkedAssetId) {
      const stillValid = matching.some((a) => a.id === this.sipFormLinkedAssetId);
      if (!stillValid) {
        this.sipFormLinkedAssetId = '';
      }
    }

    if (matching.length > 0) {
      this.schemeSelectMode.set('asset');
    } else if (cat === 'MutualFund' || cat === 'ETF') {
      this.schemeSelectMode.set('amfi');
    } else {
      this.schemeSelectMode.set('custom');
    }
  }

  onSelectExistingAsset(assetId: string) {
    this.sipFormLinkedAssetId = assetId;
    if (!assetId) return;

    const asset = this.userAssets().find((a) => a.id === assetId);
    if (!asset) return;

    this.sipFormName = asset.name;
    this.sipFormSchemeCode = asset.symbol || '';
    this.sipFormIsin = asset.isin || '';

    const lowerName = asset.name.toLowerCase();
    const amcList = [
      'Parag Parikh', 'PPFAS', 'UTI', 'HDFC', 'SBI', 'ICICI Prudential', 'Mirae Asset',
      'Quant', 'Nippon India', 'Axis', 'Kotak', 'Tata', 'Bandhan', 'DSP', 'Motilal Oswal',
      'Aditya Birla Sun Life', 'Canara Robeco', 'Edelweiss', 'Invesco', 'Franklin Templeton'
    ];
    for (const amc of amcList) {
      if (lowerName.includes(amc.toLowerCase())) {
        this.sipFormFundHouse = `${amc} Mutual Fund`;
        break;
      }
    }

    this.sipFormPlanType = lowerName.includes('regular') ? 'Regular' : 'Direct';
    this.sipFormOption = lowerName.includes('idcw') || lowerName.includes('dividend') ? 'IDCW' : 'Growth';
  }

  getLinkedAssetName(): string {
    if (!this.sipFormLinkedAssetId) return '';
    const asset = this.userAssets().find((a) => a.id === this.sipFormLinkedAssetId);
    return asset ? asset.name : '';
  }

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

  // ── Table Sorting State ──
  readonly sortField = signal<'name' | 'schemeCode' | 'amount' | 'frequency' | 'sipDay' | 'nextExecutionDate' | 'totalInvested' | 'status'>('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  toggleSort(field: 'name' | 'schemeCode' | 'amount' | 'frequency' | 'sipDay' | 'nextExecutionDate' | 'totalInvested' | 'status') {
    if (this.sortField() === field) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortDirection.set(field === 'amount' || field === 'totalInvested' ? 'desc' : 'asc');
    }
  }

  getSortIcon(field: 'name' | 'schemeCode' | 'amount' | 'frequency' | 'sipDay' | 'nextExecutionDate' | 'totalInvested' | 'status'): string {
    if (this.sortField() !== field) return 'unfold_more';
    return this.sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward';
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

    const field = this.sortField();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return list.slice().sort((a, b) => {
      let diff = 0;
      switch (field) {
        case 'name':
          diff = (a.name || '').localeCompare(b.name || '');
          break;
        case 'schemeCode':
          diff = (a.schemeCode || '').localeCompare(b.schemeCode || '');
          break;
        case 'amount':
          diff = a.amount - b.amount;
          break;
        case 'frequency':
          diff = (a.frequency || '').localeCompare(b.frequency || '');
          break;
        case 'sipDay':
          diff = (a.sipDay || 0) - (b.sipDay || 0);
          break;
        case 'nextExecutionDate':
          diff = (a.nextExecutionDate || '').localeCompare(b.nextExecutionDate || '');
          break;
        case 'totalInvested':
          diff = (a.totalInvested || 0) - (b.totalInvested || 0);
          break;
        case 'status':
          diff = (a.status || '').localeCompare(b.status || '');
          break;
      }
      return diff * dir;
    });
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

  async selectScheme(scheme: { schemeCode: string; schemeName: string }) {
    this.sipFormName = scheme.schemeName;
    this.sipFormSchemeCode = scheme.schemeCode;
    this.schemeSearchResults.set([]);

    // Auto-detect Plan Type & Option
    const lower = scheme.schemeName.toLowerCase();
    this.sipFormPlanType = lower.includes('regular') ? 'Regular' : 'Direct';
    this.sipFormOption = lower.includes('idcw') || lower.includes('dividend') ? 'IDCW' : 'Growth';

    // Auto-detect AMC / Fund House from scheme name prefix
    const amcList = [
      'Parag Parikh', 'PPFAS', 'UTI', 'HDFC', 'SBI', 'ICICI Prudential', 'Mirae Asset',
      'Quant', 'Nippon India', 'Axis', 'Kotak', 'Tata', 'Bandhan', 'DSP', 'Motilal Oswal',
      'Aditya Birla Sun Life', 'Canara Robeco', 'Edelweiss', 'Invesco', 'Franklin Templeton'
    ];
    for (const amc of amcList) {
      if (scheme.schemeName.toLowerCase().startsWith(amc.toLowerCase()) || scheme.schemeName.toLowerCase().includes(amc.toLowerCase())) {
        this.sipFormFundHouse = `${amc} Mutual Fund`;
        break;
      }
    }

    // Try fetching latest NAV & ISIN snapshot in background
    try {
      const snap = await this.navService.getNavForDate(scheme.schemeCode);
      if (snap?.isin) {
        this.sipFormIsin = snap.isin;
      }
    } catch {}
  }

  // ── Open Add/Edit Modal ──
  openAddModal() {
    this.showAdvancedModalFields.set(false);
    this.editingSipId.set(null);
    this.sipFormName = '';
    this.sipFormGoalId = '';
    this.sipFormCategory = 'MutualFund';
    this.sipFormCategorySignal.set('MutualFund');
    this.sipFormSchemeCode = '';
    this.sipFormIsin = '';
    this.sipFormPlanType = 'Direct';
    this.sipFormOption = 'Growth';
    this.sipFormFundHouse = '';
    this.sipFormFolio = '';
    this.sipFormMandate = '';
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
    this.schemeSearchResults.set([]);
    this.schemeSelectMode.set(this.categoryAssets().length > 0 ? 'asset' : 'amfi');
    this.showAddEditModal.set(true);
  }

  openEditModal(sip: Sip) {
    this.showAdvancedModalFields.set(
      !!(sip.folioNumber || sip.mandateAccount || sip.schemeCode || sip.isin || sip.fundHouse || sip.stepUp?.enabled || sip.notes)
    );
    this.editingSipId.set(sip.id);
    this.sipFormName = sip.name;
    this.sipFormGoalId = sip.goalId || '';
    this.sipFormCategory = sip.category;
    this.sipFormCategorySignal.set(sip.category);
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
    this.schemeSearchResults.set([]);

    if (sip.linkedAssetId) {
      this.schemeSelectMode.set('asset');
    } else if (sip.schemeCode) {
      this.schemeSelectMode.set('amfi');
    } else {
      this.schemeSelectMode.set('custom');
    }

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

    const linkedAsset = this.sipFormLinkedAssetId
      ? this.userAssets().find((a) => a.id === this.sipFormLinkedAssetId)
      : undefined;

    const selectedGoal = this.sipFormGoalId
      ? this.goalService.goals().find((g) => g.id === this.sipFormGoalId)
      : undefined;

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
      linkedAssetName: linkedAsset?.name || undefined,
      goalId: this.sipFormGoalId || undefined,
      goalName: selectedGoal?.name || undefined,
      notes: this.sipFormNotes.trim() || undefined,
    };

    if (this.editingSipId()) {
      await this.sipService.updateSip(this.editingSipId()!, sipData);
    } else {
      await this.sipService.createSip(sipData);
    }

    this.closeAddEditModal();
  }

  // ── Skip Installment Handlers ──
  openSkipModal(sip: Sip) {
    const nextDate = sip.nextExecutionDate;
    const workingDays = nextDate
      ? this.calendarService.getTradingDaysRemaining(nextDate)
      : 0;

    this.sipToSkip.set(sip);
    this.skipWorkingDays.set(workingDays);
    this.showSkipModal.set(true);
  }

  closeSkipModal() {
    this.showSkipModal.set(false);
    this.sipToSkip.set(null);
    this.skipWorkingDays.set(0);
  }

  async confirmSkipSip() {
    const sip = this.sipToSkip();
    if (!sip) return;

    const workingDays = this.skipWorkingDays();
    const reason =
      workingDays <= 3
        ? `Skipped by user within 3 working days notice cutoff (${workingDays} working days remaining)`
        : `Skipped by user (${workingDays} working days ahead)`;

    await this.sipService.skipNextInstallment(sip.id, reason);
    this.closeSkipModal();
  }

  dismissUrgentNotice(sipId: string) {
    this.dismissedUrgentSipIds.update((set) => {
      const updated = new Set(set);
      updated.add(sipId);
      return updated;
    });
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

  deleteSip(sip: Sip) {
    this.sipPendingDeletion.set(sip);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal() {
    this.showDeleteModal.set(false);
    this.sipPendingDeletion.set(null);
  }

  async confirmDeleteSip() {
    const sip = this.sipPendingDeletion();
    if (!sip) return;
    this.deleting.set(true);
    try {
      await this.sipService.deleteSip(sip.id);
      this.snackbar.show(`Deleted SIP for "${sip.name}"`, 'success');
      this.closeDeleteModal();
    } catch (e: any) {
      this.snackbar.show(e.message || 'Failed to delete SIP', 'error');
    } finally {
      this.deleting.set(false);
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

  getOrdinal(n: number): string {
    if (!n) return '';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  getOrdinalSuffix(n: number): string {
    if (!n) return 'th';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  getHolidayDayName(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  getHolidayDayNum(dateStr: string): string {
    if (!dateStr) return '';
    return dateStr.split('-')[2] || '';
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
