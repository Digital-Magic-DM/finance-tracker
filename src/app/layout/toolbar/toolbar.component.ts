import { Component, inject, output } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { AsyncPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-toolbar',
    standalone: true,
    imports: [AsyncPipe],
    templateUrl: './toolbar.component.html',
    styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
    authService = inject(AuthService);
    themeService = inject(ThemeService);
    private router = inject(Router);

    sidebarToggle = output<void>();

    pageTitle = toSignal(
        this.router.events.pipe(
            filter((e) => e instanceof NavigationEnd),
            map(() => {
                const url = this.router.url.split('/')[1] || 'dashboard';
                return url.charAt(0).toUpperCase() + url.slice(1);
            })
        ),
        { initialValue: 'Dashboard' }
    );

    get user() {
        return this.authService.currentUser$;
    }
}
