import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  deferredPrompt: any = null;
  canInstall = signal(false);
  isIOS = signal(false);
  isStandalone = signal(false);

  constructor() {
    this.detectEnvironment();

    // Check if the event was already captured by index.html script
    if ((window as any).deferredPrompt) {
      this.deferredPrompt = (window as any).deferredPrompt;
      this.updateCanInstall();
      console.log('PwaService: Captured early install prompt');
    }

    window.addEventListener('beforeinstallprompt', (e: any) => {
      // e.preventDefault(); // Commented to allow native browser prompt
      this.deferredPrompt = e;
      (window as any).deferredPrompt = e;
      this.updateCanInstall();
      console.log('PwaService: beforeinstallprompt received');
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isStandalone.set(true);
      console.log('PWA was installed');
    });
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
}
