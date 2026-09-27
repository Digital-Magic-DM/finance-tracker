import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { PwaService } from '../../services/pwa.service';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './terms.component.html',
  styleUrl: './legal.scss',
})
export class TermsComponent {
  public pwaService = inject(PwaService);
  private titleService = inject(Title);
  private meta = inject(Meta);

  constructor() {
    this.titleService.setTitle('Terms of Service | ' + this.pwaService.appName());
    this.meta.updateTag({ name: 'description', content: 'Terms of Service and legal agreements for FinTracker.' });
  }
}
