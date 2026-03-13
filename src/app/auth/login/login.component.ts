import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Meta } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';

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
    private themeService = inject(ThemeService);

    constructor() {
        this.themeService.clearTheme();
        this.meta.addTag({ name: 'robots', content: 'noindex, follow' });
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
