import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { map, take } from 'rxjs/operators';

/**
 * Guard that redirects authenticated users to the app dashboard.
 * Used for public routes like landing page and login page.
 */
export const authRedirectGuard: CanActivateFn = () => {
    const auth = inject(Auth);
    const router = inject(Router);
    
    return user(auth).pipe(
        take(1),
        map((u) => {
            if (u) {
                router.navigate(['/app/dashboard']);
                return false;
            }
            return true;
        })
    );
};
