import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { PwaService } from './services/pwa.service';
import { Title } from '@angular/platform-browser';
import { SnackbarComponent } from './shared/snackbar/snackbar.component';
import { SplashScreenComponent } from './shared/splash-screen/splash-screen.component';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { effect } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SnackbarComponent, SplashScreenComponent],
  template: `<router-outlet /><app-snackbar /><app-splash-screen />`,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        width: 100%;
      }
      :host:has(app-layout) {
        height: 100dvh;
        overflow: hidden;
      }
    `,
  ],
})
export class App {
  constructor(theme: ThemeService, pwa: PwaService, title: Title, analytics: GoogleAnalyticsService) {
    // Initialize theme on startup
    void theme;
    void analytics;
    effect(() => {
      const name = pwa.appName();
      title.setTitle(`${name} | Precision Finance Dashboard`);
    });
  }
}
