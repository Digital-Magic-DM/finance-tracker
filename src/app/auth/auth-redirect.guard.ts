import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard that redirects authenticated users to the app dashboard.
 * Used for public routes like landing page and login page.
 */
export const authRedirectGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);
    
    if (authService.isLoggedIn()) {
        router.navigate(['/app/dashboard']);
        return false;
    }
    return true;
};
