import { Injectable, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, deleteDoc } from '@angular/fire/firestore';
import { SnackbarService } from './snackbar.service';

export interface PinSecurityState {
    hasPin: boolean;
    requireOnLaunch: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class PinSecurityService {
    private auth = inject(Auth);
    private firestore = inject(Firestore);
    private snackbar = inject(SnackbarService);

    readonly isPinSet = signal<boolean>(false);
    readonly isLocked = signal<boolean>(false);
    readonly requireLaunchLock = signal<boolean>(true);
    readonly isLoaded = signal<boolean>(false);

    private currentPinHash: string | null = null;
    private currentPinSalt: string | null = null;
    private loadPromiseMap = new Map<string, Promise<boolean>>();

    constructor() {
        // Reactively watch for auth state changes to load PIN security
        this.auth.onAuthStateChanged((user) => {
            if (user) {
                this.loadSecuritySettings(user.uid);
            } else {
                this.resetState();
            }
        });
    }

    /**
     * Ensures PIN security configuration is loaded from localStorage and Firestore.
     * Used by route guards to prevent bypassing mandatory PIN setup.
     */
    async ensureLoaded(uid?: string): Promise<boolean> {
        const targetUid = uid || this.auth.currentUser?.uid;
        if (!targetUid) return false;

        // Fast path: check localStorage synchronously
        const keys = this.getStorageKeys(targetUid);
        const localHash = localStorage.getItem(keys.hash);
        const localSalt = localStorage.getItem(keys.salt);
        const localLaunch = localStorage.getItem(keys.launchLock);
        const isSessionUnlocked = sessionStorage.getItem(keys.unlockedSession) === 'true';

        if (localLaunch !== null) {
            this.requireLaunchLock.set(localLaunch === 'true');
        }

        if (localHash && localSalt) {
            this.currentPinHash = localHash;
            this.currentPinSalt = localSalt;
            this.isPinSet.set(true);

            // Crucial: Set isLocked synchronously BEFORE router-outlet or any component mounts
            if (this.requireLaunchLock() && !isSessionUnlocked) {
                this.isLocked.set(true);
            } else {
                this.isLocked.set(false);
            }
            this.isLoaded.set(true);
            return true;
        }

        // If already loaded and verified from Firestore, return current status
        if (this.isLoaded()) {
            return this.isPinSet();
        }

        // Check if a load is already in-flight for this user
        if (!this.loadPromiseMap.has(targetUid)) {
            const p = this.loadSecuritySettings(targetUid).then(() => this.isPinSet());
            this.loadPromiseMap.set(targetUid, p);
        }

        return this.loadPromiseMap.get(targetUid)!;
    }

    private getStorageKeys(uid: string) {
        return {
            hash: `fintracker_pin_hash_${uid}`,
            salt: `fintracker_pin_salt_${uid}`,
            launchLock: `fintracker_pin_launch_lock_${uid}`,
            unlockedSession: `fintracker_pin_unlocked_${uid}`,
        };
    }

    async loadSecuritySettings(uid: string) {
        const keys = this.getStorageKeys(uid);

        // 1. Check local storage first for instant responsiveness
        let localHash = localStorage.getItem(keys.hash);
        let localSalt = localStorage.getItem(keys.salt);
        const localLaunch = localStorage.getItem(keys.launchLock);
        const isSessionUnlocked = sessionStorage.getItem(keys.unlockedSession) === 'true';

        if (localLaunch !== null) {
            this.requireLaunchLock.set(localLaunch === 'true');
        }

        // 2. Fetch from Firestore to sync across devices
        try {
            const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
            const snap = await getDoc(secDocRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data['pinHash'] && data['pinSalt']) {
                    localHash = data['pinHash'];
                    localSalt = data['pinSalt'];
                    localStorage.setItem(keys.hash, localHash!);
                    localStorage.setItem(keys.salt, localSalt!);
                }
                if (typeof data['requireOnLaunch'] === 'boolean') {
                    this.requireLaunchLock.set(data['requireOnLaunch']);
                    localStorage.setItem(keys.launchLock, String(data['requireOnLaunch']));
                }
            } else if (localHash && localSalt) {
                // Migrate local PIN to Firestore if not already there
                await setDoc(secDocRef, {
                    pinHash: localHash,
                    pinSalt: localSalt,
                    requireOnLaunch: this.requireLaunchLock(),
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            }
        } catch (err) {
            console.warn('[PinSecurity] Firestore sync notice (offline or permissions):', err);
        }

        this.currentPinHash = localHash;
        this.currentPinSalt = localSalt;

        if (localHash && localSalt) {
            this.isPinSet.set(true);
            // If launch lock is enabled and session is not yet unlocked in this tab, lock
            if (this.requireLaunchLock() && !isSessionUnlocked) {
                this.isLocked.set(true);
            } else {
                this.isLocked.set(false);
            }
        } else {
            this.isPinSet.set(false);
            this.isLocked.set(false);
        }

        this.isLoaded.set(true);
    }

    private resetState() {
        this.isPinSet.set(false);
        this.isLocked.set(false);
        this.currentPinHash = null;
        this.currentPinSalt = null;
        this.isLoaded.set(false);
        this.loadPromiseMap.clear();
    }

    private async hashPin(pin: string, salt: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(`${salt}:fintracker_secret:${pin}`);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private generateSalt(): string {
        const randomValues = new Uint8Array(16);
        crypto.getRandomValues(randomValues);
        return Array.from(randomValues).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Set a new security PIN (first-time setup)
     */
    async setPin(pin: string): Promise<{ success: boolean; message: string }> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return { success: false, message: 'Please sign in to set a security PIN.' };

        if (!/^\d{4,6}$/.test(pin)) {
            return { success: false, message: 'PIN must be between 4 and 6 numeric digits.' };
        }

        try {
            const salt = this.generateSalt();
            const hash = await this.hashPin(pin, salt);
            const keys = this.getStorageKeys(uid);

            localStorage.setItem(keys.hash, hash);
            localStorage.setItem(keys.salt, salt);
            localStorage.setItem(keys.launchLock, 'true');
            sessionStorage.setItem(keys.unlockedSession, 'true');

            this.currentPinHash = hash;
            this.currentPinSalt = salt;
            this.isPinSet.set(true);
            this.isLocked.set(false);
            this.requireLaunchLock.set(true);
            this.loadPromiseMap.clear();

            // Sync with Firestore
            try {
                const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
                await setDoc(secDocRef, {
                    pinHash: hash,
                    pinSalt: salt,
                    requireOnLaunch: true,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (fsErr) {
                console.warn('[PinSecurity] Firestore sync failed, saved locally:', fsErr);
            }

            this.snackbar.show('Security PIN successfully configured and enabled!', 'success');
            return { success: true, message: 'Security PIN set successfully.' };
        } catch (err: any) {
            return { success: false, message: err.message || 'Failed to set PIN.' };
        }
    }

    /**
     * Verify if the entered PIN matches the active PIN
     */
    async verifyPin(pin: string): Promise<boolean> {
        if (!this.currentPinHash || !this.currentPinSalt) return false;
        const testHash = await this.hashPin(pin, this.currentPinSalt);
        return testHash === this.currentPinHash;
    }

    /**
     * Change existing security PIN
     */
    async changePin(oldPin: string, newPin: string): Promise<{ success: boolean; message: string }> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return { success: false, message: 'User not authenticated.' };

        if (!await this.verifyPin(oldPin)) {
            return { success: false, message: 'Current PIN is incorrect.' };
        }

        if (!/^\d{4,6}$/.test(newPin)) {
            return { success: false, message: 'New PIN must be between 4 and 6 numeric digits.' };
        }

        if (oldPin === newPin) {
            return { success: false, message: 'New PIN must be different from the current PIN.' };
        }

        try {
            const newSalt = this.generateSalt();
            const newHash = await this.hashPin(newPin, newSalt);
            const keys = this.getStorageKeys(uid);

            localStorage.setItem(keys.hash, newHash);
            localStorage.setItem(keys.salt, newSalt);
            sessionStorage.setItem(keys.unlockedSession, 'true');

            this.currentPinHash = newHash;
            this.currentPinSalt = newSalt;

            // Sync with Firestore
            try {
                const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
                await setDoc(secDocRef, {
                    pinHash: newHash,
                    pinSalt: newSalt,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (fsErr) {
                console.warn('[PinSecurity] Firestore sync error:', fsErr);
            }

            this.snackbar.show('Security PIN updated successfully.', 'success');
            return { success: true, message: 'PIN updated successfully.' };
        } catch (err: any) {
            return { success: false, message: err.message || 'Failed to update PIN.' };
        }
    }

    /**
     * Remove / Disable security PIN
     */
    async removePin(currentPin: string): Promise<{ success: boolean; message: string }> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return { success: false, message: 'User not authenticated.' };

        if (!await this.verifyPin(currentPin)) {
            return { success: false, message: 'Current PIN is incorrect.' };
        }

        try {
            const keys = this.getStorageKeys(uid);
            localStorage.removeItem(keys.hash);
            localStorage.removeItem(keys.salt);
            localStorage.removeItem(keys.launchLock);
            sessionStorage.removeItem(keys.unlockedSession);

            this.currentPinHash = null;
            this.currentPinSalt = null;
            this.isPinSet.set(false);
            this.isLocked.set(false);
            this.loadPromiseMap.clear();

            try {
                const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
                await deleteDoc(secDocRef);
            } catch (fsErr) {
                console.warn('[PinSecurity] Firestore delete error:', fsErr);
            }

            this.snackbar.show('Security PIN has been removed.', 'info');
            return { success: true, message: 'Security PIN removed.' };
        } catch (err: any) {
            return { success: false, message: err.message || 'Failed to remove PIN.' };
        }
    }

    /**
     * Immediately lock the application
     */
    lock() {
        const uid = this.auth.currentUser?.uid;
        if (uid) {
            const keys = this.getStorageKeys(uid);
            sessionStorage.removeItem(keys.unlockedSession);
        }
        this.isLocked.set(true);
        this.snackbar.show('FinTracker locked.', 'info');
    }

    /**
     * Unlock the application with PIN
     */
    async unlock(pin: string): Promise<boolean> {
        const isValid = await this.verifyPin(pin);
        if (isValid) {
            const uid = this.auth.currentUser?.uid;
            if (uid) {
                const keys = this.getStorageKeys(uid);
                sessionStorage.setItem(keys.unlockedSession, 'true');
            }
            this.isLocked.set(false);
            this.snackbar.show('Access granted.', 'success');
            return true;
        }
        return false;
    }

    /**
     * Toggle require PIN on app launch
     */
    async setRequireLaunchLock(enabled: boolean) {
        this.requireLaunchLock.set(enabled);
        const uid = this.auth.currentUser?.uid;
        if (uid) {
            const keys = this.getStorageKeys(uid);
            localStorage.setItem(keys.launchLock, String(enabled));
            try {
                const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
                await setDoc(secDocRef, {
                    requireOnLaunch: enabled,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (e) {
                console.warn('Could not save launch lock to Firestore:', e);
            }
        }
        this.snackbar.show(enabled ? 'PIN required on every launch' : 'PIN launch requirement disabled', 'info');
    }
}
