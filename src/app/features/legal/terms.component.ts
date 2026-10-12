import { Component, inject, OnInit, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { PwaService } from '../../services/pwa.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './terms.component.html',
  styleUrl: './legal.scss',
})
export class TermsComponent implements OnInit {
  public pwaService = inject(PwaService);
  public themeService = inject(ThemeService);
  private titleService = inject(Title);
  private meta = inject(Meta);
  private el = inject(ElementRef);

  constructor() {
    this.titleService.setTitle('Terms of Service | ' + this.pwaService.appName());
    this.meta.updateTag({ name: 'description', content: 'Terms of Service and legal agreements for FinTracker.' });
  }

  ngOnInit() {
    if (this.el?.nativeElement) {
      this.el.nativeElement.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }
}
