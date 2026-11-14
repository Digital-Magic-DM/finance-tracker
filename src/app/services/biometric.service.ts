import { Injectable, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, setDoc, getDoc } from '@angular/fire/firestore';
import { SnackbarService } from './snackbar.service';

function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

@Injectable({
    providedIn: 'root'
})
export class BiometricService {
    private auth = inject(Auth);
    private firestore = inject(Firestore);
    private snackbar = inject(SnackbarService);

    readonly isSupported = signal<boolean>(false);
    readonly isAvailable = signal<boolean>(false);
    readonly isEnabled = signal<boolean>(false);
    readonly isPrompting = signal<boolean>(false);

    constructor() {
        this.checkAvailability();
        this.auth.onAuthStateChanged((user) => {
            if (user) {
                this.loadBiometricState(user.uid);
            } else {
                this.isEnabled.set(false);
            }
        });
    }

    /**
     * Check if device has hardware platform biometric authenticator (Fingerprint, TouchID, FaceID)
     */
    async checkAvailability(): Promise<boolean> {
        if (typeof window === 'undefined') return false;

        const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isSecure) {
            this.isSupported.set(false);
            this.isAvailable.set(false);
            return false;
        }

        const hasWebAuthn = !!window.PublicKeyCredential &&
            typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

        this.isSupported.set(hasWebAuthn);

        if (!hasWebAuthn) {
            this.isAvailable.set(false);
            return false;
        }

        try {
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            this.isAvailable.set(available);
            return available;
        } catch (e) {
            console.warn('[BiometricService] Platform authenticator check error:', e);
            this.isAvailable.set(false);
            return false;
        }
    }

    /**
     * Load user biometric preference from localStorage and Firestore
     */
    async loadBiometricState(uid: string) {
        const localEnabled = localStorage.getItem(`fintracker_biometric_enabled_${uid}`) === 'true';
        this.isEnabled.set(localEnabled);

        // Also check if remote Firestore has preference
        try {
            const secDocRef = doc(this.firestore, `users/${uid}/settings/security`);
            const snap = await getDoc(secDocRef);
            if (snap.exists()) {
                const data = snap.data();
                if (typeof data['biometricEnabled'] === 'boolean') {
                    // If local credential ID exists, sync preference
                    const hasLocalCred = !!localStorage.getItem(`fintracker_biometric_cred_${uid}`);
                    if (data['biometricEnabled'] && hasLocalCred) {
                        this.isEnabled.set(true);
                        localStorage.setItem(`fintracker_biometric_enabled_${uid}`, 'true');
                    } else if (!data['biometricEnabled']) {
                        this.isEnabled.set(false);
                        localStorage.setItem(`fintracker_biometric_enabled_${uid}`, 'false');
                    }
                }
            }
        } catch {
            // Offline fallback is fine
        }
    }

    /**
     * Register device fingerprint/biometrics
     */
    async enableBiometrics(): Promise<{ success: boolean; message: string }> {
        const user = this.auth.currentUser;
        if (!user) return { success: false, message: 'Please sign in first.' };

        const available = await this.checkAvailability();
        if (!available) {
            return {
                success: false,
                message: 'Fingerprint or biometric sensor is not available or supported on this device/browser.'
            };
        }

        this.isPrompting.set(true);
        try {
            const challenge = new Uint8Array(32);
            crypto.getRandomValues(challenge);

            const userId = new TextEncoder().encode(user.uid);

            const publicKeyOptions: PublicKeyCredentialCreationOptions = {
                challenge,
                rp: {
                    name: 'FinTracker Personal Finance',
                    id: window.location.hostname
                },
                user: {
                    id: userId,
                    name: user.email || user.uid,
                    displayName: user.displayName || 'FinTracker User'
                },
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' },   // ES256
                    { alg: -257, type: 'public-key' }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'preferred'
                },
                timeout: 60000,
                attestation: 'none'
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyOptions
            }) as PublicKeyCredential;

            if (!credential) {
                return { success: false, message: 'Biometric registration was not completed.' };
            }

            const credIdBase64 = bufferToBase64(credential.rawId);
            localStorage.setItem(`fintracker_biometric_cred_${user.uid}`, credIdBase64);
            localStorage.setItem(`fintracker_biometric_enabled_${user.uid}`, 'true');
            this.isEnabled.set(true);

            // Sync with Firestore
            try {
                const secDocRef = doc(this.firestore, `users/${user.uid}/settings/security`);
                await setDoc(secDocRef, {
                    biometricEnabled: true,
                    biometricUpdatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (e) {
                console.warn('[BiometricService] Could not sync biometric setting to Firestore:', e);
            }

            this.snackbar.show('Fingerprint & Biometric Unlock enabled!', 'success');
            return { success: true, message: 'Fingerprint unlock successfully enabled.' };
        } catch (err: any) {
            console.warn('[BiometricService] Enrollment error:', err);
            if (err.name === 'NotAllowedError') {
                return { success: false, message: 'Biometric prompt was cancelled or timed out.' };
            }
            return { success: false, message: err.message || 'Failed to setup fingerprint unlock.' };
        } finally {
            this.isPrompting.set(false);
        }
    }

    /**
     * Disable device fingerprint unlock
     */
    async disableBiometrics(): Promise<void> {
        const user = this.auth.currentUser;
        if (user) {
            localStorage.setItem(`fintracker_biometric_enabled_${user.uid}`, 'false');
            try {
                const secDocRef = doc(this.firestore, `users/${user.uid}/settings/security`);
                await setDoc(secDocRef, {
                    biometricEnabled: false,
                    biometricUpdatedAt: new Date().toISOString()
                }, { merge: true });
            } catch (e) {
                console.warn('[BiometricService] Firestore sync error:', e);
            }
        }
        this.isEnabled.set(false);
        this.snackbar.show('Fingerprint unlock has been disabled.', 'info');
    }

    /**
     * Authenticate user with their fingerprint / platform biometrics
     */
    async authenticate(): Promise<{ success: boolean; message?: string; cancelled?: boolean }> {
        const user = this.auth.currentUser;
        if (!user) return { success: false, message: 'Not authenticated.' };

        if (!this.isEnabled()) {
            return { success: false, message: 'Fingerprint unlock is not enabled.' };
        }

        const credIdBase64 = localStorage.getItem(`fintracker_biometric_cred_${user.uid}`);
        this.isPrompting.set(true);

        try {
            const challenge = new Uint8Array(32);
            crypto.getRandomValues(challenge);

            const getOptions: PublicKeyCredentialRequestOptions = {
                challenge,
                timeout: 60000,
                userVerification: 'required'
            };

            if (credIdBase64) {
                getOptions.allowCredentials = [
                    {
                        id: base64ToBuffer(credIdBase64),
                        type: 'public-key',
                        transports: ['internal']
                    }
                ];
            }

            const assertion = await navigator.credentials.get({
                publicKey: getOptions
            });

            if (assertion) {
                return { success: true };
            }
            return { success: false, message: 'Biometric verification failed.' };
        } catch (err: any) {
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                return { success: false, cancelled: true, message: 'Fingerprint scan was cancelled.' };
            }
            console.warn('[BiometricService] Authentication error:', err);
            return { success: false, message: err.message || 'Biometric authentication failed.' };
        } finally {
            this.isPrompting.set(false);
        }
    }
}
