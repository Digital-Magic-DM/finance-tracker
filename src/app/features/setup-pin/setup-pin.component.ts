import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PinSecurityService } from '../../services/pin-security.service';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { Title } from '@angular/platform-browser';

@Component({
    selector: 'app-setup-pin',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './setup-pin.component.html',
    styleUrl: './setup-pin.component.scss'
})
export class SetupPinComponent {
    private pinSecurity = inject(PinSecurityService);
    private authService = inject(AuthService);
    private router = inject(Router);
    private title = inject(Title);
    public themeService = inject(ThemeService);

    user = this.authService.firebaseUser;

    newPin = signal<string>('');
    confirmPin = signal<string>('');
    showPin = signal<boolean>(false);
    error = signal<string>('');
    isSubmitting = signal<boolean>(false);

    constructor() {
        this.title.setTitle('Set Security PIN | FinTracker');
    }

    toggleShowPin() {
        this.showPin.update((v) => !v);
    }

    async handleSetPin() {
        this.error.set('');
        const pin = this.newPin().trim();
        const confirm = this.confirmPin().trim();

        if (!/^\d{4,6}$/.test(pin)) {
            this.error.set('PIN must be 4 to 6 numeric digits.');
            return;
        }

        if (pin !== confirm) {
            this.error.set('PIN and Confirm PIN do not match.');
            return;
        }

        this.isSubmitting.set(true);
        try {
            const res = await this.pinSecurity.setPin(pin);
            if (res.success) {
                // Instantly navigate to dashboard upon successful PIN setup
                await this.router.navigate(['/app/dashboard']);
            } else {
                this.error.set(res.message);
            }
        } catch (err: any) {
            this.error.set(err.message || 'Failed to configure security PIN.');
        } finally {
            this.isSubmitting.set(false);
        }
    }

    signOut() {
        this.authService.signOut().subscribe();
    }
}
