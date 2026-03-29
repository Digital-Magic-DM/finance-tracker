import { Injectable, signal } from '@angular/core';

export type SnackbarType = 'success' | 'error' | 'info';

export interface SnackbarState {
    visible: boolean;
    message: string;
    type: SnackbarType;
    action?: { label: string; callback: () => void };
}

@Injectable({ providedIn: 'root' })
export class SnackbarService {
    state = signal<SnackbarState>({ visible: false, message: '', type: 'info' });

    private timeout: any;

    show(message: string, type: SnackbarType = 'info', duration = 4000, action?: { label: string; callback: () => void }) {
        clearTimeout(this.timeout);
        this.state.set({ visible: true, message, type, action });
        
        // If there's an action, we might want to keep it visible longer or until dismissed
        if (duration > 0) {
            this.timeout = setTimeout(() => this.dismiss(), duration);
        }
    }

    dismiss() {
        clearTimeout(this.timeout);
        this.state.set({ ...this.state(), visible: false });
    }
}
