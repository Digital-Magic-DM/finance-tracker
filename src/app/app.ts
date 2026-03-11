import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { SnackbarComponent } from './shared/snackbar/snackbar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SnackbarComponent],
  template: `<router-outlet /><app-snackbar />`,
  styles: [`:host { display: block; height: 100dvh; }`],
})
export class App {
  constructor(theme: ThemeService) {
    // Initialize theme on startup (constructor call triggers the service)
  }
}
