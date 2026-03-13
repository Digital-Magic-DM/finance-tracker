import { Injectable, inject, signal, computed } from '@angular/core';
import {
    Auth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    user,
} from '@angular/fire/auth';
import { Router } from '@angular/router';
import { from, Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private auth = inject(Auth);
    private router = inject(Router);

    readonly firebaseUser = toSignal(user(this.auth));
    private devBypass = signal(false);

    readonly isLoggedIn = computed(() => this.devBypass() || !!this.firebaseUser());

    signInWithGoogle(): Observable<any> {
        const provider = new GoogleAuthProvider();
        return from(signInWithPopup(this.auth, provider));
    }

    setBypass(value: boolean) {
        this.devBypass.set(value);
    }

    signOut(): Observable<void> {
        this.devBypass.set(false);
        return from(
            signOut(this.auth).then(() => {
                this.router.navigate(['/']);
            })
        );
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }
}
