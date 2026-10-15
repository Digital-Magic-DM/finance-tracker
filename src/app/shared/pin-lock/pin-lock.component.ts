import { Component, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PinSecurityService } from '../../services/pin-security.service';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-pin-lock',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './pin-lock.component.html',
    styleUrl: './pin-lock.component.scss'
})
export class PinLockComponent {
    pinSecurity = inject(PinSecurityService);
    authService = inject(AuthService);

    enteredPin = signal<string>('');
    error = signal<string>('');
    isVerifying = signal<boolean>(false);
    showForgotModal = signal<boolean>(false);
    shakeError = signal<boolean>(false);

    readonly maxDigits = 4;

    @HostListener('window:keydown', ['$event'])
    handleKeyboard(event: KeyboardEvent) {
        if (this.showForgotModal()) return;

        if (event.key >= '0' && event.key <= '9') {
            this.appendDigit(event.key);
        } else if (event.key === 'Backspace') {
            this.deleteDigit();
        } else if (event.key === 'Escape') {
            this.clearPin();
        }
    }

    appendDigit(digit: string) {
        if (this.isVerifying()) return;
        this.error.set('');
        
        if (this.enteredPin().length < this.maxDigits) {
            const next = this.enteredPin() + digit;
            this.enteredPin.set(next);

            if (next.length === this.maxDigits) {
                this.verifyEnteredPin(next);
            }
        }
    }

    deleteDigit() {
        if (this.isVerifying()) return;
        this.error.set('');
        const current = this.enteredPin();
        if (current.length > 0) {
            this.enteredPin.set(current.slice(0, -1));
        }
    }

    clearPin() {
        this.enteredPin.set('');
        this.error.set('');
    }

    async verifyEnteredPin(pin: string) {
        this.isVerifying.set(true);
        try {
            const success = await this.pinSecurity.unlock(pin);
            if (!success) {
                this.error.set('Incorrect PIN. Please try again.');
                this.triggerShake();
                this.enteredPin.set('');
            }
        } finally {
            this.isVerifying.set(false);
        }
    }

    private triggerShake() {
        this.shakeError.set(true);
        setTimeout(() => this.shakeError.set(false), 500);
    }

    signOutToReset() {
        this.pinSecurity.isLocked.set(false);
        this.authService.signOut().subscribe();
    }
}
