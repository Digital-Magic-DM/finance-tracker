import { Injectable, signal } from '@angular/core';

export type SnackbarType = 'success' | 'error' | 'info';

export interface SnackbarState {
    visible: boolean;
    message: string;
    type: SnackbarType;
}

@Injectable({ providedIn: 'root' })
export class SnackbarService {
    state = signal<SnackbarState>({ visible: false, message: '', type: 'info' });

    private timeout: any;

    show(message: string, type: SnackbarType = 'info', duration = 4000) {
        clearTimeout(this.timeout);
        this.state.set({ visible: true, message, type });
        this.timeout = setTimeout(() => this.dismiss(), duration);
    }

    dismiss() {
        clearTimeout(this.timeout);
        this.state.set({ ...this.state(), visible: false });
    }
}
