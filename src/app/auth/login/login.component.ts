import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Meta, Title } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';
import { PwaService } from '../../services/pwa.service';
import { PinSecurityService } from '../../services/pin-security.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [RouterLink, FormsModule],
    templateUrl: './login.component.html',
    styleUrl: './login.component.scss',
})
export class LoginComponent {
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private meta = inject(Meta);
    private titleService = inject(Title);
    public themeService = inject(ThemeService);
    public pwaService = inject(PwaService);

    constructor() {
        this.titleService.setTitle('Sign In | FinTracker');
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
        this.meta.updateTag(
            { rel: 'canonical', href: 'https://dmfintracker.web.app/login' },
            'rel=canonical'
        );
    }

    loading = signal(false);
    error = signal('');
    
    authMode: 'email' | 'google' = 'google';
    
    // Email Auth State
    isSignUp = false;
    name = '';
    email = '';
    password = '';

    setAuthMode(mode: 'email' | 'google') {
        this.authMode = mode;
        this.error.set('');
    }

    private pinSecurity = inject(PinSecurityService);

    submitEmailAuth() {
        if (!this.email || !this.password) {
            this.error.set('Please enter email and password.');
            return;
        }

        if (this.isSignUp && !this.name) {
            this.error.set('Please enter your name.');
            return;
        }

        this.loading.set(true);
        this.error.set('');

        const authAction = this.isSignUp 
            ? this.authService.signUpWithEmail(this.email, this.password, this.name)
            : this.authService.signInWithEmail(this.email, this.password);

        authAction.subscribe({
            next: async () => {
                const user = this.authService.getCurrentUser();
                if (user) {
                    const hasPin = await this.pinSecurity.ensureLoaded(user.uid);
                    if (!hasPin) {
                        this.router.navigate(['/setup-pin']);
                        return;
                    }
                }
                const redirect = this.route.snapshot.queryParamMap.get('redirect') || 
                                 this.route.snapshot.queryParamMap.get('returnUrl') || 
                                 '/app/dashboard';
                this.router.navigateByUrl(redirect);
            },
            error: (err: any) => {
                // Map Firebase error codes to friendly messages
                const errorCode = err.code || err.message || '';
                let friendlyMessage = 'An unexpected error occurred. Please try again.';

                if (errorCode.includes('email-already-in-use') || errorCode.includes('EMAIL_EXISTS')) {
                    friendlyMessage = 'This email is already registered. Please sign in instead.';
                } else if (errorCode.includes('invalid-email') || errorCode.includes('INVALID_EMAIL')) {
                    friendlyMessage = 'Please enter a valid email address.';
                } else if (errorCode.includes('weak-password') || errorCode.includes('WEAK_PASSWORD')) {
                    friendlyMessage = 'Your password is too weak. It must be at least 6 characters.';
                } else if (errorCode.includes('user-not-found') || errorCode.includes('EMAIL_NOT_FOUND')) {
                    friendlyMessage = 'No account found with this email. Please sign up first.';
                } else if (errorCode.includes('wrong-password') || errorCode.includes('INVALID_PASSWORD') || errorCode.includes('invalid-credential')) {
                    friendlyMessage = 'Incorrect email or password. Please try again.';
                } else if (errorCode.includes('too-many-requests')) {
                    friendlyMessage = 'Too many failed attempts. Try again later.';
                } else {
                    // Fallback for unknown errors
                    friendlyMessage = this.isSignUp ? 'Sign up failed.' : 'Sign in failed. Check credentials.';
                }

                this.error.set(friendlyMessage);
                this.loading.set(false);
                console.error("Firebase Auth Error: ", err);
            },
        });
    }

    signInWithGoogle() {
        this.loading.set(true);
        this.error.set('');
        this.authService.signInWithGoogle().subscribe({
            next: async () => {
                const user = this.authService.getCurrentUser();
                if (user) {
                    const hasPin = await this.pinSecurity.ensureLoaded(user.uid);
                    if (!hasPin) {
                        this.router.navigate(['/setup-pin']);
                        return;
                    }
                }
                const redirect = this.route.snapshot.queryParamMap.get('redirect') || 
                                 this.route.snapshot.queryParamMap.get('returnUrl') || 
                                 '/app/dashboard';
                this.router.navigateByUrl(redirect);
            },
            error: (err: any) => {
                this.error.set('Sign in failed. Please try again.');
                this.loading.set(false);
                console.error(err);
            },
        });
    }
}
