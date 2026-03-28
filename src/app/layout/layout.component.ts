import { Component, signal, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
// import { MarketService } from '../services/market.service';
import { Meta } from '@angular/platform-browser';

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [RouterOutlet, SidebarComponent, ToolbarComponent],
    templateUrl: './layout.component.html',
    styleUrl: './layout.component.scss',
})
export class LayoutComponent implements OnInit {
    private meta = inject(Meta);
    // constructor() { inject(MarketService); } // Eagerly start market data fetching
    sidebarOpen = signal(false);
    sidebarCollapsed = signal(false);

    ngOnInit() {
        // Prevent all /app/* routes from being indexed by search engines.
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }

    toggleSidebar() {
        this.sidebarOpen.update((v) => !v);
    }

    closeSidebar() {
        this.sidebarOpen.set(false);
    }

    toggleSidebarCollapse() {
        this.sidebarCollapsed.update(v => !v);
    }
}
