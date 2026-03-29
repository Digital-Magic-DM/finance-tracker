import { Component, inject, computed } from '@angular/core';
import { SnackbarService } from '../../services/snackbar.service';

@Component({
    selector: 'app-snackbar',
    standalone: true,
    template: `
        @if (state().visible) {
            <div class="snackbar" [class]="state().type" [class.has-action]="state().action">
                <div class="snackbar-content">
                    <span class="material-icons snackbar-icon">{{ icon() }}</span>
                    <span class="snackbar-msg">{{ state().message }}</span>
                </div>
                
                <div class="snackbar-actions">
                    @if (state().action; as action) {
                        <button class="btn-snack-action" (click)="handleAction(action)">
                            {{ action.label }}
                        </button>
                    }
                    <button class="btn-snack-close" (click)="snackbar.dismiss()">
                        <span class="material-icons">close</span>
                    </button>
                </div>
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
            justify-content: space-between;
            gap: 16px;
            padding: 12px 16px 12px 20px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            box-shadow: 0 12px 40px rgba(0,0,0,0.3);
            animation: snackSlideUp 0.35s cubic-bezier(.175, .885, .32, 1.275);
            max-width: 90vw;
            min-width: 320px;
            border: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(8px);
        }

        .snackbar-content {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .snackbar.success { background: rgba(0, 184, 148, 0.95); }
        .snackbar.error   { background: rgba(255, 118, 117, 0.95); }
        .snackbar.info    { background: rgba(108, 99, 255, 0.95); }

        .snackbar-icon { font-size: 20px; }
        .snackbar-msg { flex: 1; }

        .snackbar-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn-snack-action {
            background: #fff;
            color: #000;
            border: none;
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            cursor: pointer;
            transition: transform 0.2s;
            white-space: nowrap;

            &:hover { transform: scale(1.05); }
            &:active { transform: scale(0.95); }
        }

        .btn-snack-close {
            background: none;
            border: none;
            color: #fff;
            padding: 4px;
            display: flex;
            align-items: center;
            opacity: 0.6;
            cursor: pointer;
            transition: opacity 0.2s;

            &:hover { opacity: 1; }
            .material-icons { font-size: 18px; }
        }

        @keyframes snackSlideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(32px); }
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

    handleAction(action: { label: string; callback: () => void }) {
        action.callback();
        this.snackbar.dismiss();
    }
}
