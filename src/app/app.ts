import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: [`:host { display: block; height: 100dvh; }`],
})
export class App {
  constructor(theme: ThemeService) {
    // Initialize theme on startup (constructor call triggers the service)
  }
}
