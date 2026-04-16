import { Component, inject, output, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PwaService } from '../../services/pwa.service';
import { VERSION } from '../../../environments/version';

interface NavItem {
    label: string;
    icon: string;
    route: string;
}

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [RouterLink, RouterLinkActive],
    templateUrl: './sidebar.component.html',
    styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
    private authService = inject(AuthService);
    public pwaService = inject(PwaService);
    collapsed = input(false);
    closeSidebar = output<void>();
    toggleCollapse = output<void>();
    appVersion = VERSION;

    navItems: NavItem[] = [
        // { label: 'Live Market', icon: 'bolt', route: '/app/market' },
        { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard' },
        { label: 'Assets', icon: 'account_balance_wallet', route: '/app/assets' },
        { label: 'Transactions', icon: 'receipt_long', route: '/app/transactions' },
        { label: 'Analytics', icon: 'analytics', route: '/app/analytics' },
        { label: 'Essentials', icon: 'health_and_safety', route: '/app/essentials' },
        { label: 'Settings', icon: 'settings', route: '/app/settings' },
    ];

    signOut() {
        this.authService.signOut().subscribe();
    }
}
