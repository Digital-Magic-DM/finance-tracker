import { Component, inject, computed } from '@angular/core';
import { SnackbarService } from '../../services/snackbar.service';

@Component({
    selector: 'app-snackbar',
    standalone: true,
    template: `
        @if (state().visible) {
            <div class="snackbar" [class]="state().type" (click)="snackbar.dismiss()">
                <span class="material-icons snackbar-icon">{{ icon() }}</span>
                <span class="snackbar-msg">{{ state().message }}</span>
                <span class="material-icons snackbar-close">close</span>
            </div>
        }
    `,
    styles: [`
        .snackbar {
            position: fixed;
            bottom: 32px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 24px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 500;
            color: #fff;
            box-shadow: 0 8px 32px rgba(0,0,0,0.28);
            animation: snackSlideUp 0.35s cubic-bezier(.4,0,.2,1);
            cursor: pointer;
            max-width: 90vw;
        }
        .snackbar.success { background: linear-gradient(135deg, #00c896, #00d4aa); }
        .snackbar.error   { background: linear-gradient(135deg, #ff4b4b, #e63946); }
        .snackbar.info    { background: linear-gradient(135deg, #6C63FF, #7c74ff); }
        .snackbar-icon { font-size: 20px; }
        .snackbar-close { font-size: 18px; opacity: 0.7; margin-left: 8px; }
        .snackbar-close:hover { opacity: 1; }
        @keyframes snackSlideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(24px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `],
})
export class SnackbarComponent {
    snackbar = inject(SnackbarService);
    state = this.snackbar.state;

    icon = computed(() => {
        const t = this.state().type;
        if (t === 'success') return 'check_circle';
        if (t === 'error') return 'error_outline';
        return 'info';
    });
}
