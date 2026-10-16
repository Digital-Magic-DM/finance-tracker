import { Injectable, signal } from '@angular/core';
import { Chart } from 'chart.js';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    readonly isDark = signal(true);

    constructor() {
        const saved = localStorage.getItem('theme');
        if (saved) {
            const dark = saved === 'dark';
            this.isDark.set(dark);
            this.applyTheme(dark, false);
        } else {
            // Default to light for app and sync signal
            this.isDark.set(false);
            this.applyTheme(false, false);
        }
    }

    setTheme(dark: boolean, event?: MouseEvent) {
        this.isDark.set(dark);
        this.applyTheme(dark, true, event);
        localStorage.setItem('theme', dark ? 'dark' : 'light');
    }

    clearTheme() {
        localStorage.removeItem('theme');
        this.isDark.set(false); // Default to light when cleared or on landing
        this.applyTheme(false, true);
    }

    toggle(event?: MouseEvent) {
        const next = !this.isDark();
        this.setTheme(next, event);
    }

    private applyTheme(dark: boolean, animate = false, event?: MouseEvent) {
        const updateDom = () => {
            document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            if (typeof Chart !== 'undefined' && Chart.defaults) {
                Chart.defaults.color = dark ? '#cbd5e1' : '#475569';
                Chart.defaults.borderColor = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
            }
        };

        if (
            animate &&
            typeof document !== 'undefined' &&
            'startViewTransition' in document &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
            // Find ripple origin from mouse event or active button element
            let x = event?.clientX;
            let y = event?.clientY;

            if (x === undefined || y === undefined || (x === 0 && y === 0)) {
                const target = (document.activeElement as HTMLElement) ??
                    document.querySelector('#theme-toggle, .theme-toggle-btn, .btn-theme-toggle, .theme-btn, .toggle-btn');
                if (target && target.getBoundingClientRect) {
                    const rect = target.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        x = rect.left + rect.width / 2;
                        y = rect.top + rect.height / 2;
                    }
                }
            }

            if (x === undefined || y === undefined) {
                x = window.innerWidth / 2;
                y = 40;
            }

            const endRadius = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y)
            );

            // Temporarily suppress internal CSS transitions so the captured DOM snapshots are crisp and instantaneous
            document.documentElement.classList.add('theme-transitioning');

            try {
                const transition = (document as any).startViewTransition(() => {
                    updateDom();
                });

                transition.ready.then(() => {
                    const clipPath = [
                        `circle(0px at ${x}px ${y}px)`,
                        `circle(${endRadius}px at ${x}px ${y}px)`
                    ];

                    document.documentElement.animate(
                        {
                            clipPath: clipPath
                        },
                        {
                            duration: 380,
                            easing: 'cubic-bezier(0.2, 0, 0, 1)',
                            pseudoElement: '::view-transition-new(root)'
                        }
                    );
                }).catch(() => {
                    // Fallback handled by browser
                });

                transition.finished.finally(() => {
                    document.documentElement.classList.remove('theme-transitioning');
                });
            } catch (err) {
                document.documentElement.classList.remove('theme-transitioning');
                updateDom();
            }
        } else if (animate && typeof document !== 'undefined') {
            // Synchronized CSS fallback for environments without View Transitions API
            document.documentElement.classList.add('theme-fade-transition');
            updateDom();
            setTimeout(() => {
                document.documentElement.classList.remove('theme-fade-transition');
            }, 360);
        } else {
            updateDom();
        }
    }
}
