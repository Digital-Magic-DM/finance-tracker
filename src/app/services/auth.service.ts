import { Injectable, inject, signal } from '@angular/core';
import {
    Auth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    user,
} from '@angular/fire/auth';
import { Router } from '@angular/router';
import { from, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private auth = inject(Auth);
    private router = inject(Router);

    readonly currentUser$ = user(this.auth);
    readonly isLoggedIn = signal(false);

    constructor() {
        this.currentUser$.subscribe((u) => {
            this.isLoggedIn.set(!!u);
        });
    }

    signInWithGoogle(): Observable<any> {
        const provider = new GoogleAuthProvider();
        return from(signInWithPopup(this.auth, provider));
    }

    signOut(): Observable<void> {
        return from(
            signOut(this.auth).then(() => {
                this.router.navigate(['/login']);
            })
        );
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }
}
