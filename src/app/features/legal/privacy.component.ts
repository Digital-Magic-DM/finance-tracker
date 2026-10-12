import { Component, inject, OnInit, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { PwaService } from '../../services/pwa.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './privacy.component.html',
  styleUrl: './legal.scss',
})
export class PrivacyComponent implements OnInit {
  public pwaService = inject(PwaService);
  public themeService = inject(ThemeService);
  private titleService = inject(Title);
  private meta = inject(Meta);
  private el = inject(ElementRef);

  constructor() {
    this.titleService.setTitle('Privacy Policy | ' + this.pwaService.appName());
    this.meta.updateTag({ name: 'description', content: 'Privacy Policy and data protection standards for FinTracker.' });
  }

  ngOnInit() {
    if (this.el?.nativeElement) {
      this.el.nativeElement.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }
}
