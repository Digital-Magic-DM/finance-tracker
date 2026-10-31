import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { AssetService } from './asset.service';
import { SipService } from './sip.service';
import { PinSecurityService } from './pin-security.service';
import { SnackbarService } from './snackbar.service';
import {
  Goal,
  GoalSummaryMetrics,
  GoalWithProgress,
  GOAL_CATEGORY_CONFIG,
} from '../models/goal.models';
import { Asset } from '../models/finance.models';
import { Sip } from '../models/sip.models';

const STORAGE_KEY = 'fintracker_goals_v1';
const USD_TO_INR = 87.5;

@Injectable({
  providedIn: 'root',
})
export class GoalService {
  private firestore = inject(Firestore, { optional: true });
  private auth = inject(Auth, { optional: true });
  private assetService = inject(AssetService);
  private sipService = inject(SipService);
  private pinSecurity = inject(PinSecurityService, { optional: true });
  private snackbar = inject(SnackbarService);

  readonly goals = signal<Goal[]>([]);
  readonly loading = signal<boolean>(false);

  // Live assets signal
  readonly assets = signal<Asset[]>([]);

  constructor() {
    this.assetService.getAssets().subscribe((list) => this.assets.set(list || []));
    if (this.pinSecurity) {
      effect(() => {
        const locked = this.pinSecurity?.isLocked();
        if (!locked) {
          this.loadGoals();
        } else {
          this.goals.set([]);
        }
      });
    } else {
      this.loadGoals();
    }
  }

  // ── Computed Goals With Live Progress ──
  readonly goalsWithProgress = computed<GoalWithProgress[]>(() => {
    const goalsList = this.goals();
    const assetsList = this.assets() || [];
    const sipsList = this.sipService.sips() || [];

    const today = new Date();

    return goalsList.map((g) => {
      // 1. Assets mapped to this goal
      const mappedAssets = assetsList.filter((a) => a.goalId === g.id);
      const mappedAssetsValue = mappedAssets.reduce((sum, a) => {
        const price = a.currentPrice && a.currentPrice > 0 ? a.currentPrice : (a.buyPrice || 0);
        const rate = a.currency === 'USD' ? USD_TO_INR : 1;
        return sum + (a.quantity || 0) * price * rate;
      }, 0);

      // 2. SIPs mapped to this goal
      const mappedSips = sipsList.filter((s) => s.goalId === g.id);
      const mappedSipsInvested = mappedSips.reduce((sum, s) => sum + (s.totalInvested || 0), 0);
      const mappedSipsMonthly = mappedSips.reduce(
        (sum, s) => sum + (s.status === 'Active' ? s.amount : 0),
        0
      );

      // 3. Current Accumulated Capital
      const manualContr = g.manualContribution || 0;
      const currentAmount = Math.round(mappedAssetsValue + mappedSipsInvested + manualContr);

      // 4. Progress and remaining
      const target = g.targetAmount || 1;
      const progressPct = Math.min(100, Math.round((currentAmount / target) * 100));
      const remainingAmount = Math.max(0, target - currentAmount);

      // 5. Timeline & Required Monthly Savings
      const targetD = new Date(g.targetDate);
      const diffMonths =
        (targetD.getFullYear() - today.getFullYear()) * 12 +
        (targetD.getMonth() - today.getMonth());
      const monthsRemaining = Math.max(1, diffMonths);

      const requiredMonthlySavings =
        remainingAmount > 0 ? Math.round(remainingAmount / monthsRemaining) : 0;

      // 6. Feasibility status
      const isAchieved = currentAmount >= g.targetAmount;
      const isOnTrack = isAchieved || mappedSipsMonthly >= requiredMonthlySavings * 0.9;
      const status: 'In Progress' | 'Achieved' | 'Needs Boost' = isAchieved
        ? 'Achieved'
        : isOnTrack
        ? 'In Progress'
        : 'Needs Boost';

      return {
        ...g,
        currentAmount,
        progressPct,
        remainingAmount,
        monthlySipAmount: mappedSipsMonthly,
        monthsRemaining,
        requiredMonthlySavings,
        isOnTrack,
        status,
        mappedAssetsCount: mappedAssets.length,
        mappedSipsCount: mappedSips.length,
        mappedAssetNames: mappedAssets.map((a) => a.name),
        mappedSipNames: mappedSips.map((s) => s.name),
      };
    });
  });

  // ── Overall Summary Metrics ──
  readonly summaryMetrics = computed<GoalSummaryMetrics>(() => {
    const list = this.goalsWithProgress();
    const totalGoals = list.length;
    const achievedGoals = list.filter((g) => g.status === 'Achieved').length;
    const activeGoals = totalGoals - achievedGoals;

    const totalTargetAmount = list.reduce((sum, g) => sum + g.targetAmount, 0);
    const totalAccumulatedAmount = list.reduce((sum, g) => sum + g.currentAmount, 0);
    const totalMonthlySipAllocated = list.reduce((sum, g) => sum + g.monthlySipAmount, 0);

    const overallProgressPct =
      totalTargetAmount > 0
        ? Math.min(100, Math.round((totalAccumulatedAmount / totalTargetAmount) * 100))
        : 0;

    return {
      totalGoals,
      activeGoals,
      achievedGoals,
      totalTargetAmount,
      totalAccumulatedAmount,
      overallProgressPct,
      totalMonthlySipAllocated,
    };
  });

  // ── Persistence & Loading ──
  async loadGoals() {
    if (this.pinSecurity?.isLocked()) {
      this.goals.set([]);
      return;
    }

    this.loading.set(true);
    let loaded: Goal[] = [];

    // 1. Try local cache
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        loaded = JSON.parse(cached);
        this.goals.set(loaded);
      }
    } catch {}

    // 2. Fetch from Firestore if logged in
    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const snap = await getDocs(collection(this.firestore, `users/${uid}/goals`));
        if (!snap.empty) {
          loaded = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Goal));
          this.goals.set(loaded);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
          } catch {}
        } else if (loaded.length === 0) {
          // Initialize Starter Goal (e.g. Retirement or Financial Freedom)
          const starter = this.createStarterGoal();
          await this.addGoal(starter);
          return;
        }
      } catch (err) {
        console.warn('[GoalService] Firestore load error:', err);
      }
    } else if (loaded.length === 0) {
      // Local fallback starter
      const starter = this.createStarterGoal();
      this.goals.set([starter]);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([starter]));
      } catch {}
    }

    this.loading.set(false);
  }

  private createStarterGoal(): Goal {
    const today = new Date();
    const targetDate = new Date(today.getFullYear() + 10, 11, 31).toISOString().split('T')[0];
    return {
      id: `goal_${Date.now()}_starter`,
      name: 'Financial Freedom & Wealth',
      category: 'Wealth',
      targetAmount: 5000000,
      targetDate,
      priority: 'High',
      notes: 'Build long-term compounding wealth and achieve financial independence.',
      color: GOAL_CATEGORY_CONFIG.Wealth.color,
      icon: GOAL_CATEGORY_CONFIG.Wealth.icon,
      createdAt: new Date().toISOString(),
    };
  }

  private async saveGoals(list: Goal[]) {
    this.goals.set(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  // ── CRUD Operations ──
  async addGoal(goal: Omit<Goal, 'id' | 'createdAt'>): Promise<string> {
    const newId = `goal_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const newGoal: Goal = {
      ...goal,
      id: newId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextList = [...this.goals(), newGoal];
    await this.saveGoals(nextList);

    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const ref = doc(this.firestore, `users/${uid}/goals/${newId}`);
        await setDoc(ref, newGoal);
      } catch (e) {
        console.warn('[GoalService] Firestore write error:', e);
      }
    }

    this.snackbar.show(`Goal "${newGoal.name}" created!`, 'success');
    return newId;
  }

  async updateGoal(id: string, updates: Partial<Goal>): Promise<void> {
    const list = this.goals();
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) return;

    const updated: Goal = {
      ...list[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    list[idx] = updated;

    await this.saveGoals([...list]);

    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const ref = doc(this.firestore, `users/${uid}/goals/${id}`);
        await setDoc(ref, updated, { merge: true });
      } catch (e) {
        console.warn('[GoalService] Firestore update error:', e);
      }
    }

    this.snackbar.show(`Goal "${updated.name}" updated.`, 'success');
  }

  async deleteGoal(id: string): Promise<void> {
    const list = this.goals().filter((g) => g.id !== id);
    await this.saveGoals(list);

    // Unmap any assets linked to this goal
    const assets = this.assets() || [];
    for (const a of assets) {
      if (a.goalId === id && a.id) {
        try {
          await this.assetService.updateAsset(a.id, { goalId: undefined, goalName: undefined });
        } catch {}
      }
    }

    // Unmap any SIPs linked to this goal
    const sips = this.sipService.sips() || [];
    for (const s of sips) {
      if (s.goalId === id) {
        try {
          await this.sipService.updateSip(s.id, { goalId: undefined, goalName: undefined });
        } catch {}
      }
    }

    const uid = this.auth?.currentUser?.uid;
    if (this.firestore && uid) {
      try {
        const ref = doc(this.firestore, `users/${uid}/goals/${id}`);
        await deleteDoc(ref);
      } catch (e) {
        console.warn('[GoalService] Firestore delete error:', e);
      }
    }

    this.snackbar.show('Goal deleted and investments unlinked.', 'info');
  }

  // ── Mapping Helpers ──
  async mapAssetToGoal(assetId: string, goalId: string | null): Promise<void> {
    const goal = goalId ? this.goals().find((g) => g.id === goalId) : null;
    await this.assetService.updateAsset(assetId, {
      goalId: goalId || undefined,
      goalName: goal ? goal.name : undefined,
    });
    this.snackbar.show(
      goalId ? `Asset mapped to goal: "${goal?.name}"` : 'Asset unlinked from goal.',
      'success'
    );
  }

  async mapSipToGoal(sipId: string, goalId: string | null): Promise<void> {
    const goal = goalId ? this.goals().find((g) => g.id === goalId) : null;
    await this.sipService.updateSip(sipId, {
      goalId: goalId || undefined,
      goalName: goal ? goal.name : undefined,
    });
    this.snackbar.show(
      goalId ? `SIP mapped to goal: "${goal?.name}"` : 'SIP unlinked from goal.',
      'success'
    );
  }

  async batchMapInvestments(
    _goalId: string,
    assetUpdates: { id: string; changes: Partial<Asset> }[],
    sipUpdates: { id: string; changes: Partial<Sip> }[]
  ): Promise<void> {
    const promises: Promise<any>[] = [];
    if (assetUpdates.length > 0) {
      promises.push(this.assetService.batchUpdateAssets(assetUpdates));
    }
    if (sipUpdates.length > 0) {
      promises.push(this.sipService.batchUpdateSips(sipUpdates));
    }
    await Promise.all(promises);
  }

  async addManualContribution(goalId: string, amount: number): Promise<void> {
    const goal = this.goals().find((g) => g.id === goalId);
    if (!goal || amount <= 0) return;

    const currentContr = goal.manualContribution || 0;
    await this.updateGoal(goalId, {
      manualContribution: currentContr + amount,
    });
    this.snackbar.show(`Added ₹${amount.toLocaleString()} to "${goal.name}"`, 'success');
  }
}
