import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import {
  Sip,
  SipInstallment,
  SipSummaryMetrics,
  TradingDayResolution,
} from '../models/sip.models';
import { MarketCalendarService } from './market-calendar.service';
import { TransactionService } from './transaction.service';
import { AssetService } from './asset.service';
import { SnackbarService } from './snackbar.service';
import { TransactionType, AssetType, Asset } from '../models/finance.models';

const STORAGE_KEY = 'finance_tracker_sips_v2';
const LAST_AUTO_CHECK_KEY = 'finance_tracker_sip_last_auto_check';

@Injectable({
  providedIn: 'root',
})
export class SipService {
  private firestore = inject(Firestore, { optional: true });
  private auth = inject(Auth, { optional: true });
  private calendar = inject(MarketCalendarService);
  private txService = inject(TransactionService);
  private assetService = inject(AssetService);
  private snackbar = inject(SnackbarService);

  readonly sips = signal<Sip[]>([]);
  readonly loading = signal<boolean>(false);
  readonly autoExecuting = signal<boolean>(false);
  readonly lastAutoCheckTime = signal<string>(this.loadLastCheckTime());
  readonly autoExecutionNotice = signal<{ count: number; sips: string[]; timestamp: number } | null>(null);

  constructor() {
    this.loadSips();
  }

  // ── Summary Metrics ──
  readonly summaryMetrics = computed<SipSummaryMetrics>(() => {
    const list = this.sips();
    const active = list.filter((s) => s.status === 'Active');

    let totalMonthlyCommitment = 0;
    let totalInvested = 0;
    let totalExecutedInstallments = 0;

    const today = new Date();

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
      totalInvested += sip.totalInvested || 0;
      totalExecutedInstallments += (sip.installments || []).filter((i) => i.status === 'Executed').length;

      if (sip.status === 'Active') {
        // Normalize frequency to monthly commitment
        let monthlyEquiv = sip.amount;
        if (sip.frequency === 'Weekly') monthlyEquiv = sip.amount * 4.33;
        else if (sip.frequency === 'Quarterly') monthlyEquiv = sip.amount / 3;
        totalMonthlyCommitment += monthlyEquiv;

        // Compute upcoming execution date
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
      totalExecutedInstallments,
      nextUpcomingSip: closestUpcoming,
      marketStatus: this.calendar.getMarketStatus(),
    };
  });

  // ── Auto-Update Engine (Background Execution) ──
  /**
   * Automatically executes due SIP installments without manual user interaction,
   * strictly adhering to the market open/close calendar and holiday rollovers.
   */
  async checkAndAutoExecuteSips(manualTrigger = false): Promise<number> {
    if (this.autoExecuting()) return 0;
    this.autoExecuting.set(true);

    let executedCount = 0;
    const executedSipNames: string[] = [];

    try {
      const currentList = [...this.sips()];
      if (currentList.length === 0) return 0;

      const today = new Date();
      const todayStr = this.calendar.formatDate(today);
      let listModified = false;

      // Fetch user's existing assets to match or update holdings
      let userAssets: Asset[] = [];
      try {
        userAssets = await this.assetService.getAssetsSnapshot();
      } catch (e) {
        console.warn('[SipService] Could not fetch assets snapshot:', e);
      }

      for (let i = 0; i < currentList.length; i++) {
        const sip = { ...currentList[i] };
        if (sip.status !== 'Active' || !sip.autoExecute) continue;

        const installments = [...(sip.installments || [])];
        const pendingSchedule = this.getPendingInstallmentsUpToToday(sip, todayStr);

        if (pendingSchedule.length === 0) {
          // Just ensure nextExecutionDate is properly updated
          const nextDate = this.calculateNextExecutionDate(sip);
          if (nextDate !== sip.nextExecutionDate) {
            sip.nextExecutionDate = nextDate;
            currentList[i] = sip;
            listModified = true;
          }
          continue;
        }

        // Execute each pending installment chronologically
        for (const item of pendingSchedule) {
          console.log(`[SipService] Auto-executing SIP: ${sip.name} for execution date ${item.resolution.executionDate}`);

          // 1. Calculate effective amount (Step-Up support)
          const effectiveAmount = this.calculateEffectiveAmount(sip, item.installmentNumber);

          // 2. Fetch or estimate NAV for realistic unit allocation
          const estimatedNav = await this.resolveNavForFund(sip, userAssets);
          const allottedUnits = Math.round((effectiveAmount / estimatedNav) * 1000) / 1000;

          // 3. Record transaction in TransactionService
          const txDesc = `SIP Auto-Debit: ${sip.name} (Installment #${item.installmentNumber})`;
          const txNotes = `Auto-processed via Market Calendar Engine. ${item.resolution.reason}`;
          try {
            await this.txService.addTransaction({
              type: TransactionType.Expense,
              amount: effectiveAmount,
              category: 'Investment',
              description: txDesc,
              bank: sip.mandateAccount || 'Bank Mandate (OTM Autopay)',
              date: this.calendar.parseDate(item.resolution.executionDate),
              notes: txNotes,
              assetName: sip.name,
            });
          } catch (err) {
            console.warn('[SipService] Failed to record transaction:', err);
          }

          // 4. Update or allocate holding in AssetService
          await this.updateOrCreateAssetHolding(sip, effectiveAmount, allottedUnits, estimatedNav, userAssets);

          // 5. Add installment record to SIP history
          const installmentRecord: SipInstallment = {
            id: 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            installmentNumber: item.installmentNumber,
            scheduledDate: item.resolution.scheduledDate,
            executionDate: item.resolution.executionDate,
            amount: effectiveAmount,
            nav: estimatedNav,
            units: allottedUnits,
            status: 'Executed',
            isMarketShifted: item.resolution.wasShifted,
            shiftReason: item.resolution.reason,
            autoExecuted: true,
            executedAt: new Date().toISOString(),
            notes: item.resolution.wasShifted
              ? `Shifted from original ${item.resolution.scheduledDate} due to market holiday/weekend.`
              : 'Executed on scheduled market trading day.',
          };

          installments.push(installmentRecord);
          sip.totalInvested = (sip.totalInvested || 0) + effectiveAmount;
          sip.installmentsPaid = (sip.installmentsPaid || 0) + 1;
          sip.lastExecutionDate = item.resolution.executionDate;

          executedCount++;
          if (!executedSipNames.includes(sip.name)) {
            executedSipNames.push(sip.name);
          }
        }

        sip.installments = installments;
        sip.nextExecutionDate = this.calculateNextExecutionDate(sip);
        sip.updatedAt = new Date().toISOString();
        currentList[i] = sip;
        listModified = true;
      }

      if (listModified) {
        await this.saveSips(currentList);
      }

      const nowStr = new Date().toISOString();
      this.lastAutoCheckTime.set(nowStr);
      try {
        localStorage.setItem(LAST_AUTO_CHECK_KEY, nowStr);
      } catch {}

      if (executedCount > 0) {
        this.autoExecutionNotice.set({
          count: executedCount,
          sips: executedSipNames,
          timestamp: Date.now(),
        });

        this.snackbar.show(
          `✨ ${executedCount} SIP installment(s) automatically executed according to market calendar!`,
          'success',
          5000
        );
      } else if (manualTrigger) {
        this.snackbar.show(
          'All SIPs are currently up-to-date with market open dates.',
          'info',
          3500
        );
      }

      return executedCount;
    } catch (err) {
      console.error('[SipService] Error during auto-execution check:', err);
      if (manualTrigger) {
        this.snackbar.show('Failed to complete SIP auto-sync check.', 'error');
      }
      return 0;
    } finally {
      this.autoExecuting.set(false);
    }
  }

  /**
   * Determine all due installment dates that have passed up to today
   * and haven't been marked as executed/skipped yet.
   */
  private getPendingInstallmentsUpToToday(
    sip: Sip,
    todayStr: string
  ): Array<{ installmentNumber: number; resolution: TradingDayResolution }> {
    const results: Array<{ installmentNumber: number; resolution: TradingDayResolution }> = [];
    const startDate = this.calendar.parseDate(sip.startDate);
    const today = this.calendar.parseDate(todayStr);

    if (startDate > today) return [];

    const executedDates = new Set(
      (sip.installments || []).map((inst) => inst.scheduledDate)
    );

    let currYear = startDate.getFullYear();
    let currMonth = startDate.getMonth();
    const endYear = today.getFullYear();
    const endMonth = today.getMonth();

    let installmentCounter = (sip.installments || []).length;

    while (currYear < endYear || (currYear === endYear && currMonth <= endMonth)) {
      const maxDaysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
      const clampedDay = Math.min(sip.sipDay || 10, maxDaysInMonth);
      const scheduledDate = new Date(currYear, currMonth, clampedDay);

      // Only check if after or equal to sip.startDate
      if (scheduledDate >= startDate) {
        const resolution = this.calendar.resolveTradingDay(scheduledDate);

        // If market execution date is today or past, and hasn't been executed yet
        if (resolution.executionDate <= todayStr && !executedDates.has(resolution.scheduledDate)) {
          installmentCounter++;
          results.push({
            installmentNumber: installmentCounter,
            resolution,
          });
        }
      }

      currMonth++;
      if (currMonth > 11) {
        currMonth = 0;
        currYear++;
      }
    }

    return results;
  }

  /**
   * Calculate next upcoming market-adjusted execution date
   */
  calculateNextExecutionDate(sip: Sip): string {
    const today = new Date();
    const todayStr = this.calendar.formatDate(today);

    let year = today.getFullYear();
    let month = today.getMonth();

    for (let i = 0; i < 24; i++) {
      const maxDaysInMonth = new Date(year, month + 1, 0).getDate();
      const clampedDay = Math.min(sip.sipDay || 10, maxDaysInMonth);
      const targetDate = new Date(year, month, clampedDay);
      const resolution = this.calendar.resolveTradingDay(targetDate);

      // Next execution is strictly after today, or if today is earlier than market close
      if (resolution.executionDate >= todayStr) {
        const alreadyExecuted = (sip.installments || []).some(
          (inst) => inst.scheduledDate === resolution.scheduledDate && inst.status === 'Executed'
        );
        if (!alreadyExecuted) {
          return resolution.executionDate;
        }
      }

      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }

    return todayStr;
  }

  /**
   * Calculates effective amount considering Step-Up configuration
   */
  calculateEffectiveAmount(sip: Sip, installmentNumber: number): number {
    if (!sip.stepUp || !sip.stepUp.enabled || sip.stepUp.value <= 0) {
      return sip.amount;
    }

    const freq = sip.stepUp.frequencyMonths || 12;
    const stepIncrements = Math.floor((installmentNumber - 1) / freq);
    if (stepIncrements <= 0) return sip.amount;

    if (sip.stepUp.type === 'percentage') {
      const multiplier = Math.pow(1 + sip.stepUp.value / 100, stepIncrements);
      return Math.round(sip.amount * multiplier);
    } else {
      return sip.amount + stepIncrements * sip.stepUp.value;
    }
  }

  /**
   * Resolves NAV for mutual fund / stock
   */
  private async resolveNavForFund(sip: Sip, userAssets: Asset[]): Promise<number> {
    // 1. Check if linked asset exists with currentPrice
    if (sip.linkedAssetId) {
      const matched = userAssets.find((a) => a.id === sip.linkedAssetId);
      if (matched && matched.currentPrice && matched.currentPrice > 0) {
        return matched.currentPrice;
      }
    }

    // 2. Try by name
    const byName = userAssets.find(
      (a) => a.name.toLowerCase().trim() === sip.name.toLowerCase().trim()
    );
    if (byName && byName.currentPrice && byName.currentPrice > 0) {
      return byName.currentPrice;
    }

    // 3. Fallback benchmark estimate for realistic calculations
    if (sip.category === 'MutualFund') {
      if (/flexi|parag/i.test(sip.name)) return 86.42;
      if (/nifty|index|50/i.test(sip.name)) return 242.15;
      if (/small|quant/i.test(sip.name)) return 118.75;
      if (/mid|large/i.test(sip.name)) return 94.3;
      return 100.0;
    } else if (sip.category === 'Gold') {
      return 68.5; // Gold ETF units
    } else if (sip.category === 'Stock') {
      return 1500.0;
    }

    return 100.0;
  }

  /**
   * Updates existing asset holding or creates a new one in user's portfolio
   */
  private async updateOrCreateAssetHolding(
    sip: Sip,
    investedAmount: number,
    units: number,
    nav: number,
    userAssets: Asset[]
  ): Promise<void> {
    try {
      let existingAsset = sip.linkedAssetId
        ? userAssets.find((a) => a.id === sip.linkedAssetId)
        : null;

      if (!existingAsset) {
        existingAsset = userAssets.find(
          (a) => a.name.toLowerCase().trim() === sip.name.toLowerCase().trim()
        );
      }

      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const todayStr = this.calendar.formatDate(new Date());

      if (existingAsset && existingAsset.id) {
        const prevQty = existingAsset.quantity || 0;
        const prevBuyPrice = existingAsset.buyPrice || nav;
        const totalCostBefore = prevQty * prevBuyPrice;
        const newTotalCost = totalCostBefore + investedAmount;
        const newQty = prevQty + units;
        const weightedAvgBuyPrice = newQty > 0 ? Math.round((newTotalCost / newQty) * 100) / 100 : nav;

        await this.assetService.updateAsset(existingAsset.id, {
          quantity: Math.round(newQty * 1000) / 1000,
          buyPrice: weightedAvgBuyPrice,
          currentPrice: nav,
          lastUpdated: now,
          lastUpdatedDate: todayStr,
          navDate: todayStr,
        });
      } else {
        // Create new asset in portfolio
        let assetType = AssetType.MutualFund;
        if (sip.category === 'Stock') assetType = AssetType.Stock;
        else if (sip.category === 'ETF') assetType = AssetType.ETF;
        else if (sip.category === 'Gold') assetType = AssetType.Gold;
        else if (sip.category === 'Crypto') assetType = AssetType.Crypto;

        await this.assetService.addAsset({
          name: sip.name,
          type: assetType,
          quantity: units,
          buyPrice: nav,
          currentPrice: nav,
          currency: 'INR',
          purchaseDate: new Date(),
          notes: `Managed via Auto-SIP (${sip.mandateAccount || 'OTM Autopay'})`,
          appSource: 'SIP Auto-Invest',
          lastUpdated: now,
          lastUpdatedDate: todayStr,
          navDate: todayStr,
          isLiquid: true,
        });
      }
    } catch (e) {
      console.warn('[SipService] Could not sync asset holding:', e);
    }
  }

  // ── CRUD Operations ──
  async addSip(
    data: Omit<Sip, 'id' | 'createdAt' | 'updatedAt' | 'totalInvested' | 'installmentsPaid'>
  ): Promise<Sip> {
    const id = 'sip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const sip: Sip = {
      ...data,
      id,
      totalInvested: 0,
      installmentsPaid: 0,
      autoExecute: data.autoExecute !== undefined ? data.autoExecute : true,
      status: data.status || 'Active',
      installments: data.installments || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    sip.nextExecutionDate = this.calculateNextExecutionDate(sip);

    const updated = [sip, ...this.sips()];
    await this.saveSips(updated);

    // Run auto-execution immediately in case the start date is in the past!
    setTimeout(() => {
      this.checkAndAutoExecuteSips();
    }, 500);

    return sip;
  }

  async updateSip(id: string, updates: Partial<Sip>): Promise<void> {
    const list = this.sips();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return;

    const existing = list[idx];
    const updatedSip: Sip = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.sipDay || updates.startDate || updates.status) {
      updatedSip.nextExecutionDate = this.calculateNextExecutionDate(updatedSip);
    }

    const updated = [...list];
    updated[idx] = updatedSip;
    await this.saveSips(updated);
  }

  async deleteSip(id: string): Promise<void> {
    const list = this.sips().filter((s) => s.id !== id);
    await this.saveSips(list);

    const uid = this.auth?.currentUser?.uid;
    if (uid && this.firestore) {
      try {
        const ref = doc(this.firestore, `users/${uid}/sips/${id}`);
        await deleteDoc(ref);
      } catch (e) {
        console.warn('Firestore SIP delete error:', e);
      }
    }
  }

  async togglePauseSip(id: string): Promise<void> {
    const sip = this.sips().find((s) => s.id === id);
    if (!sip) return;
    const newStatus = sip.status === 'Active' ? 'Paused' : 'Active';
    await this.updateSip(id, { status: newStatus });
    this.snackbar.show(
      newStatus === 'Paused' ? `SIP "${sip.name}" paused.` : `SIP "${sip.name}" resumed.`,
      'info'
    );
  }

  async manuallyExecuteNow(id: string): Promise<void> {
    const sip = this.sips().find((s) => s.id === id);
    if (!sip) return;

    const today = new Date();
    const res = this.calendar.resolveTradingDay(today);
    const instNumber = (sip.installments || []).length + 1;
    const amount = this.calculateEffectiveAmount(sip, instNumber);

    let userAssets: Asset[] = [];
    try {
      userAssets = await this.assetService.getAssetsSnapshot();
    } catch {}

    const nav = await this.resolveNavForFund(sip, userAssets);
    const units = Math.round((amount / nav) * 1000) / 1000;

    // Transaction
    await this.txService.addTransaction({
      type: TransactionType.Expense,
      amount,
      category: 'Investment',
      description: `Manual SIP Debit: ${sip.name} (Installment #${instNumber})`,
      bank: sip.mandateAccount || 'Bank Mandate',
      date: new Date(),
      notes: `Manually executed by user. Allotted at NAV ₹${nav}.`,
      assetName: sip.name,
    });

    await this.updateOrCreateAssetHolding(sip, amount, units, nav, userAssets);

    const newInst: SipInstallment = {
      id: 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      installmentNumber: instNumber,
      scheduledDate: this.calendar.formatDate(today),
      executionDate: res.executionDate,
      amount,
      nav,
      units,
      status: 'Executed',
      isMarketShifted: res.wasShifted,
      shiftReason: res.reason,
      autoExecuted: false,
      executedAt: new Date().toISOString(),
      notes: 'Manually triggered installment execution.',
    };

    const installments = [...(sip.installments || []), newInst];
    const updatedSip: Partial<Sip> = {
      installments,
      installmentsPaid: (sip.installmentsPaid || 0) + 1,
      totalInvested: (sip.totalInvested || 0) + amount,
      lastExecutionDate: res.executionDate,
    };

    await this.updateSip(id, updatedSip);
    this.snackbar.show(`Successfully executed installment of ₹${amount.toLocaleString('en-IN')} for "${sip.name}".`, 'success');
  }

  async skipNextInstallment(id: string): Promise<void> {
    const sip = this.sips().find((s) => s.id === id);
    if (!sip) return;

    const nextExec = sip.nextExecutionDate || this.calculateNextExecutionDate(sip);
    const instNumber = (sip.installments || []).length + 1;

    const skipRecord: SipInstallment = {
      id: 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      installmentNumber: instNumber,
      scheduledDate: nextExec,
      executionDate: nextExec,
      amount: sip.amount,
      status: 'Skipped',
      isMarketShifted: false,
      autoExecuted: false,
      executedAt: new Date().toISOString(),
      notes: 'Skipped by user request.',
    };

    const installments = [...(sip.installments || []), skipRecord];

    // Advance to next month's execution date
    const d = this.calendar.parseDate(nextExec);
    const nextMonthDate = new Date(d.getFullYear(), d.getMonth() + 1, sip.sipDay);
    const nextRes = this.calendar.resolveTradingDay(nextMonthDate);

    await this.updateSip(id, {
      installments,
      nextExecutionDate: nextRes.executionDate,
    });

    this.snackbar.show(`Skipped upcoming installment for "${sip.name}". Next debit: ${this.calendar.formatReadableDate(nextRes.executionDate)}.`, 'info');
  }

  // ── Persistence & Initialization ──
  private async loadSips() {
    this.loading.set(true);
    try {
      // 1. Check LocalStorage
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Sip[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.sips.set(parsed);
          this.loading.set(false);
          // Check for auto-executions in background
          this.checkAndAutoExecuteSips();
        }
      }

      // 2. Sync with Firestore if authenticated
      const uid = this.auth?.currentUser?.uid;
      if (uid && this.firestore) {
        try {
          const col = collection(this.firestore, `users/${uid}/sips`);
          const snap = await getDocs(col);
          if (!snap.empty) {
            const remoteSips: Sip[] = [];
            snap.forEach((d) => remoteSips.push({ id: d.id, ...(d.data() as any) }));
            if (remoteSips.length > 0) {
              this.sips.set(remoteSips);
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteSips));
              } catch {}
              this.checkAndAutoExecuteSips();
              return;
            }
          }
        } catch (e) {
          console.warn('[SipService] Firestore sync fallback to cache:', e);
        }
      }

      // 3. Fallback to sample data if empty
      if (this.sips().length === 0) {
        this.loadSampleData();
      }
    } catch (e) {
      console.warn('Failed to load SIPs:', e);
      if (this.sips().length === 0) {
        this.loadSampleData();
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async saveSips(updated: Sip[]): Promise<void> {
    this.sips.set(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}

    const uid = this.auth?.currentUser?.uid;
    if (uid && this.firestore) {
      try {
        for (const sip of updated) {
          const ref = doc(this.firestore, `users/${uid}/sips/${sip.id}`);
          await setDoc(ref, sip, { merge: true });
        }
      } catch (e) {
        console.warn('Firestore SIP batch save error:', e);
      }
    }
  }

  loadSampleData() {
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();

    const sampleSips: Sip[] = [
      {
        id: 'sip_sample_parag_parikh',
        name: 'Parag Parikh Flexi Cap Fund - Direct Growth',
        category: 'MutualFund',
        fundHouse: 'PPFAS Mutual Fund',
        folioNumber: 'PPF-9482019',
        mandateAccount: 'HDFC Bank - OTM Autopay (...4819)',
        amount: 5000,
        frequency: 'Monthly',
        sipDay: 10,
        startDate: '2024-01-10',
        status: 'Active',
        stepUp: {
          enabled: true,
          type: 'percentage',
          value: 10,
          frequencyMonths: 12,
        },
        autoExecute: true,
        totalInvested: 45000,
        installmentsPaid: 9,
        lastExecutionDate: `${curYear}-${String(curMonth).padStart(2, '0')}-10`,
        installments: [
          {
            id: 'inst_ppfas_1',
            installmentNumber: 1,
            scheduledDate: `${curYear}-01-10`,
            executionDate: `${curYear}-01-10`,
            amount: 5000,
            nav: 78.4,
            units: 63.775,
            status: 'Executed',
            isMarketShifted: false,
            autoExecuted: true,
            executedAt: `${curYear}-01-10T10:00:00.000Z`,
          },
          {
            id: 'inst_ppfas_2',
            installmentNumber: 2,
            scheduledDate: `${curYear}-02-10`,
            executionDate: `${curYear}-02-12`,
            amount: 5000,
            nav: 80.2,
            units: 62.344,
            status: 'Executed',
            isMarketShifted: true,
            shiftReason: 'Shifted +2 days: Scheduled on Saturday (Weekend) ➔ Executed on Monday, 12 Feb',
            autoExecuted: true,
            executedAt: `${curYear}-02-12T10:00:00.000Z`,
          },
        ],
        notes: 'Core equity wealth builder. Annual 10% step-up enabled.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sip_sample_uti_nifty50',
        name: 'UTI Nifty 50 Index Fund - Direct Growth',
        category: 'MutualFund',
        fundHouse: 'UTI Mutual Fund',
        folioNumber: 'UTI-8192038',
        mandateAccount: 'State Bank of India - UPI Autopay (...1092)',
        amount: 3000,
        frequency: 'Monthly',
        sipDay: 15,
        startDate: '2024-02-15',
        status: 'Active',
        autoExecute: true,
        totalInvested: 24000,
        installmentsPaid: 8,
        lastExecutionDate: `${curYear}-${String(curMonth).padStart(2, '0')}-15`,
        installments: [],
        notes: 'Passive low-cost index foundation.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sip_sample_quant_small_cap',
        name: 'Quant Small Cap Fund - Direct Growth',
        category: 'MutualFund',
        fundHouse: 'Quant Mutual Fund',
        folioNumber: 'QNT-7102941',
        mandateAccount: 'ICICI Bank - NetBanking Mandate (...8823)',
        amount: 2500,
        frequency: 'Monthly',
        sipDay: 25,
        startDate: '2024-03-25',
        status: 'Active',
        autoExecute: true,
        totalInvested: 17500,
        installmentsPaid: 7,
        lastExecutionDate: `${curYear}-${String(curMonth).padStart(2, '0')}-25`,
        installments: [],
        notes: 'High alpha small-cap allocation.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sip_sample_gold_etf',
        name: 'Nippon India ETF Gold BeES',
        category: 'Gold',
        fundHouse: 'Nippon India Mutual Fund',
        folioNumber: 'NIP-4019283',
        mandateAccount: 'Zerodha Coin / Zerodha Funds',
        amount: 2000,
        frequency: 'Monthly',
        sipDay: 5,
        startDate: '2024-04-05',
        status: 'Active',
        autoExecute: true,
        totalInvested: 12000,
        installmentsPaid: 6,
        lastExecutionDate: `${curYear}-${String(curMonth).padStart(2, '0')}-05`,
        installments: [],
        notes: 'Hedge asset against currency and inflation risk.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    sampleSips.forEach((s) => {
      s.nextExecutionDate = this.calculateNextExecutionDate(s);
    });

    this.sips.set(sampleSips);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleSips));
    } catch {}

    // Check auto-execution for samples
    setTimeout(() => {
      this.checkAndAutoExecuteSips();
    }, 1000);
  }

  private loadLastCheckTime(): string {
    try {
      return localStorage.getItem(LAST_AUTO_CHECK_KEY) || 'Never';
    } catch {}
    return 'Never';
  }
}
