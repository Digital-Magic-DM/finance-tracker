import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeviceSessionService } from '../../services/device-session.service';
import { PinSecurityService } from '../../services/pin-security.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-security-remediation-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security-remediation-modal.component.html',
  styleUrl: './security-remediation-modal.component.scss'
})
export class SecurityRemediationModalComponent {
  deviceService = inject(DeviceSessionService);
  pinSecurity = inject(PinSecurityService);
  authService = inject(AuthService);

  readonly compromisedDevice = this.deviceService.compromisedDevice;
  readonly userEmail = computed(() => this.authService.firebaseUser()?.email || 'your email');
  readonly loginProvider = computed(() => this.authService.getLoginProvider());
  readonly hasPin = this.pinSecurity.isPinSet;

  // Active remediation tab
  activeTab = signal<'pin' | 'password' | 'google'>('pin');

  // PIN change state
  currentPin = signal('');
  newPin = signal('');
  confirmPin = signal('');
  pinError = signal('');
  pinSuccess = signal('');
  isUpdatingPin = signal(false);

  // Direct password update state
  newPassword = signal('');
  confirmPassword = signal('');
  passwordError = signal('');
  passwordSuccess = signal('');
  isUpdatingPassword = signal(false);
  isSendingReset = signal(false);
  resetSent = signal(false);

  constructor() {
    // Select the most relevant initial tab depending on security setup
    if (this.pinSecurity.isPinSet()) {
      this.activeTab.set('pin');
    } else if (this.loginProvider() === 'password') {
      this.activeTab.set('password');
    } else {
      this.activeTab.set('google');
    }
  }

  async onUpdatePin(): Promise<void> {
    this.pinError.set('');
    this.pinSuccess.set('');

    const curr = this.currentPin().trim();
    const np = this.newPin().trim();
    const cp = this.confirmPin().trim();

    if (!curr) {
      this.pinError.set('Please enter your current security PIN.');
      return;
    }
    if (!/^\d{4,6}$/.test(np)) {
      this.pinError.set('New PIN must be 4 to 6 numeric digits.');
      return;
    }
    if (np !== cp) {
      this.pinError.set('New PIN and confirmation do not match.');
      return;
    }
    if (curr === np) {
      this.pinError.set('New PIN must be different from current PIN.');
      return;
    }

    this.isUpdatingPin.set(true);
    try {
      const res = await this.pinSecurity.changePin(curr, np);
      if (res.success) {
        this.pinSuccess.set('Security PIN successfully updated! Your account is now secured.');
        this.currentPin.set('');
        this.newPin.set('');
        this.confirmPin.set('');
      } else {
        this.pinError.set(res.message);
      }
    } catch (err: any) {
      this.pinError.set(err.message || 'Failed to update PIN.');
    } finally {
      this.isUpdatingPin.set(false);
    }
  }

  async onEmergencySetPin(): Promise<void> {
    this.pinError.set('');
    this.pinSuccess.set('');

    const np = this.newPin().trim();
    const cp = this.confirmPin().trim();

    if (!/^\d{4,6}$/.test(np)) {
      this.pinError.set('PIN must be 4 to 6 numeric digits.');
      return;
    }
    if (np !== cp) {
      this.pinError.set('PIN and confirmation do not match.');
      return;
    }

    this.isUpdatingPin.set(true);
    try {
      const res = await this.pinSecurity.setPin(np);
      if (res.success) {
        this.pinSuccess.set('Security PIN created and active on this device!');
        this.newPin.set('');
        this.confirmPin.set('');
      } else {
        this.pinError.set(res.message);
      }
    } catch (err: any) {
      this.pinError.set(err.message || 'Failed to set PIN.');
    } finally {
      this.isUpdatingPin.set(false);
    }
  }

  sendPasswordResetLink(): void {
    this.passwordError.set('');
    this.isSendingReset.set(true);

    this.authService.sendPasswordReset().subscribe({
      next: () => {
        this.resetSent.set(true);
        this.isSendingReset.set(false);
        this.passwordSuccess.set(`Password reset link sent to ${this.userEmail()}. Please check your inbox and spam folder.`);
      },
      error: (err: any) => {
        this.passwordError.set(err.message || 'Failed to send password reset email.');
        this.isSendingReset.set(false);
      }
    });
  }

  onUpdatePassword(): void {
    this.passwordError.set('');
    this.passwordSuccess.set('');

    const np = this.newPassword().trim();
    const cp = this.confirmPassword().trim();

    if (np.length < 6) {
      this.passwordError.set('Password must be at least 6 characters long.');
      return;
    }
    if (np !== cp) {
      this.passwordError.set('Passwords do not match.');
      return;
    }

    this.isUpdatingPassword.set(true);
    this.authService.updateUserPassword(np).subscribe({
      next: () => {
        this.passwordSuccess.set('Password successfully updated! Keep your new password secure.');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.isUpdatingPassword.set(false);
      },
      error: (err: any) => {
        if (err.code === 'auth/requires-recent-login') {
          this.passwordError.set('For your protection, Firebase requires recent re-authentication. Please use the "Send Password Reset Link" button instead.');
        } else {
          this.passwordError.set(err.message || 'Failed to update password.');
        }
        this.isUpdatingPassword.set(false);
      }
    });
  }

  revokeAllOtherDevices(): void {
    this.deviceService.revokeAllOtherSessions();
  }

  close(): void {
    this.deviceService.closeRemediationModal();
  }
}
