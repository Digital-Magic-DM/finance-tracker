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

    readonly user$ = user(this.auth);
    readonly firebaseUser = toSignal(this.user$);
    readonly isLoggedIn = computed(() => !!this.firebaseUser());

    signInWithGoogle(): Observable<any> {
        const provider = new GoogleAuthProvider();
        return from(signInWithPopup(this.auth, provider));
    }


    signOut(): Observable<void> {
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
