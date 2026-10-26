import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SplashScreenService {
  /** Whether the splash screen overlay is currently in the DOM */
  readonly isVisible = signal<boolean>(true);

  /** Whether the Netflix/YouTube-style exit animation is playing */
  readonly isExiting = signal<boolean>(false);

  private timer: any = null;
  private exitTimer: any = null;

  constructor() {
    this.startSequence(1250);
  }

  /**
   * Run the clean, cinematic animation sequence and exit smoothly.
   */
  startSequence(durationMs: number = 1250): void {
    this.clearTimers();
    this.isVisible.set(true);
    this.isExiting.set(false);

    // Auto-transition to exit animation after durationMs
    this.timer = setTimeout(() => {
      this.dismiss();
    }, durationMs);
  }

  /**
   * Cinematic exit zoom & fade out (Netlify / Netflix Style: Small to Big Expansion)
   */
  dismiss(): void {
    if (this.isExiting() || !this.isVisible()) return;
    this.isExiting.set(true);

    // Clean up index.html preboot if still present
    if (typeof document !== 'undefined') {
      const preboot = document.getElementById('app-splash-preboot');
      if (preboot) {
        preboot.remove();
      }
    }

    // Wait for the exit animation (560ms) to complete before removing from DOM
    this.exitTimer = setTimeout(() => {
      this.isVisible.set(false);
      this.isExiting.set(false);
      this.clearTimers();
    }, 580);
  }

  /**
   * Manually replay the splash animation (e.g. from Settings preview)
   */
  replay(): void {
    this.startSequence(2200);
  }

  private clearTimers(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }
}
