import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PwaService } from '../services/pwa.service';
import { map, take } from 'rxjs';

/** Returns true if the current user agent is a known web crawler / bot. */
function isBot(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /googlebot|bingbot|yandex|baiduspider|twitterbot|facebookexternalhit|linkedinbot|slurp|duckduckbot|ia_archiver|msnbot|teoma|rogerbot|exabot|sogou|dotbot|semrushbot|ahrefsbot|petalbot/i
        .test(navigator.userAgent);
}

/**
 * Guard that redirects authenticated users to the app dashboard.
 * Used for public routes like landing page and login page.
 * Crawlers (Googlebot etc.) always bypass all redirects.
 */
export const authRedirectGuard: CanActivateFn = (_route, state) => {
    // Always let crawlers through so they receive the real page content.
    if (isBot()) {
        return true;
    }

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

            // If PWA is installed (standalone) and user is on the landing page ('/'),
            // redirect them directly to login instead of showing the SEO landing page.
            if (pwaService.isStandalone() && state.url === '/') {
                router.navigate(['/login']);
                return false;
            }

            return true;
        })
    );
};
