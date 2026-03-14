import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    readonly isDark = signal(true);

    constructor() {
        const saved = localStorage.getItem('theme');
        if (saved) {
            const dark = saved === 'dark';
            this.isDark.set(dark);
            this.applyTheme(dark);
        } else {
            // Default to light for app and sync signal
            this.isDark.set(false);
            this.applyTheme(false);
        }
    }

    setTheme(dark: boolean) {
        this.isDark.set(dark);
        this.applyTheme(dark);
        localStorage.setItem('theme', dark ? 'dark' : 'light');
    }

    clearTheme() {
        localStorage.removeItem('theme');
        this.isDark.set(false); // Default to light when cleared or on landing
        this.applyTheme(false);
    }

    toggle() {
        const next = !this.isDark();
        this.setTheme(next);
    }

    private applyTheme(dark: boolean) {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
}
