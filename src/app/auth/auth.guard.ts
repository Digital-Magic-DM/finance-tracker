import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PinSecurityService } from '../services/pin-security.service';
import { firstValueFrom } from 'rxjs';

export const authGuard: CanActivateFn = async () => {
    const authService = inject(AuthService);
    const pinSecurity = inject(PinSecurityService);
    const router = inject(Router);

    const user = await firstValueFrom(authService.user$);
    if (!user) {
        router.navigate(['/']);
        return false;
    }

    // Mandatory PIN Setup: ensure user cannot bypass PIN configuration
    const hasPin = await pinSecurity.ensureLoaded(user.uid);
    if (!hasPin) {
        router.navigate(['/setup-pin']);
        return false;
    }

    return true;
};
