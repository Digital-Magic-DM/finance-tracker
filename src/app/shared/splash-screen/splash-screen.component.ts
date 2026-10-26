import { Component, inject, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SplashScreenService } from '../../services/splash-screen.service';

@Component({
  selector: 'app-splash-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './splash-screen.component.html',
  styleUrls: ['./splash-screen.component.scss'],
})
export class SplashScreenComponent implements OnInit {
  public splashService = inject(SplashScreenService);

  ngOnInit(): void {
    // Seamlessly hand over from index.html preboot without duplicate overlay or stutter
    if (typeof document !== 'undefined') {
      const preboot = document.getElementById('app-splash-preboot');
      if (preboot) {
        preboot.remove();
      }
    }
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.splashService.isVisible()) {
      this.splashService.dismiss();
    }
  }
}
