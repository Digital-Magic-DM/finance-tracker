import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { PwaService } from '../../services/pwa.service';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './privacy.component.html',
  styleUrl: './legal.scss',
})
export class PrivacyComponent {
  public pwaService = inject(PwaService);
  private titleService = inject(Title);
  private meta = inject(Meta);

  constructor() {
    this.titleService.setTitle('Privacy Policy | ' + this.pwaService.appName());
    this.meta.updateTag({ name: 'description', content: 'Privacy Policy and data protection standards for FinTracker.' });
  }
}
