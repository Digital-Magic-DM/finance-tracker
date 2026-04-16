import { Injectable, inject, computed, Injector, runInInjectionContext } from '@angular/core';
import {
    Auth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    user,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile
} from '@angular/fire/auth';
import { Router } from '@angular/router';
import { from, Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private auth = inject(Auth);
    private router = inject(Router);
    private injector = inject(Injector);

    readonly user$ = user(this.auth);
    readonly firebaseUser = toSignal(this.user$);
    readonly isLoggedIn = computed(() => !!this.firebaseUser());

    signInWithGoogle(): Observable<any> {
        return runInInjectionContext(this.injector, () => {
            const provider = new GoogleAuthProvider();
            return from(signInWithPopup(this.auth, provider));
        });
    }

    signInWithEmail(email: string, password: string): Observable<any> {
        return runInInjectionContext(this.injector, () => {
            return from(signInWithEmailAndPassword(this.auth, email, password));
        });
    }

    signUpWithEmail(email: string, password: string, displayName: string): Observable<any> {
        return runInInjectionContext(this.injector, () => {
            return from(
                createUserWithEmailAndPassword(this.auth, email, password).then((credential) => {
                    return updateProfile(credential.user, { displayName }).then(() => credential);
                })
            );
        });
    }

    signOut(): Observable<void> {
        return runInInjectionContext(this.injector, () => {
            return from(
                signOut(this.auth).then(() => {
                    this.router.navigate(['/']);
                })
            );
        });
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }
}
