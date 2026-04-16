import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GoogleAnalyticsService {
  private router = inject(Router);

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const navEnd = event as NavigationEnd;
        this.sendPageView(navEnd.urlAfterRedirects);
      });
  }

  private sendPageView(url: string) {
    const gtag = (window as any).gtag;
    if (typeof gtag !== 'function') {
      return;
    }

    gtag('event', 'page_view', {
      page_path: url,
      page_title: document.title,
      send_to: environment.firebase.measurementId,
    });
  }
}
