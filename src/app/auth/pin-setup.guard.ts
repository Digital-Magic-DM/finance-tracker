import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PinSecurityService } from '../services/pin-security.service';
import { firstValueFrom } from 'rxjs';

/**
 * Route guard for the mandatory Setup PIN page.
 * - If user is unauthenticated -> redirects to /login.
 * - If user already configured their PIN -> redirects to /app/dashboard.
 * - Only users with missing PIN are permitted to access /setup-pin.
 */
export const pinSetupGuard: CanActivateFn = async () => {
    const authService = inject(AuthService);
    const pinSecurity = inject(PinSecurityService);
    const router = inject(Router);

    const user = await firstValueFrom(authService.user$);
    if (!user) {
        router.navigate(['/login']);
        return false;
    }

    const hasPin = await pinSecurity.ensureLoaded(user.uid);
    if (hasPin) {
        // PIN is already configured, redirect to dashboard
        router.navigate(['/app/dashboard']);
        return false;
    }

    return true;
};
