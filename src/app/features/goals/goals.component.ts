import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoalService } from '../../services/goal.service';
import { AssetService } from '../../services/asset.service';
import { SipService } from '../../services/sip.service';
import { SnackbarService } from '../../services/snackbar.service';
import {
  Goal,
  GoalCategory,
  GoalWithProgress,
  GOAL_CATEGORY_CONFIG,
} from '../../models/goal.models';
import { Asset, ASSET_TYPE_LABELS } from '../../models/finance.models';
import { Sip } from '../../models/sip.models';

@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './goals.component.html',
  styleUrl: './goals.component.scss',
})
export class GoalsComponent {
  goalService = inject(GoalService);
  assetService = inject(AssetService);
  sipService = inject(SipService);
  snackbar = inject(SnackbarService);

  readonly GOAL_CONFIG = GOAL_CATEGORY_CONFIG;
  readonly categories: GoalCategory[] = [
    'Retirement',
    'Home',
    'Education',
    'Vehicle',
    'Travel',
    'Wealth',
    'Emergency',
    'Family',
    'Other',
  ];

  selectedCategory = signal<string>('All');
  searchQuery = signal<string>('');

  // ── Modals State ──
  showAddEditModal = signal<boolean>(false);
  editingGoalId = signal<string | null>(null);

  // Form Fields
  formName = '';
  formCategory: GoalCategory = 'Retirement';
  formTargetAmount: number = 1000000;
  formTargetDate: string = '';
  formPriority: 'High' | 'Medium' | 'Low' = 'High';
  formNotes: string = '';

  // Mapping Modal State
  showMappingModal = signal<boolean>(false);
  activeMappingGoal = signal<GoalWithProgress | null>(null);
  selectedAssetIds = signal<Set<string>>(new Set());
  selectedSipIds = signal<Set<string>>(new Set());
  savingMapping = signal<boolean>(false);

  // Category filters inside mapping modal
  assetMappingCategory = signal<string>('All');
  sipMappingCategory = signal<string>('All');

  // Quick Contribution Modal
  showContributionModal = signal<boolean>(false);
  contributionGoal = signal<GoalWithProgress | null>(null);
  contributionAmount: number = 10000;

  constructor() {
    this.initDefaultDate();
  }

  private initDefaultDate() {
    const today = new Date();
    const future = new Date(today.getFullYear() + 5, today.getMonth(), today.getDate());
    this.formTargetDate = future.toISOString().split('T')[0];
  }

  // ── Filtered Goals ──
  readonly filteredGoals = computed<GoalWithProgress[]>(() => {
    let list = this.goalService.goalsWithProgress();
    const cat = this.selectedCategory();
    const q = this.searchQuery().toLowerCase().trim();

    if (cat !== 'All') {
      list = list.filter((g) => g.category === cat);
    }

    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.category.toLowerCase().includes(q) ||
          (g.notes && g.notes.toLowerCase().includes(q))
      );
    }

    return list;
  });

  // ── Mapping Modal Computed Filters (Hiding items mapped to other goals) ──
  readonly availableAssetsForGoal = computed<Asset[]>(() => {
    const goal = this.activeMappingGoal();
    if (!goal) return [];
    const all = this.goalService.assets() || [];
    // Only show unmapped items OR items already mapped to this current goal!
    return all.filter((a) => !a.goalId || a.goalId === goal.id);
  });

  readonly availableAssetCategories = computed<string[]>(() => {
    const assets = this.availableAssetsForGoal();
    const types = new Set<string>();
    for (const a of assets) {
      if (a.type) types.add(a.type);
    }
    return ['All', ...Array.from(types).sort()];
  });

  readonly filteredMappingAssets = computed<Asset[]>(() => {
    const cat = this.assetMappingCategory();
    const assets = this.availableAssetsForGoal();
    if (cat === 'All') return assets;
    return assets.filter((a) => a.type === cat);
  });

  readonly availableSipsForGoal = computed<Sip[]>(() => {
    const goal = this.activeMappingGoal();
    if (!goal) return [];
    const all = this.sipService.sips() || [];
    // Only show unmapped SIPs OR SIPs already mapped to this current goal!
    return all.filter((s) => !s.goalId || s.goalId === goal.id);
  });

  readonly availableSipCategories = computed<string[]>(() => {
    const sips = this.availableSipsForGoal();
    const cats = new Set<string>();
    for (const s of sips) {
      if (s.category) cats.add(s.category);
    }
    return ['All', ...Array.from(cats).sort()];
  });

  readonly filteredMappingSips = computed<Sip[]>(() => {
    const cat = this.sipMappingCategory();
    const sips = this.availableSipsForGoal();
    if (cat === 'All') return sips;
    return sips.filter((s) => s.category === cat);
  });

  // Live totals of selected items in the modal
  readonly selectedAssetsTotalValue = computed<number>(() => {
    const selected = this.selectedAssetIds();
    const assets = this.availableAssetsForGoal();
    return assets
      .filter((a) => a.id && selected.has(a.id))
      .reduce((sum, a) => sum + this.getAssetDisplayValue(a), 0);
  });

  readonly selectedSipsTotalMonthly = computed<number>(() => {
    const selected = this.selectedSipIds();
    const sips = this.availableSipsForGoal();
    return sips
      .filter((s) => selected.has(s.id))
      .reduce((sum, s) => sum + (s.amount || 0), 0);
  });

  // ── Modal Actions ──
  openAddModal() {
    this.editingGoalId.set(null);
    this.formName = '';
    this.formCategory = 'Retirement';
    this.formTargetAmount = 2500000;
    this.initDefaultDate();
    this.formPriority = 'High';
    this.formNotes = '';
    this.showAddEditModal.set(true);
  }

  openEditModal(goal: Goal) {
    this.editingGoalId.set(goal.id);
    this.formName = goal.name;
    this.formCategory = goal.category;
    this.formTargetAmount = goal.targetAmount;
    this.formTargetDate = goal.targetDate;
    this.formPriority = goal.priority;
    this.formNotes = goal.notes || '';
    this.showAddEditModal.set(true);
  }

  closeAddEditModal() {
    this.showAddEditModal.set(false);
    this.editingGoalId.set(null);
  }

  async saveGoal() {
    if (!this.formName.trim() || this.formTargetAmount <= 0) return;

    const catConfig = this.GOAL_CONFIG[this.formCategory];
    const data = {
      name: this.formName.trim(),
      category: this.formCategory,
      targetAmount: this.formTargetAmount,
      targetDate: this.formTargetDate,
      priority: this.formPriority,
      notes: this.formNotes.trim(),
      color: catConfig.color,
      icon: catConfig.icon,
    };

    if (this.editingGoalId()) {
      await this.goalService.updateGoal(this.editingGoalId()!, data);
    } else {
      await this.goalService.addGoal(data);
    }

    this.closeAddEditModal();
  }

  async deleteGoal(goal: Goal) {
    if (confirm(`Are you sure you want to delete goal "${goal.name}"? Linked investments will be unmapped.`)) {
      await this.goalService.deleteGoal(goal.id);
    }
  }

  // ── Investment Mapping Modal ──
  openMappingModal(goal: GoalWithProgress) {
    this.activeMappingGoal.set(goal);
    this.assetMappingCategory.set('All');
    this.sipMappingCategory.set('All');

    // Collect currently mapped assets
    const assets = this.goalService.assets() || [];
    const mappedAssets = new Set(assets.filter((a) => a.goalId === goal.id && a.id).map((a) => a.id!));
    this.selectedAssetIds.set(mappedAssets);

    // Collect currently mapped SIPs
    const sips = this.sipService.sips() || [];
    const mappedSips = new Set(sips.filter((s) => s.goalId === goal.id).map((s) => s.id));
    this.selectedSipIds.set(mappedSips);

    this.showMappingModal.set(true);
  }

  closeMappingModal() {
    this.showMappingModal.set(false);
    this.activeMappingGoal.set(null);
  }

  toggleAssetSelection(assetId: string) {
    this.selectedAssetIds.update((set) => {
      const next = new Set(set);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  toggleSipSelection(sipId: string) {
    this.selectedSipIds.update((set) => {
      const next = new Set(set);
      if (next.has(sipId)) {
        next.delete(sipId);
      } else {
        next.add(sipId);
      }
      return next;
    });
  }

  // ── Category Bulk Toggles ──
  isAllAssetsInViewSelected(): boolean {
    const visible = this.filteredMappingAssets();
    if (visible.length === 0) return false;
    const selected = this.selectedAssetIds();
    return visible.every((a) => a.id && selected.has(a.id));
  }

  toggleAllAssetsInView() {
    const visible = this.filteredMappingAssets();
    if (visible.length === 0) return;
    const allSelected = this.isAllAssetsInViewSelected();

    this.selectedAssetIds.update((set) => {
      const next = new Set(set);
      for (const a of visible) {
        if (!a.id) continue;
        if (allSelected) {
          next.delete(a.id);
        } else {
          next.add(a.id);
        }
      }
      return next;
    });
  }

  isAllSipsInViewSelected(): boolean {
    const visible = this.filteredMappingSips();
    if (visible.length === 0) return false;
    const selected = this.selectedSipIds();
    return visible.every((s) => selected.has(s.id));
  }

  toggleAllSipsInView() {
    const visible = this.filteredMappingSips();
    if (visible.length === 0) return;
    const allSelected = this.isAllSipsInViewSelected();

    this.selectedSipIds.update((set) => {
      const next = new Set(set);
      for (const s of visible) {
        if (allSelected) {
          next.delete(s.id);
        } else {
          next.add(s.id);
        }
      }
      return next;
    });
  }

  getAssetCategoryLabel(type: string): string {
    if (type === 'All') return 'All Assets';
    return (ASSET_TYPE_LABELS as Record<string, string>)[type] || type;
  }

  getAssetCategoryCount(cat: string): number {
    const all = this.availableAssetsForGoal();
    if (cat === 'All') return all.length;
    return all.filter((a) => a.type === cat).length;
  }

  getSipCategoryLabel(cat: string): string {
    if (cat === 'All') return 'All SIPs';
    return cat;
  }

  getSipCategoryCount(cat: string): number {
    const all = this.availableSipsForGoal();
    if (cat === 'All') return all.length;
    return all.filter((s) => s.category === cat).length;
  }

  // ── Batch Atomic Save ──
  async saveMapping() {
    const goal = this.activeMappingGoal();
    if (!goal || this.savingMapping()) return;

    this.savingMapping.set(true);
    try {
      const allAssets = this.goalService.assets() || [];
      const allSips = this.sipService.sips() || [];

      // Collect asset diffs
      const assetUpdates: { id: string; changes: Partial<Asset> }[] = [];
      for (const a of allAssets) {
        if (!a.id) continue;
        const isSelected = this.selectedAssetIds().has(a.id);
        const currentlyMappedToThis = a.goalId === goal.id;

        if (isSelected && !currentlyMappedToThis) {
          assetUpdates.push({ id: a.id, changes: { goalId: goal.id, goalName: goal.name } });
        } else if (!isSelected && currentlyMappedToThis) {
          assetUpdates.push({ id: a.id, changes: { goalId: undefined, goalName: undefined } });
        }
      }

      // Collect SIP diffs
      const sipUpdates: { id: string; changes: Partial<Sip> }[] = [];
      for (const s of allSips) {
        const isSelected = this.selectedSipIds().has(s.id);
        const currentlyMappedToThis = s.goalId === goal.id;

        if (isSelected && !currentlyMappedToThis) {
          sipUpdates.push({ id: s.id, changes: { goalId: goal.id, goalName: goal.name } });
        } else if (!isSelected && currentlyMappedToThis) {
          sipUpdates.push({ id: s.id, changes: { goalId: undefined, goalName: undefined } });
        }
      }

      const totalChanges = assetUpdates.length + sipUpdates.length;
      if (totalChanges > 0) {
        await this.goalService.batchMapInvestments(goal.id, assetUpdates, sipUpdates);
        this.snackbar.show(
          `Successfully updated links for "${goal.name}" (${assetUpdates.length} holdings, ${sipUpdates.length} SIPs).`,
          'success'
        );
      } else {
        this.snackbar.show('No changes made to links.', 'info');
      }

      this.closeMappingModal();
    } catch (err: any) {
      console.error('[Goals] Error saving mapping:', err);
      this.snackbar.show('Failed to save mappings. Please try again.', 'error');
    } finally {
      this.savingMapping.set(false);
    }
  }

  // ── Manual Contribution Modal ──
  openContributionModal(goal: GoalWithProgress) {
    this.contributionGoal.set(goal);
    this.contributionAmount = 10000;
    this.showContributionModal.set(true);
  }

  closeContributionModal() {
    this.showContributionModal.set(false);
    this.contributionGoal.set(null);
  }

  async saveContribution() {
    const goal = this.contributionGoal();
    if (!goal || this.contributionAmount <= 0) return;

    await this.goalService.addManualContribution(goal.id, this.contributionAmount);
    this.closeContributionModal();
  }

  // ── Helpers ──
  getAssetDisplayValue(a: Asset): number {
    const price = a.currentPrice && a.currentPrice > 0 ? a.currentPrice : (a.buyPrice || 0);
    const rate = a.currency === 'USD' ? 87.5 : 1;
    return Math.round((a.quantity || 0) * price * rate);
  }

  formatDateStr(dStr: string): string {
    if (!dStr) return '';
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    } catch {
      return dStr;
    }
  }
}
