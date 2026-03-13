import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { authRedirectGuard } from './auth/auth-redirect.guard';

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
        path: 'app',
        canActivate: [authGuard],
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
                path: 'analytics',
                loadComponent: () =>
                    import('./features/analytics/analytics.component').then((m) => m.AnalyticsComponent),
            },
            {
                path: 'settings',
                loadComponent: () =>
                    import('./features/settings/settings.component').then((m) => m.SettingsComponent),
            },
        ],
    },
    { path: '**', redirectTo: '' },
];
