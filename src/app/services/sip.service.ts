import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import {
  Sip,
  SipInstallment,
  SipSummaryMetrics,
  YearlyScheduleEntry,
} from '../models/sip.models';
import { MarketCalendarService } from './market-calendar.service';
import { AmfiNavService } from './amfi-nav.service';
import { SipReconciliationService } from './sip-reconciliation.service';
import { SnackbarService } from './snackbar.service';
import { CasMutualFundHolding } from './cas-parser.service';

const STORAGE_KEY = 'finance_tracker_sips_v2';
const LAST_SCHEDULE_SYNC_KEY = 'finance_tracker_sip_last_schedule_sync';

@Injectable({
  providedIn: 'root',
})
export class SipService {
  private firestore = inject(Firestore, { optional: true });
  private auth = inject(Auth, { optional: true });
  private calendar = inject(MarketCalendarService);
  private navService = inject(AmfiNavService);
  private reconciliationService = inject(SipReconciliationService);
  private snackbar = inject(SnackbarService);

  readonly sips = signal<Sip[]>([]);
  readonly loading = signal<boolean>(false);
  readonly syncing = signal<boolean>(false);
  readonly lastSyncTime = signal<string>(this.loadLastSyncTime());
  readonly pendingReconciliationNotice = signal<{ count: number; sips: string[] } | null>(null);

  constructor() {
    this.loadSips();
  }

  // ── Summary Metrics ──
  readonly summaryMetrics = computed<SipSummaryMetrics>(() => {
    const list = this.sips();
    const active = list.filter((s) => s.status === 'Active');

    let totalMonthlyCommitment = 0;
    let totalInvested = 0; // Confirmed invested total ONLY
    let totalPlannedCommitted = 0;
    let totalConfirmedInstallments = 0;
    let totalPendingAllotments = 0;

    const today = new Date();
    const todayStr = this.calendar.formatDate(today);

    let closestUpcoming: {
      sipId: string;
      sipName: string;
      amount: number;
      scheduledDate: string;
      executionDate: string;
      daysRemaining: number;
      wasShifted: boolean;
      shiftReason?: string;
    } | undefined;
    let minDiffDays = Infinity;

    for (const sip of list) {
      // Confirmed amounts ONLY
      totalInvested += sip.totalInvested || 0;

      const installments = sip.installments || [];
      for (const inst of installments) {
        totalPlannedCommitted += inst.amount;
        if (inst.allotmentStatus === 'Confirmed' || inst.status === 'Executed') {
          totalConfirmedInstallments++;
        } else if (inst.executionDate <= todayStr && inst.allotmentStatus === 'Pending') {
          totalPendingAllotments++;
        }
      }

      if (sip.status === 'Active') {
        let monthlyEquiv = sip.amount;
        if (sip.frequency === 'Weekly') monthlyEquiv = sip.amount * 4.33;
        else if (sip.frequency === 'Quarterly') monthlyEquiv = sip.amount / 3;
        totalMonthlyCommitment += monthlyEquiv;

        // Upcoming execution calculation
        const nextExecStr = sip.nextExecutionDate || this.calculateNextExecutionDate(sip);
        if (nextExecStr) {
          const nextDate = this.calendar.parseDate(nextExecStr);
          const diffMs = nextDate.getTime() - today.getTime();
          const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (daysRemaining >= 0 && daysRemaining < minDiffDays) {
            minDiffDays = daysRemaining;
            const res = this.calendar.resolveTradingDay(nextExecStr);
            closestUpcoming = {
              sipId: sip.id,
              sipName: sip.name,
              amount: sip.amount,
              scheduledDate: res.scheduledDate,
              executionDate: res.executionDate,
              daysRemaining,
              wasShifted: res.wasShifted,
              shiftReason: res.reason,
            };
          }
        }
      }
    }

    return {
      totalActiveSips: active.length,
      totalMonthlyCommitment: Math.round(totalMonthlyCommitment),
      totalInvested: Math.round(totalInvested),
      totalPlannedCommitted: Math.round(totalPlannedCommitted),
      totalConfirmedInstallments,
      totalPendingAllotments,
      nextUpcomingSip: closestUpcoming,
      marketStatus: this.calendar.getMarketStatus(),
    };
  });

  // ── Scheduled Installment Engine (Deterministic & Idempotent) ──

  /**
   * Generates expected installments for an active SIP up to `monthsAhead` months into the future.
   * Uses deterministic IDs `${sipId}_${YYYYMMDD}` to ensure strict idempotency across multiple runs.
   * Never marks payment or allotment as completed solely because dates pass.
   */
  generateExpectedInstallments(sip: Sip, monthsAhead = 3): SipInstallment[] {
    if (sip.status === 'Cancelled' || sip.status === 'Paused') {
      return sip.installments || [];
    }

    const today = new Date();
    const todayStr = this.calendar.formatDate(today);
    const startDate = this.calendar.parseDate(sip.startDate || todayStr);
    const endDate = sip.endDate ? this.calendar.parseDate(sip.endDate) : null;

    // Existing installments indexed by deterministic ID and scheduledDate
    const existingMap = new Map<string, SipInstallment>();
    (sip.installments || []).forEach((inst) => {
      existingMap.set(inst.id, inst);
      if (inst.scheduledDate) {
        existingMap.set(inst.scheduledDate, inst);
      }
    });

    const results: SipInstallment[] = [...(sip.installments || [])];

    // Determine planning window:
    // Start generating from whichever is earlier: startDate or the current month,
    // up to `monthsAhead` from today.
    let currYear = Math.max(startDate.getFullYear(), today.getFullYear() - 1);
    let currMonth = currYear === today.getFullYear() ? today.getMonth() : startDate.getMonth();

    const targetDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
    const endYear = targetDate.getFullYear();
    const endMonth = targetDate.getMonth();

    let installmentNumber = (sip.installments || []).length;

    while (currYear < endYear || (currYear === endYear && currMonth <= endMonth)) {
      const maxDaysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
      const clampedDay = Math.min(sip.sipDay || 10, maxDaysInMonth);
      const scheduledDateObj = new Date(currYear, currMonth, clampedDay);

      // Verify bounds: >= startDate and (<= endDate if defined)
      if (scheduledDateObj >= startDate && (!endDate || scheduledDateObj <= endDate)) {
        const resolution = this.calendar.resolveTradingDay(scheduledDateObj);
        const deterministicId = `${sip.id}_${resolution.scheduledDate.replace(/-/g, '')}`;

        // Idempotency check: if already exists, preserve it untouched!
        if (!existingMap.has(deterministicId) && !existingMap.has(resolution.scheduledDate)) {
          installmentNumber++;
          const effectiveAmount = this.calculateEffectiveAmount(sip, installmentNumber);

          const newInstallment: SipInstallment = {
            id: deterministicId,
            installmentNumber,
            scheduledDate: resolution.scheduledDate,
            executionDate: resolution.executionDate,
            amount: effectiveAmount,
            paymentStatus: 'Pending',
            allotmentStatus: 'Pending',
            reconciliationStatus: 'Unreconciled',
            status: 'Scheduled',
            isMarketShifted: resolution.wasShifted,
            shiftReason: resolution.reason,
            autoExecuted: false,
            notes: resolution.wasShifted
              ? `Market holiday rollover: Scheduled on ${resolution.scheduledDate} ➔ Trading day ${resolution.executionDate}`
              : 'Scheduled for mutual fund cutoff window.',
          };

          results.push(newInstallment);
          existingMap.set(deterministicId, newInstallment);
          existingMap.set(resolution.scheduledDate, newInstallment);
        }
      }

      // Increment by frequency
      if (sip.frequency === 'Quarterly') {
        currMonth += 3;
      } else if (sip.frequency === 'Weekly') {
        currMonth += 1; // Simplified monthly cycle for schedule engine
      } else {
        currMonth += 1;
      }

      if (currMonth > 11) {
        currYear += Math.floor(currMonth / 12);
        currMonth = currMonth % 12;
      }
    }

    // Sort installments chronologically
    return results.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  }

  /**
   * Synchronizes all active SIP schedules ahead of time, ensuring future installments exist
   * without fabricating fake payments or allotments.
   */
  async syncAllSipSchedules(silent = false): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);

    try {
      const list = [...this.sips()];
      if (list.length === 0) return;

      let modified = false;
      const todayStr = this.calendar.formatDate(new Date());

      for (let i = 0; i < list.length; i++) {
        const sip = { ...list[i] };
        if (sip.status === 'Active') {
          const updatedInstallments = this.generateExpectedInstallments(sip, 3);
          if (updatedInstallments.length !== (sip.installments || []).length) {
            sip.installments = updatedInstallments;
            modified = true;
          }

          // Recalculate next upcoming execution date
          const nextDate = this.calculateNextExecutionDate(sip);
          if (nextDate !== sip.nextExecutionDate) {
            sip.nextExecutionDate = nextDate;
            modified = true;
          }

          // Recalculate confirmed totals
          const confirmedInsts = (sip.installments || []).filter(
            (inst) => inst.allotmentStatus === 'Confirmed' || inst.status === 'Executed'
          );
          sip.totalInvested = confirmedInsts.reduce((sum, inst) => sum + (inst.amount || 0), 0);
          sip.installmentsPaid = confirmedInsts.length;
          sip.confirmedUnitsTotal = Math.round(
            confirmedInsts.reduce((sum, inst) => sum + (inst.units || 0), 0) * 1000
          ) / 1000;

          list[i] = sip;
        }
      }

      if (modified) {
        await this.saveSips(list);
      }

      const nowStr = new Date().toISOString();
      this.lastSyncTime.set(nowStr);
      try {
        localStorage.setItem(LAST_SCHEDULE_SYNC_KEY, nowStr);
      } catch {}

      // Identify pending allotments awaiting reconciliation
      const pendingSips: string[] = [];
      list.forEach((s) => {
        const hasPending = (s.installments || []).some(
          (inst) => inst.executionDate <= todayStr && inst.allotmentStatus === 'Pending'
        );
        if (hasPending && !pendingSips.includes(s.name)) {
          pendingSips.push(s.name);
        }
      });

      if (pendingSips.length > 0) {
        this.pendingReconciliationNotice.set({
          count: pendingSips.length,
          sips: pendingSips,
        });
      } else {
        this.pendingReconciliationNotice.set(null);
      }

      if (!silent) {
        this.snackbar.show('SIP schedules and market calendars synchronized.', 'info', 3000);
      }
    } finally {
      this.syncing.set(false);
    }
  }

  // ── Plan CRUD Operations ──

  async createSip(
    data: Omit<Sip, 'id' | 'createdAt' | 'updatedAt' | 'installmentsPaid' | 'totalInvested'>
  ): Promise<Sip> {
    // Validate inputs
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Scheme / Plan name is required.');
    }
    if (data.amount <= 0) {
      throw new Error('SIP amount must be greater than zero.');
    }
    if (data.sipDay < 1 || data.sipDay > 31) {
      throw new Error('SIP day must be between 1 and 31.');
    }

    const id = 'sip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    const newSip: Sip = {
      ...data,
      id,
      executionMode: data.executionMode || 'External',
      dataSource: data.dataSource || 'CAS',
      totalInvested: 0,
      installmentsPaid: 0,
      confirmedUnitsTotal: 0,
      installments: [],
      createdAt: now,
      updatedAt: now,
    };

    // Pre-generate expected installments ahead of time
    newSip.installments = this.generateExpectedInstallments(newSip, 3);
    newSip.nextExecutionDate = this.calculateNextExecutionDate(newSip);

    const updated = [newSip, ...this.sips()];
    await this.saveSips(updated);
    this.snackbar.show(`SIP plan "${newSip.name}" created successfully.`, 'success');
    return newSip;
  }

  async addSip(
    data: Omit<Sip, 'id' | 'createdAt' | 'updatedAt' | 'installmentsPaid' | 'totalInvested'>
  ): Promise<Sip> {
    return this.createSip(data);
  }

  async updateSip(id: string, updates: Partial<Sip>): Promise<void> {
    const list = this.sips();
    const index = list.findIndex((s) => s.id === id);
    if (index === -1) return;

    const existing = list[index];

    // Guard: Prevent plan changes from silently modifying or wiping confirmed installments
    let preservedInstallments = updates.installments ?? existing.installments ?? [];

    const updatedSip: Sip = {
      ...existing,
      ...updates,
      installments: preservedInstallments,
      updatedAt: new Date().toISOString(),
    };

    // Re-generate schedule if day, start date, frequency, or status changed
    if (
      updates.sipDay !== undefined ||
      updates.startDate !== undefined ||
      updates.status !== undefined ||
      updates.frequency !== undefined
    ) {
      updatedSip.installments = this.generateExpectedInstallments(updatedSip, 3);
      updatedSip.nextExecutionDate = this.calculateNextExecutionDate(updatedSip);
    }

    const updated = [...list];
    updated[index] = updatedSip;
    await this.saveSips(updated);
    this.snackbar.show(`SIP "${updatedSip.name}" updated successfully.`, 'success');
  }

  async pauseSip(id: string): Promise<void> {
    await this.updateSip(id, { status: 'Paused' });
    this.snackbar.show('SIP paused. Future expected installments paused.', 'info');
  }

  async resumeSip(id: string): Promise<void> {
    await this.updateSip(id, { status: 'Active' });
    this.snackbar.show('SIP resumed. Active schedule restored.', 'success');
  }

  async cancelSip(id: string): Promise<void> {
    const sip = this.sips().find((s) => s.id === id);
    if (!sip) return;

    // Retain all confirmed installments for audit history; remove only unconfirmed future scheduled ones
    const todayStr = this.calendar.formatDate(new Date());
    const preservedInstallments = (sip.installments || []).filter(
      (inst) => inst.allotmentStatus === 'Confirmed' || inst.executionDate <= todayStr
    );

    await this.updateSip(id, {
      status: 'Cancelled',
      installments: preservedInstallments,
      nextExecutionDate: undefined,
    });
    this.snackbar.show('SIP cancelled. Historical confirmed investments preserved.', 'info');
  }

  async deleteSip(id: string): Promise<void> {
    const list = this.sips().filter((s) => s.id !== id);
    this.sips.set(list);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}

    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        await deleteDoc(doc(this.firestore, `users/${uid}/sips/${id}`));
      } catch (e) {
        console.warn('[SipService] Could not delete from Firestore:', e);
      }
    }

    this.snackbar.show('SIP removed.', 'info');
  }

  // ── Reconciliation Actions ──

  /**
   * Reconcile SIPs with parsed CAS mutual fund holdings.
   * Confirms units and updates portfolio holdings.
   */
  async reconcileWithCas(casHoldings: CasMutualFundHolding[]): Promise<number> {
    const list = [...this.sips()];
    let totalConfirmedAcrossSips = 0;

    for (let i = 0; i < list.length; i++) {
      const sip = list[i];
      const res = await this.reconciliationService.reconcileWithCasHoldings(sip, casHoldings);

      if (res.confirmedCount > 0) {
        totalConfirmedAcrossSips += res.confirmedCount;
        const confirmedInsts = res.updatedInstallments.filter(
          (inst) => inst.allotmentStatus === 'Confirmed'
        );
        list[i] = {
          ...sip,
          installments: res.updatedInstallments,
          totalInvested: confirmedInsts.reduce((sum, inst) => sum + (inst.amount || 0), 0),
          installmentsPaid: confirmedInsts.length,
          confirmedUnitsTotal: Math.round(
            confirmedInsts.reduce((sum, inst) => sum + (inst.units || 0), 0) * 1000
          ) / 1000,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    if (totalConfirmedAcrossSips > 0) {
      await this.saveSips(list);
      this.snackbar.show(
        `✨ Reconciled and confirmed ${totalConfirmedAcrossSips} installment(s) via CAS statement!`,
        'success'
      );
    } else {
      this.snackbar.show('No pending installments matched the provided CAS statement.', 'info');
    }

    return totalConfirmedAcrossSips;
  }

  /**
   * Manually confirm unit allotment for a specific installment.
   */
  async confirmInstallmentManually(
    sipId: string,
    installmentId: string,
    allotmentData: {
      allotmentDate: string;
      nav: number;
      units: number;
      externalRef?: string;
      notes?: string;
    }
  ): Promise<void> {
    const list = [...this.sips()];
    const index = list.findIndex((s) => s.id === sipId);
    if (index === -1) return;

    const sip = list[index];
    const updatedInst = await this.reconciliationService.confirmAllotmentManually(
      sip,
      installmentId,
      allotmentData
    );

    if (updatedInst) {
      const installments = (sip.installments || []).map((i) =>
        i.id === installmentId ? updatedInst : i
      );
      const confirmedInsts = installments.filter((i) => i.allotmentStatus === 'Confirmed');

      list[index] = {
        ...sip,
        installments,
        totalInvested: confirmedInsts.reduce((sum, i) => sum + i.amount, 0),
        installmentsPaid: confirmedInsts.length,
        confirmedUnitsTotal: Math.round(
          confirmedInsts.reduce((sum, i) => sum + (i.units || 0), 0) * 1000
        ) / 1000,
        lastExecutionDate: updatedInst.allotmentDate,
        updatedAt: new Date().toISOString(),
      };

      await this.saveSips(list);
      this.snackbar.show(
        `Confirmed ${updatedInst.units} units for installment #${updatedInst.installmentNumber}. Portfolio holding updated.`,
        'success'
      );
    }
  }

  /**
   * Fetch suggested AMFI NAV for an installment on a specific date.
   */
  async getSuggestedNav(sip: Sip, dateStr: string): Promise<number | null> {
    const code = sip.schemeCode || sip.isin;
    if (!code) return null;
    const snapshot = await this.navService.getNavForDate(code, dateStr);
    return snapshot ? snapshot.nav : null;
  }

  // ── Calculation Utilities ──

  calculateEffectiveAmount(sip: Sip, installmentNumber: number): number {
    if (!sip.stepUp || !sip.stepUp.enabled) {
      return sip.amount;
    }

    const freq = sip.stepUp.frequencyMonths || 12;
    const stepUpCount = Math.floor((installmentNumber - 1) / freq);
    if (stepUpCount <= 0) return sip.amount;

    let amt = sip.amount;
    for (let i = 0; i < stepUpCount; i++) {
      if (sip.stepUp.type === 'percentage') {
        amt += Math.round((amt * sip.stepUp.value) / 100);
      } else {
        amt += sip.stepUp.value;
      }
    }
    return amt;
  }

  calculateNextExecutionDate(sip: Sip): string | undefined {
    const today = new Date();
    const todayStr = this.calendar.formatDate(today);

    // Look in scheduled installments
    const nextInst = (sip.installments || []).find(
      (inst) => inst.executionDate >= todayStr && inst.allotmentStatus === 'Pending'
    );
    if (nextInst) return nextInst.executionDate;

    // Fallback: calculate using calendar
    let year = today.getFullYear();
    let month = today.getMonth();

    for (let i = 0; i < 24; i++) {
      const maxDaysInMonth = new Date(year, month + 1, 0).getDate();
      const clampedDay = Math.min(sip.sipDay || 10, maxDaysInMonth);
      const scheduledDate = new Date(year, month, clampedDay);
      const resolution = this.calendar.resolveTradingDay(scheduledDate);

      const isAlreadyExecuted = (sip.installments || []).some(
        (inst) =>
          inst.scheduledDate === resolution.scheduledDate &&
          (inst.allotmentStatus === 'Confirmed' || inst.status === 'Executed')
      );

      if (!isAlreadyExecuted && resolution.executionDate >= todayStr) {
        return resolution.executionDate;
      }

      month++;
      if (month > 11) {
        year += Math.floor(month / 12);
        month = month % 12;
      }
    }

    return undefined;
  }

  async togglePauseSip(id: string): Promise<void> {
    const sip = this.sips().find((s) => s.id === id);
    if (!sip) return;
    if (sip.status === 'Active') {
      await this.pauseSip(id);
    } else {
      await this.resumeSip(id);
    }
  }

  async skipNextInstallment(id: string): Promise<void> {
    const list = [...this.sips()];
    const index = list.findIndex((s) => s.id === id);
    if (index === -1) return;
    const sip = list[index];
    const installments = [...(sip.installments || [])];
    const todayStr = this.calendar.formatDate(new Date());
    const nextIdx = installments.findIndex(
      (inst) => inst.executionDate >= todayStr && inst.allotmentStatus === 'Pending'
    );
    if (nextIdx !== -1) {
      installments[nextIdx] = {
        ...installments[nextIdx],
        status: 'Skipped',
        paymentStatus: 'NotApplicable',
        allotmentStatus: 'Cancelled',
        reconciliationNotes: 'Manually skipped by user.',
      };
      sip.installments = installments;
      sip.nextExecutionDate = this.calculateNextExecutionDate(sip);
      list[index] = sip;
      await this.saveSips(list);
      this.snackbar.show('Next installment skipped.', 'info');
    }
  }

  async manuallyExecuteNow(id: string): Promise<void> {
    const list = [...this.sips()];
    const index = list.findIndex((s) => s.id === id);
    if (index === -1) return;
    const sip = list[index];
    const today = new Date();
    const todayStr = this.calendar.formatDate(today);
    const installments = [...(sip.installments || [])];

    let inst =
      installments.find((i) => i.allotmentStatus === 'Pending' && i.executionDate <= todayStr) ||
      installments.find((i) => i.allotmentStatus === 'Pending');

    if (!inst) {
      this.snackbar.show('All installments are currently up to date.', 'info');
      return;
    }

    const navSnapshot = await this.navService.getNavForDate(sip.schemeCode || sip.isin || sip.name, todayStr);
    const nav = navSnapshot ? navSnapshot.nav : 100;
    const units = Math.round((inst.amount / nav) * 1000) / 1000;

    await this.confirmInstallmentManually(sip.id, inst.id, {
      allotmentDate: navSnapshot ? navSnapshot.navDate : todayStr,
      nav,
      units,
      notes: 'Manually confirmed via SIP Dashboard.',
    });
  }

  async checkAndAutoExecuteSips(manualTrigger = false): Promise<number> {
    await this.syncAllSipSchedules(!manualTrigger);
    return 0;
  }

  getYearlySchedule(sipDay: number, year: number): YearlyScheduleEntry[] {
    return this.calendar.generateYearlySchedule(sipDay, year);
  }

  // ── Persistence ──

  async loadSips() {
    this.loading.set(true);
    let loaded: Sip[] = [];

    // LocalStorage first
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        loaded = JSON.parse(cached);
      }
    } catch {}

    // Firestore if authenticated
    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const snap = await getDocs(collection(this.firestore, `users/${uid}/sips`));
        if (!snap.empty) {
          loaded = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Sip));
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
          } catch {}
        }
      } catch (e) {
        console.warn('[SipService] Could not load from Firestore, using local cache:', e);
      }
    }

    // Purge any legacy dummy / sample SIPs from remote and local storage
    if (this.firestore && uid) {
      try {
        const snap = await getDocs(collection(this.firestore, `users/${uid}/sips`));
        if (!snap.empty) {
          const sampleDocs = snap.docs.filter(
            (d) => d.id.startsWith('sip_sample_') || d.id.includes('sample')
          );
          sampleDocs.forEach((d) => deleteDoc(d.ref).catch(() => {}));
        }
      } catch {}
    }

    loaded = (loaded || []).filter(
      (s) => s && s.id && !s.id.startsWith('sip_sample_') && !s.id.includes('sample')
    );

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    } catch {}

    this.sips.set(loaded);
    if (loaded.length > 0) {
      // Auto-sync future schedules idempotently
      setTimeout(() => this.syncAllSipSchedules(true), 500);
    }

    this.loading.set(false);
  }

  async saveSips(newList: Sip[]): Promise<void> {
    this.sips.set(newList);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newList));
    } catch {}

    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const batchPromises = newList.map((sip) =>
          setDoc(doc(this.firestore!, `users/${uid}/sips/${sip.id}`), sip)
        );
        await Promise.all(batchPromises);
      } catch (e) {
        console.warn('[SipService] Could not batch save to Firestore:', e);
      }
    }
  }



  private loadLastSyncTime(): string {
    try {
      return localStorage.getItem(LAST_SCHEDULE_SYNC_KEY) || new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
}
