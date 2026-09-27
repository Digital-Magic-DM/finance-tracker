import { Component, signal, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
// import { MarketService } from '../services/market.service';
import { Meta } from '@angular/platform-browser';
import { AiChatComponent } from '../shared/ai-chat/ai-chat.component';

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [RouterOutlet, SidebarComponent, ToolbarComponent, AiChatComponent],
    templateUrl: './layout.component.html',
    styleUrl: './layout.component.scss',
})
export class LayoutComponent implements OnInit {
    private meta = inject(Meta);
    // constructor() { inject(MarketService); } // Eagerly start market data fetching
    sidebarOpen = signal(false);
    sidebarCollapsed = signal(localStorage.getItem('fintracker_sidebar_collapsed') === 'true');

    ngOnInit() {
        // Prevent all /app/* routes from being indexed by search engines.
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }

    toggleSidebar() {
        if (typeof window !== 'undefined' && window.innerWidth <= 768) {
            this.sidebarOpen.update((v) => !v);
        } else {
            this.toggleSidebarCollapse();
        }
    }

    closeSidebar() {
        this.sidebarOpen.set(false);
    }

    toggleSidebarCollapse() {
        this.sidebarCollapsed.update((v) => {
            const next = !v;
            try {
                localStorage.setItem('fintracker_sidebar_collapsed', String(next));
            } catch {}
            return next;
        });
    }
}
