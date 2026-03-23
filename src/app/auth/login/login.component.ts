import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Meta, Title } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';
import { PwaService } from '../../services/pwa.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './login.component.html',
    styleUrl: './login.component.scss',
})
export class LoginComponent {
    private authService = inject(AuthService);
    private router = inject(Router);
    private meta = inject(Meta);
    private titleService = inject(Title);
    public themeService = inject(ThemeService);
    public pwaService = inject(PwaService);

    constructor() {
        // Distinct title — a login page sharing a title with the landing page
        // is a Safe Browsing red flag for phishing.
        this.titleService.setTitle('Sign In | FinTracker');

        // Override the global "index, follow" — must use updateTag, not addTag.
        // addTag silently creates a duplicate tag which crawlers may ignore.
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

        // Canonical on /login points to the real domain so Google confirms
        // this is the legitimate page, not a phishing copy of another site.
        this.meta.updateTag(
            { rel: 'canonical', href: 'https://dmfintracker.web.app/login' },
            'rel=canonical'
        );
    }

    loading = signal(false);
    error = signal('');

    signInWithGoogle() {
        this.loading.set(true);
        this.error.set('');
        this.authService.signInWithGoogle().subscribe({
            next: () => {
                this.router.navigate(['/app/dashboard']);
            },
            error: (err: any) => {
                this.error.set('Sign in failed. Please try again.');
                this.loading.set(false);
                console.error(err);
            },
        });
    }
}
