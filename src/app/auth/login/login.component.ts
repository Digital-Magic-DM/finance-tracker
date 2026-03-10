import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [],
    templateUrl: './login.component.html',
    styleUrl: './login.component.scss',
})
export class LoginComponent {
    private authService = inject(AuthService);
    private router = inject(Router);

    loading = signal(false);
    error = signal('');

    signInWithGoogle() {
        this.loading.set(true);
        this.error.set('');
        this.authService.signInWithGoogle().subscribe({
            next: () => {
                this.router.navigate(['/dashboard']);
            },
            error: (err: any) => {
                this.error.set('Sign in failed. Please try again.');
                this.loading.set(false);
                console.error(err);
            },
        });
    }
}
