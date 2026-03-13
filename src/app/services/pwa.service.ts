import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  deferredPrompt: any = null;
  canInstall = signal(false);

  constructor() {
    // Check if the event was already captured by index.html script
    if ((window as any).deferredPrompt) {
      this.deferredPrompt = (window as any).deferredPrompt;
      this.canInstall.set(true);
      console.log('PwaService: Captured early install prompt');
    }

    window.addEventListener('beforeinstallprompt', (e: any) => {
      // Prevent original mini-infobar
      e.preventDefault();
      // Store event
      this.deferredPrompt = e;
      (window as any).deferredPrompt = e; // Keep global in sync
      this.canInstall.set(true);
      console.log('PwaService: beforeinstallprompt received');
    });

    window.addEventListener('appinstalled', () => {
      // Clear the deferredPrompt so it can be garbage collected
      this.deferredPrompt = null;
      this.canInstall.set(false);
      console.log('PWA was installed');
    });
  }

  async installApp() {
    if (!this.deferredPrompt) {
      return;
    }
    // Show the install prompt
    this.deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    this.deferredPrompt = null;
    this.canInstall.set(false);
  }
}
