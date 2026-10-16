import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import {
    Firestore,
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    deleteDoc,
    onSnapshot,
    writeBatch,
    Unsubscribe
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { SnackbarService } from './snackbar.service';

export interface DeviceSession {
    id: string;
    deviceName: string;
    browser: string;
    os: string;
    deviceType: 'desktop' | 'mobile' | 'tablet';
    screenResolution: string;
    ip: string;
    lastActive: string;
    createdAt: string;
    isCurrent: boolean;
    revoked?: boolean;
    isVerified?: boolean;
    verifiedAt?: string;
}

@Injectable({
    providedIn: 'root'
})
export class DeviceSessionService implements OnDestroy {
    private auth = inject(Auth);
    private firestore = inject(Firestore);
    private snackbar = inject(SnackbarService);
    private router = inject(Router);

    readonly sessions = signal<DeviceSession[]>([]);
    readonly currentSession = signal<DeviceSession | null>(null);
    readonly isLoading = signal<boolean>(false);

    // Unverified remote device sessions that require user verification
    readonly unverifiedSessions = computed(() => {
        return this.sessions().filter((s) => !s.isCurrent && !s.isVerified);
    });

    readonly unverifiedCount = computed(() => this.unverifiedSessions().length);

    // Dismissed session IDs from the small top banner (persists in notification bell dropdown)
    private dismissedBannerSessionIds = signal<Set<string>>(new Set());

    // Most recent unverified session for the small notification bar
    readonly pendingBannerSession = computed(() => {
        const dismissed = this.dismissedBannerSessionIds();
        return this.unverifiedSessions().find((s) => !dismissed.has(s.id)) || null;
    });

    // Compromised device session being remediated (triggers security credentials change modal)
    readonly compromisedDevice = signal<DeviceSession | null>(null);
    readonly isRemediationModalOpen = signal<boolean>(false);

    private currentSessionId: string = '';
    private authUnsubscribe?: () => void;
    private currentSessionUnsubscribe?: Unsubscribe;
    private sessionsListUnsubscribe?: Unsubscribe;
    private heartbeatTimer?: any;
    private isHandlingRevocation: boolean = false;

    constructor() {
        this.currentSessionId = this.getOrCreateSessionId();

        // Listen for authentication changes with stored cleanup reference
        this.authUnsubscribe = this.auth.onAuthStateChanged((user) => {
            if (user) {
                this.registerAndLoadSessions(user.uid);
                this.startHeartbeat(user.uid);
            } else {
                this.stopHeartbeat();
                this.cleanupListeners();
                this.sessions.set([]);
                this.currentSession.set(null);
            }
        });
    }

    ngOnDestroy(): void {
        this.stopHeartbeat();
        this.cleanupListeners();
        if (this.authUnsubscribe) {
            this.authUnsubscribe();
            this.authUnsubscribe = undefined;
        }
    }

    /**
     * Generates or retrieves a cryptographically strong unique session identifier
     */
    private getOrCreateSessionId(): string {
        const storageKey = 'fintracker_session_id';
        let id = localStorage.getItem(storageKey);

        if (!id || !id.startsWith('sess_')) {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                id = 'sess_' + crypto.randomUUID();
            } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                const buffer = new Uint8Array(16);
                crypto.getRandomValues(buffer);
                id = 'sess_' + Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
            } else {
                id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
            }
            try {
                localStorage.setItem(storageKey, id);
            } catch {
                // Ignore private browsing / restricted quota errors
            }
        }

        return id;
    }

    /**
     * Sanitizes and validates deviceType to guarantee it conforms to TypeScript domain union
     */
    private sanitizeDeviceType(type: any): 'desktop' | 'mobile' | 'tablet' {
        if (type === 'mobile' || type === 'tablet' || type === 'desktop') {
            return type;
        }
        return 'desktop';
    }

    /**
     * Resolves device, OS, and browser details using Client Hints API with standard UA fallback
     */
    parseDeviceInfo(): Omit<DeviceSession, 'id' | 'lastActive' | 'createdAt' | 'isCurrent'> {
        let os = 'Unknown OS';
        let browser = 'Web Browser';
        let deviceType: 'desktop' | 'mobile' | 'tablet' = 'desktop';

        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const uaData = typeof navigator !== 'undefined' ? (navigator as any).userAgentData : null;

        // 1. Try modern User-Agent Client Hints API first
        if (uaData) {
            if (uaData.platform) {
                os = uaData.platform;
            }
            if (uaData.mobile) {
                deviceType = 'mobile';
            }
            if (Array.isArray(uaData.brands) && uaData.brands.length > 0) {
                const meaningfulBrand = uaData.brands.find(
                    (b: any) =>
                        b.brand &&
                        !b.brand.toLowerCase().includes('not') &&
                        !b.brand.toLowerCase().includes('brand')
                );
                if (meaningfulBrand) {
                    browser = meaningfulBrand.brand;
                }
            }
        }

        // 2. Comprehensive OS and browser parsing fallback
        if (os === 'Unknown OS' || os === '') {
            if (/windows nt 10.0/i.test(ua)) os = 'Windows 11 / 10';
            else if (/windows nt 6.3/i.test(ua)) os = 'Windows 8.1';
            else if (/windows/i.test(ua)) os = 'Windows';
            else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
            else if (/iphone/i.test(ua)) {
                os = 'iOS';
                deviceType = 'mobile';
            } else if (/ipad/i.test(ua)) {
                os = 'iPadOS';
                deviceType = 'tablet';
            } else if (/android/i.test(ua)) {
                os = 'Android';
                deviceType = /mobile/i.test(ua) ? 'mobile' : 'tablet';
            } else if (/linux/i.test(ua)) {
                os = 'Linux';
            }
        }

        if (browser === 'Web Browser') {
            if (/edg\//i.test(ua)) browser = 'Microsoft Edge';
            else if (/chrome|crios/i.test(ua) && !/opr|opera/i.test(ua)) browser = 'Google Chrome';
            else if (/firefox|fxios/i.test(ua)) browser = 'Mozilla Firefox';
            else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Apple Safari';
            else if (/opr|opera/i.test(ua)) browser = 'Opera';
        }

        let deviceName = `${os} ${deviceType === 'desktop' ? 'PC' : deviceType === 'mobile' ? 'Mobile' : 'Tablet'}`;
        if (os === 'macOS') deviceName = 'Apple Mac';
        if (os === 'iOS') deviceName = 'iPhone';
        if (os === 'iPadOS') deviceName = 'iPad';

        const screenResolution =
            typeof window !== 'undefined' && window.screen
                ? `${window.screen.width} × ${window.screen.height}`
                : 'Standard Screen';

        return {
            deviceName,
            browser,
            os,
            deviceType: this.sanitizeDeviceType(deviceType),
            screenResolution,
            ip: 'Detecting network...'
        };
    }

    /**
     * Resolves public IP address with timeout and graceful fallback
     */
    private async resolveClientIp(): Promise<string> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            const res = await fetch('https://api.ipify.org?format=json', {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data?.ip && typeof data.ip === 'string') {
                    return data.ip;
                }
            }
        } catch {
            // Gracefully ignore timeout, network failure, or ad-blocker
        }
        return 'Client Network';
    }

    /**
     * Registers the current session in Firestore and attaches real-time revocation sentinels
     */
    async registerAndLoadSessions(uid: string) {
        this.isLoading.set(true);
        const baseInfo = this.parseDeviceInfo();
        const now = new Date().toISOString();

        // 1. Check existing Firestore session doc to preserve true createdAt and verification status
        const sessRef = doc(this.firestore, `users/${uid}/sessions/${this.currentSessionId}`);
        let createdAt = now;
        let isVerified = true;
        let verifiedAt: string | undefined = now;

        try {
            const existingSnap = await getDoc(sessRef);
            if (existingSnap.exists()) {
                const existingData = existingSnap.data();
                if (existingData?.['createdAt']) {
                    createdAt = existingData['createdAt'];
                }
                if (typeof existingData?.['isVerified'] === 'boolean') {
                    isVerified = existingData['isVerified'];
                    verifiedAt = existingData['verifiedAt'] || undefined;
                }
            } else {
                // Check if other active sessions already exist for this user in Firestore
                try {
                    const colRef = collection(this.firestore, `users/${uid}/sessions`);
                    const allSnap = await getDocs(colRef);
                    const activeOthers = allSnap.docs.filter(
                        (d) => d.id !== this.currentSessionId && d.data()['revoked'] !== true
                    );
                    // If there are other sessions active on other devices, a new device login starts unverified
                    if (activeOthers.length > 0) {
                        isVerified = false;
                        verifiedAt = undefined;
                    } else {
                        isVerified = true;
                        verifiedAt = now;
                    }
                } catch {
                    isVerified = true;
                    verifiedAt = now;
                }
            }
        } catch (e) {
            console.warn('[DeviceSession] Could not read existing session doc:', e);
        }

        const current: DeviceSession = {
            id: this.currentSessionId,
            ...baseInfo,
            lastActive: now,
            createdAt,
            isCurrent: true,
            isVerified,
            verifiedAt
        };

        this.currentSession.set(current);

        // 2. Resolve client IP asynchronously without blocking UI render
        this.resolveClientIp().then(async (resolvedIp) => {
            current.ip = resolvedIp;
            this.currentSession.set({ ...current });

            try {
                await setDoc(sessRef, { ip: resolvedIp }, { merge: true });
            } catch {
                // Non-critical background sync
            }
        });

        try {
            // 3. Register / update current session in Firestore
            await setDoc(
                sessRef,
                {
                    deviceName: current.deviceName,
                    browser: current.browser,
                    os: current.os,
                    deviceType: current.deviceType,
                    screenResolution: current.screenResolution,
                    ip: current.ip,
                    lastActive: now,
                    createdAt: current.createdAt,
                    revoked: false,
                    isVerified,
                    verifiedAt: verifiedAt || null
                },
                { merge: true }
            );

            // 4. Attach real-time Revocation Sentinel
            this.attachRevocationListener(uid);

            // 5. Attach real-time listener for all active sessions
            this.attachSessionsListListener(uid);
        } catch (err) {
            console.warn('[DeviceSession] Firestore session sync notice:', err);
            this.sessions.set([current]);
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Attaches an onSnapshot listener to the current device's session doc.
     * When another device calls revokeSession(), this device detects the revocation,
     * signs out immediately, and redirects to the login screen.
     */
    private attachRevocationListener(uid: string) {
        if (this.currentSessionUnsubscribe) {
            this.currentSessionUnsubscribe();
            this.currentSessionUnsubscribe = undefined;
        }

        const sessRef = doc(this.firestore, `users/${uid}/sessions/${this.currentSessionId}`);

        this.currentSessionUnsubscribe = onSnapshot(
            sessRef,
            (snap) => {
                // Document deleted or marked revoked: true
                if (!snap.exists() || snap.data()?.['revoked'] === true) {
                    console.warn('[DeviceSession] Current session was revoked from another device.');
                    this.handleSessionRevokedLocally();
                }
            },
            (error) => {
                console.warn('[DeviceSession] Revocation listener error:', error);
            }
        );
    }

    /**
     * Handles local sign-out and state purge when session revocation is triggered remotely
     */
    private async handleSessionRevokedLocally(): Promise<void> {
        if (this.isHandlingRevocation) return;
        this.isHandlingRevocation = true;

        this.stopHeartbeat();
        this.cleanupListeners();

        try {
            localStorage.removeItem('fintracker_session_id');
            localStorage.removeItem('fintracker_session_created');
        } catch {
            // Ignore
        }

        this.sessions.set([]);
        this.currentSession.set(null);

        try {
            await signOut(this.auth);
        } catch (err) {
            console.warn('[DeviceSession] Sign-out on revocation error:', err);
        }

        this.snackbar.show(
            'Your session was terminated from another device. Please sign in again.',
            'info'
        );

        this.router.navigate(['/']);
        this.isHandlingRevocation = false;
    }

    /**
     * Attaches a real-time listener to the sessions collection so the UI updates automatically
     */
    private attachSessionsListListener(uid: string) {
        if (this.sessionsListUnsubscribe) {
            this.sessionsListUnsubscribe();
            this.sessionsListUnsubscribe = undefined;
        }

        const colRef = collection(this.firestore, `users/${uid}/sessions`);

        this.sessionsListUnsubscribe = onSnapshot(
            colRef,
            (snap) => {
                const list: DeviceSession[] = [];

                snap.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (data['revoked'] === true) return;

                    const isCurrent = docSnap.id === this.currentSessionId;
                    const isVerified = typeof data['isVerified'] === 'boolean'
                        ? data['isVerified']
                        : (isCurrent || snap.size <= 1);

                    list.push({
                        id: docSnap.id,
                        deviceName: data['deviceName'] || 'Unknown Device',
                        browser: data['browser'] || 'Unknown Browser',
                        os: data['os'] || 'Unknown OS',
                        deviceType: this.sanitizeDeviceType(data['deviceType']),
                        screenResolution: data['screenResolution'] || '',
                        ip: data['ip'] || 'Client Network',
                        lastActive: data['lastActive'] || new Date().toISOString(),
                        createdAt: data['createdAt'] || new Date().toISOString(),
                        isCurrent,
                        isVerified,
                        verifiedAt: data['verifiedAt'] || undefined
                    });
                });

                // Sort: current session first, then descending by lastActive
                list.sort((a, b) => {
                    if (a.isCurrent) return -1;
                    if (b.isCurrent) return 1;
                    return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
                });

                if (list.length === 0 && this.currentSession()) {
                    list.push(this.currentSession()!);
                }

                this.sessions.set(list);
            },
            (error) => {
                console.warn('[DeviceSession] Sessions list subscription notice:', error);
                if (this.currentSession()) {
                    this.sessions.set([this.currentSession()!]);
                }
            }
        );
    }

    /**
     * Manual refresh fallback if needed
     */
    async refreshSessions(uid?: string) {
        const userId = uid || this.auth.currentUser?.uid;
        if (!userId) return;

        try {
            const colRef = collection(this.firestore, `users/${userId}/sessions`);
            const snap = await getDocs(colRef);
            const list: DeviceSession[] = [];

            snap.forEach((docSnap) => {
                const data = docSnap.data();
                if (data['revoked'] === true) return;

                const isCurrent = docSnap.id === this.currentSessionId;
                const isVerified = typeof data['isVerified'] === 'boolean'
                    ? data['isVerified']
                    : (isCurrent || snap.size <= 1);

                list.push({
                    id: docSnap.id,
                    deviceName: data['deviceName'] || 'Unknown Device',
                    browser: data['browser'] || 'Unknown Browser',
                    os: data['os'] || 'Unknown OS',
                    deviceType: this.sanitizeDeviceType(data['deviceType']),
                    screenResolution: data['screenResolution'] || '',
                    ip: data['ip'] || 'Client Network',
                    lastActive: data['lastActive'] || new Date().toISOString(),
                    createdAt: data['createdAt'] || new Date().toISOString(),
                    isCurrent,
                    isVerified,
                    verifiedAt: data['verifiedAt'] || undefined
                });
            });

            list.sort((a, b) => {
                if (a.isCurrent) return -1;
                if (b.isCurrent) return 1;
                return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
            });

            if (list.length === 0 && this.currentSession()) {
                list.push(this.currentSession()!);
            }

            this.sessions.set(list);
        } catch (err) {
            console.warn('[DeviceSession] Refresh sessions error:', err);
        }
    }

    /**
     * Verifies and marks a device session as trusted by the user.
     */
    async verifySession(sessionId: string): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;

        try {
            const ref = doc(this.firestore, `users/${uid}/sessions/${sessionId}`);
            const verifiedAt = new Date().toISOString();
            await setDoc(ref, { isVerified: true, verifiedAt }, { merge: true });

            this.sessions.update((prev) =>
                prev.map((s) => (s.id === sessionId ? { ...s, isVerified: true, verifiedAt } : s))
            );
            this.snackbar.show('Device verified and trusted successfully.', 'success');
        } catch (err: any) {
            this.snackbar.show('Failed to verify device: ' + err.message, 'error');
        }
    }

    /**
     * Temporarily dismisses the small top notification bar for a specific session
     */
    dismissBanner(sessionId: string): void {
        this.dismissedBannerSessionIds.update((set) => {
            const next = new Set(set);
            next.add(sessionId);
            return next;
        });
    }

    /**
     * Marks an unrecognized/compromised device session as an issue:
     * 1. Terminates session immediately
     * 2. Opens the Security Remediation Dialog to update credentials/PIN
     */
    async markSessionCompromised(session: DeviceSession): Promise<void> {
        await this.revokeSession(session.id);
        this.compromisedDevice.set(session);
        this.isRemediationModalOpen.set(true);
    }

    closeRemediationModal(): void {
        this.isRemediationModalOpen.set(false);
        this.compromisedDevice.set(null);
    }

    /**
     * Revokes a specific remote device session.
     * Prevents self-revocation and triggers real-time termination on the target device.
     */
    async revokeSession(sessionId: string): Promise<void> {
        if (sessionId === this.currentSessionId) {
            this.snackbar.show('Use the "Sign Out This Device" button to end your current session.', 'info');
            return;
        }

        const uid = this.auth.currentUser?.uid;
        if (!uid) return;

        try {
            const ref = doc(this.firestore, `users/${uid}/sessions/${sessionId}`);
            // Mark revoked first to ensure real-time listener on target fires before deletion
            await setDoc(ref, { revoked: true, revokedAt: new Date().toISOString() }, { merge: true });
            await deleteDoc(ref);

            this.sessions.update((prev) => prev.filter((s) => s.id !== sessionId));
            this.snackbar.show('Session revoked successfully. The device has been logged out.', 'success');
        } catch (err: any) {
            this.snackbar.show('Failed to revoke session: ' + err.message, 'error');
        }
    }

    /**
     * Atomically revokes all sessions other than the current active session using Firestore writeBatch.
     */
    async revokeAllOtherSessions(): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;

        try {
            const otherSessions = this.sessions().filter((s) => !s.isCurrent);
            if (otherSessions.length === 0) {
                this.snackbar.show('No other active sessions found.', 'info');
                return;
            }

            const batch = writeBatch(this.firestore);

            for (const s of otherSessions) {
                const ref = doc(this.firestore, `users/${uid}/sessions/${s.id}`);
                batch.delete(ref);
            }

            await batch.commit();

            this.sessions.update((prev) => prev.filter((s) => s.isCurrent));
            this.snackbar.show('Signed out from all other devices.', 'success');
        } catch (err: any) {
            this.snackbar.show('Failed to revoke other sessions: ' + err.message, 'error');
        }
    }

    /**
     * Removes the current session upon voluntary logout
     */
    async removeCurrentSession(): Promise<void> {
        this.stopHeartbeat();
        this.cleanupListeners();

        const uid = this.auth.currentUser?.uid;
        const sid = this.currentSessionId;

        if (uid && sid) {
            try {
                const sessRef = doc(this.firestore, `users/${uid}/sessions/${sid}`);
                await deleteDoc(sessRef);
            } catch (err) {
                console.warn('[DeviceSession] Could not remove session on voluntary logout:', err);
            }
        }

        try {
            localStorage.removeItem('fintracker_session_id');
            localStorage.removeItem('fintracker_session_created');
        } catch {
            // Ignore
        }

        this.currentSessionId = '';
        this.sessions.set([]);
        this.currentSession.set(null);
    }

    /**
     * Periodically updates lastActive timestamp in Firestore while the user is active
     */
    private startHeartbeat(uid: string) {
        this.stopHeartbeat();
        // Update lastActive every 5 minutes
        this.heartbeatTimer = setInterval(async () => {
            if (!this.currentSessionId || !this.auth.currentUser) return;
            try {
                const sessRef = doc(this.firestore, `users/${uid}/sessions/${this.currentSessionId}`);
                await setDoc(sessRef, { lastActive: new Date().toISOString() }, { merge: true });
            } catch {
                // Ignore silent background update
            }
        }, 5 * 60 * 1000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private cleanupListeners() {
        if (this.currentSessionUnsubscribe) {
            this.currentSessionUnsubscribe();
            this.currentSessionUnsubscribe = undefined;
        }
        if (this.sessionsListUnsubscribe) {
            this.sessionsListUnsubscribe();
            this.sessionsListUnsubscribe = undefined;
        }
    }
}
