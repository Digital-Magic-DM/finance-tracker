import { Component, inject, output, signal, HostListener, ElementRef } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { Router, NavigationEnd, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { AsyncPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-toolbar',
    standalone: true,
    imports: [AsyncPipe, RouterLink],
    templateUrl: './toolbar.component.html',
    styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
    authService = inject(AuthService);
    themeService = inject(ThemeService);
    private router = inject(Router);
    private el = inject(ElementRef);

    sidebarToggle = output<void>();
    showProfileDropdown = signal(false);

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: Event) {
        if (!this.el.nativeElement.contains(event.target)) {
            this.showProfileDropdown.set(false);
        }
    }

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

    signOut() {
        this.authService.signOut().subscribe();
        this.showProfileDropdown.set(false);
    }
}
