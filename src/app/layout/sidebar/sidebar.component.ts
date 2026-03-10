import { Component, inject, signal, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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
    collapsed = signal(false);
    closeSidebar = output<void>();

    navItems: NavItem[] = [
        { label: 'Dashboard', icon: '◈', route: '/dashboard' },
        { label: 'Assets', icon: '◆', route: '/assets' },
        { label: 'Transactions', icon: '⇌', route: '/transactions' },
        { label: 'Analytics', icon: '▲', route: '/analytics' },
        { label: 'Settings', icon: '⚙', route: '/settings' },
    ];

    signOut() {
        this.authService.signOut().subscribe();
    }
}
