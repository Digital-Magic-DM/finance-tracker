import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PwaService } from '../services/pwa.service';
import { map, take } from 'rxjs';

/**
 * Guard that redirects authenticated users to the app dashboard.
 * Used for public routes like landing page and login page.
 */
export const authRedirectGuard: CanActivateFn = (_route, state) => {
    const authService = inject(AuthService);
    const pwaService = inject(PwaService);
    const router = inject(Router);

    return authService.user$.pipe(
        take(1),
        map((user) => {
            if (user) {
                router.navigate(['/app/dashboard']);
                return false;
            }

            // If PWA is installed (standalone) and user is on the landing page (''),
            // redirect them directly to login instead of showing the SEO landing page.
            if (pwaService.isStandalone() && state.url === '/') {
                router.navigate(['/login']);
                return false;
            }

            return true;
        })
    );
};
