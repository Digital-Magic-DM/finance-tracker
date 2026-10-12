import { Component, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DecimalPipe, CommonModule } from '@angular/common';
import { EssentialsService } from '../../services/essentials.service';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-essentials',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, FormsModule],
    templateUrl: './essentials.component.html',
    styleUrl: './essentials.component.scss'
})
export class EssentialsComponent {
    public essentialsService = inject(EssentialsService);
    Math = Math;
    
    // UI state for inline expansions
    showRunwayInfo = signal(false);
    showFireInfo = signal(false);
    showTermInfo = signal(false);
    showHealthInfo = signal(false);

    // Form Signals for editing profile
    isEditing = signal(false);
    isSaving = signal(false);
    editData = signal({
        age: 30,
        dependents: 0,
        targetRetirementAge: 60,
        annualExpenseMultiplier: 25,
        insurance: {
            termCover: 0,
            healthCover: 0
        },
        monthlyExpenseOverride: 0,
        monthlyIncomeOverride: 0,
        targetRunwayMonths: 6
    });

    // FI Matrix Data (Savings Rate vs Years to FI)
    fiMatrix: { rate: number, years: number | string }[] = [
        { rate: 10, years: 51 },
        { rate: 20, years: 37 },
        { rate: 30, years: 28 },
        { rate: 40, years: 22 },
        { rate: 50, years: 17 },
        { rate: 60, years: 12.5 },
        { rate: 70, years: 8.5 },
        { rate: 80, years: 5.5 },
        { rate: 90, years: '< 3' },
    ];

    healthStatus = computed(() => {
        const score = this.essentialsService.healthScore();
        if (score >= 9) return { label: 'Optimal', color: '#10B981', icon: 'auto_awesome', grade: 'A+' };
        if (score >= 7.5) return { label: 'Strong', color: '#3B82F6', icon: 'verified', grade: 'A' };
        if (score >= 5) return { label: 'Stable', color: '#F59E0B', icon: 'check_circle', grade: 'B' };
        return { label: 'Needs Focus', color: '#EF4444', icon: 'error', grade: 'C' };
    });

    startEdit() {
        const current = this.essentialsService.profile();
        if (current) {
            this.editData.set({
                age: current.age || 30,
                dependents: current.dependents || 0,
                targetRetirementAge: current.targetRetirementAge || 60,
                annualExpenseMultiplier: current.annualExpenseMultiplier || 25,
                insurance: {
                    termCover: current.insurance?.termCover || 0,
                    healthCover: current.insurance?.healthCover || 0
                },
                monthlyExpenseOverride: current.monthlyExpenseOverride || (this.essentialsService.avgMonthlyExpense() || 0),
                monthlyIncomeOverride: current.monthlyIncomeOverride || 0,
                targetRunwayMonths: current.targetRunwayMonths || 6
            });
        }
        this.isEditing.set(true);
    }

    async quickSetRunway(months: number) {
        this.editData.update(d => ({ ...d, targetRunwayMonths: months }));
        await this.essentialsService.updateProfile({ targetRunwayMonths: months });
    }

    async saveEdit() {
        this.isSaving.set(true);
        try {
            await this.essentialsService.updateProfile(this.editData());
            this.isEditing.set(false);
        } catch (err) {
            console.error('Failed to update profile:', err);
        } finally {
            this.isSaving.set(false);
        }
    }

    cancelEdit() {
        this.isEditing.set(false);
    }

    toggleRunwayInfo() {
        this.showRunwayInfo.update(v => !v);
    }

    toggleFireInfo() {
        this.showFireInfo.update(v => !v);
    }

    toggleTermInfo() {
        this.showTermInfo.update(v => !v);
    }

    toggleHealthInfo() {
        this.showHealthInfo.update(v => !v);
    }
}
