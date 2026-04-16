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
    
    // UI state for inline expansions
    showRunwayInfo = signal(false);
    showFireInfo = signal(false);
    showTermInfo = signal(false);
    showHealthInfo = signal(false);

    // Form Signals for editing profile
    isEditing = signal(false);
    editData = signal({
        age: 30,
        dependents: 0,
        targetRetirementAge: 60,
        annualExpenseMultiplier: 25,
        insurance: {
            termCover: 0,
            healthCover: 0
        }
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
        if (score >= 9) return { label: 'Perfect', color: 'var(--accent-success-blend)', icon: 'auto_awesome' };
        if (score >= 7.5) return { label: 'Excellent', color: 'var(--accent-success-blend)', icon: 'verified' };
        if (score >= 5) return { label: 'Solid', color: 'var(--accent-warning-blend)', icon: 'check_circle' };
        return { label: 'Critical', color: 'var(--accent-danger-blend)', icon: 'error' };
    });

    startEdit() {
        const current = this.essentialsService.profile();
        if (current) {
            this.editData.set(JSON.parse(JSON.stringify(current)));
        }
        this.isEditing.set(true);
    }

    async saveEdit() {
        await this.essentialsService.updateProfile(this.editData());
        this.isEditing.set(false);
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
