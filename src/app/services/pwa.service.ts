import { Injectable, signal, inject, ApplicationRef } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs/operators';
import { interval, concat } from 'rxjs';
import { ThemeService } from './theme.service';
import { SnackbarService } from './snackbar.service';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  deferredPrompt: any = null;
  canInstall = signal(false);
  updateAvailable = signal(false);
  isIOS = signal(false);
  isStandalone = signal(false);
  appName = signal('FinTracker');

  private swUpdate = inject(SwUpdate);
  private appRef = inject(ApplicationRef);
  private snackbar = inject(SnackbarService);
  public themeService = inject(ThemeService);

  constructor() {
    this.detectEnvironment();

    // Check if the event was already captured by index.html script
    if ((window as any).deferredPrompt) {
      this.deferredPrompt = (window as any).deferredPrompt;
      this.updateCanInstall();
    }

    window.addEventListener('beforeinstallprompt', (e: any) => {
      this.deferredPrompt = e;
      (window as any).deferredPrompt = e;
      this.updateCanInstall();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isStandalone.set(true);
    });

    this.initUpdateLogic();
  }

  private initUpdateLogic() {
    if (!this.swUpdate.isEnabled) return;

    // 1. Listen for ready updates
    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        this.updateAvailable.set(true);
        this.showUpdateNotification();
      });

    // 2. Periodically check for updates (every 15 mins)
    // Wait for the app to stabilize first to avoid slowing down initial load
    const appIsStable$ = this.appRef.isStable.pipe(first(isStable => isStable === true));
    const every15Mins$ = interval(15 * 60 * 1000);
    const updateCheck$ = concat(appIsStable$, every15Mins$);

    updateCheck$.subscribe(async () => {
      try {
        console.log('PwaService: Checking for updates in background...');
        await this.swUpdate.checkForUpdate();
      } catch (err) {
        console.error('Update check failed', err);
      }
    });
  }

  private showUpdateNotification() {
    this.snackbar.show(
      'New version of FinTracker is ready!',
      'info',
      0, // Don't auto-dismiss for updates
      {
        label: 'Reload Now',
        callback: () => this.updateApp()
      }
    );
  }

  private detectEnvironment() {
    const nav = window.navigator as any;
    const isIOS = /iPad|iPhone|iPod/.test(nav.userAgent) && !nav.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone;
    
    this.isIOS.set(isIOS);
    this.isStandalone.set(!!isStandalone);
    this.updateCanInstall();
  }

  private updateCanInstall() {
    // Show if we have a prompt OR if it's iOS (we show instructions)
    // BUT only if NOT already installed
    if (this.isStandalone()) {
      this.canInstall.set(false);
      return;
    }

    if (this.deferredPrompt || this.isIOS()) {
      this.canInstall.set(true);
    }
  }

  async installApp() {
    console.log('PwaService: installApp called');
    if (this.isIOS()) {
      console.log('PwaService: iOS user, showing alert');
      alert('To install: Tap the Share button in Safari and select "Add to Home Screen"');
      return;
    }

    if (!this.deferredPrompt) {
      console.warn('PwaService: Install requested but no prompt available');
      return;
    }

    console.log('PwaService: Triggering native prompt');
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log(`PwaService: User response to the install prompt: ${outcome}`);
    this.deferredPrompt = null;
    this.canInstall.set(false);
  }

  async updateApp() {
    console.log('PwaService: updateApp called');
    if (this.swUpdate.isEnabled) {
      await this.swUpdate.activateUpdate();
      window.location.reload();
    } else {
      window.location.reload();
    }
  }
}
