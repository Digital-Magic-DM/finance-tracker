import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { ToolbarComponent } from './toolbar/toolbar.component';

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [RouterOutlet, SidebarComponent, ToolbarComponent],
    templateUrl: './layout.component.html',
    styleUrl: './layout.component.scss',
})
export class LayoutComponent {
    sidebarOpen = signal(false);

    toggleSidebar() {
        this.sidebarOpen.update((v) => !v);
    }

    closeSidebar() {
        this.sidebarOpen.set(false);
    }
}
