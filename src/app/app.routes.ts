import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { authRedirectGuard } from './auth/auth-redirect.guard';
import { pinSetupGuard } from './auth/pin-setup.guard';
// import { MarketDashboardComponent } from './features/market-dashboard/market-dashboard.component';

export const routes: Routes = [
    {
        path: '',
        canActivate: [authRedirectGuard],
        loadComponent: () =>
            import('./features/landing/landing.component').then((m) => m.LandingComponent),
    },
    {
        path: 'login',
        canActivate: [authRedirectGuard],
        loadComponent: () =>
            import('./auth/login/login.component').then((m) => m.LoginComponent),
    },
    {
        path: 'setup-pin',
        canActivate: [pinSetupGuard],
        loadComponent: () =>
            import('./features/setup-pin/setup-pin.component').then((m) => m.SetupPinComponent),
    },
    {
        path: 'terms',
        loadComponent: () =>
            import('./features/legal/terms.component').then((m) => m.TermsComponent),
    },
    {
        path: 'privacy',
        loadComponent: () =>
            import('./features/legal/privacy.component').then((m) => m.PrivacyComponent),
    },
    {
        path: 'docs',
        loadComponent: () =>
            import('./features/docs/docs.component').then((m) => m.DocsComponent),
    },
    {
        path: 'mcp-authorize',
        loadComponent: () =>
            import('./features/mcp-authorize/mcp-authorize.component').then((m) => m.McpAuthorizeComponent),
    },
    {
        path: 'oauth/authorize',
        redirectTo: 'mcp-authorize',
    },
    {
        path: 'developers',
        redirectTo: 'docs',
        pathMatch: 'full',
    },
    {
        path: 'api',
        redirectTo: 'docs',
        pathMatch: 'full',
    },
    {
        path: 'app',
        canActivate: [authGuard],
        canActivateChild: [authGuard],
        loadComponent: () =>
            import('./layout/layout.component').then((m) => m.LayoutComponent),
        children: [
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            {
                path: 'dashboard',
                loadComponent: () =>
                    import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
            },
            {
                path: 'assets',
                loadComponent: () =>
                    import('./features/assets/assets.component').then((m) => m.AssetsComponent),
            },
            {
                path: 'transactions',
                loadComponent: () =>
                    import('./features/transactions/transactions.component').then((m) => m.TransactionsComponent),
            },
            {
                path: 'sip',
                loadComponent: () =>
                    import('./features/sip/sip.component').then((m) => m.SipComponent),
            },
            {
                path: 'analytics',
                loadComponent: () =>
                    import('./features/analytics/analytics.component').then((m) => m.AnalyticsComponent),
            },
            {
                path: 'essentials',
                loadComponent: () =>
                    import('./features/essentials/essentials.component').then((m) => m.EssentialsComponent),
            },
            {
                path: 'emi',
                loadComponent: () =>
                    import('./features/emi/emi.component').then((m) => m.EmiComponent),
            },
            {
                path: 'settings',
                loadComponent: () =>
                    import('./features/settings/settings.component').then((m) => m.SettingsComponent),
            },
            /* {
                path: 'market',
                component: MarketDashboardComponent,
            }, */
        ],
    },
    // ── Developer Tools (localhost only, not linked in public navigation) ──
    {
        path: 'dev/cas-parser',
        loadComponent: () =>
            import('./features/dev/cas-parser-test/cas-parser-test.component').then(
                (m) => m.CasParserTestComponent
            ),
    },
    {
        path: 'dev/cas-parser-test',
        loadComponent: () =>
            import('./features/dev/cas-parser-test/cas-parser-test.component').then(
                (m) => m.CasParserTestComponent
            ),
    },
    { path: '**', redirectTo: '' },
];
