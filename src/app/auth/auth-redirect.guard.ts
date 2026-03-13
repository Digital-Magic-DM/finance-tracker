import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs';

/**
 * Guard that redirects authenticated users to the app dashboard.
 * Used for public routes like landing page and login page.
 */
export const authRedirectGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.user$.pipe(
        take(1),
        map((user) => {
            if (user) {
                router.navigate(['/app/dashboard']);
                return false;
            }
            return true;
        })
    );
};
