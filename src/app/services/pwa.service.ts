import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  deferredPrompt: any = null;
  canInstall = signal(false);

  constructor() {
    // For development/styling purposes, we can show the button if in dev mode
    // or if the actual prompt is available
    if ((window as any).location.hostname === 'localhost' || (window as any).location.hostname === '127.0.0.1') {
      console.log('Dev mode: PWA install button will be visible for styling');
      this.canInstall.set(true); 
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      this.deferredPrompt = e;
      // Update UI notify the user they can install the PWA
      this.canInstall.set(true);
      console.log('beforeinstallprompt event fired');
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
