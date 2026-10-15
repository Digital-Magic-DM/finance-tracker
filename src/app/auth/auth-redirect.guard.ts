import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PinSecurityService } from '../services/pin-security.service';
import { PwaService } from '../services/pwa.service';
import { firstValueFrom } from 'rxjs';

/** Returns true if the current user agent is a known web crawler / bot. */
function isBot(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /googlebot|bingbot|yandex|baiduspider|twitterbot|facebookexternalhit|linkedinbot|slurp|duckduckbot|ia_archiver|msnbot|teoma|rogerbot|exabot|sogou|dotbot|semrushbot|ahrefsbot|petalbot/i
        .test(navigator.userAgent);
}

/**
 * Guard that redirects authenticated users to the app dashboard (or setup-pin if no PIN is set).
 * Used for public routes like landing page and login page.
 * Crawlers (Googlebot etc.) always bypass all redirects.
 */
export const authRedirectGuard: CanActivateFn = async (_route, state) => {
    // Always let crawlers through so they receive the real page content.
    if (isBot()) {
        return true;
    }

    const authService = inject(AuthService);
    const pinSecurity = inject(PinSecurityService);
    const pwaService = inject(PwaService);
    const router = inject(Router);

    const user = await firstValueFrom(authService.user$);
    if (user) {
        const hasPin = await pinSecurity.ensureLoaded(user.uid);
        if (hasPin) {
            router.navigate(['/app/dashboard']);
        } else {
            router.navigate(['/setup-pin']);
        }
        return false;
    }

    // If PWA is installed (standalone) and user is on the landing page ('/'),
    // redirect them directly to login instead of showing the SEO landing page.
    if (pwaService.isStandalone() && state.url === '/') {
        router.navigate(['/login']);
        return false;
    }

    return true;
};
