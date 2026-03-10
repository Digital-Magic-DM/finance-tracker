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
            this.applyTheme(true);
        }
    }

    toggle() {
        const next = !this.isDark();
        this.isDark.set(next);
        this.applyTheme(next);
        localStorage.setItem('theme', next ? 'dark' : 'light');
    }

    private applyTheme(dark: boolean) {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
}
