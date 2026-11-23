import { Component, input, output, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confirm-delete-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="modal-overlay" (click)="onBackdropClick()">
        <div class="modal delete-modal" (click)="$event.stopPropagation()">
          <div class="modal-header delete-modal-header">
            <div class="warning-title-wrap">
              <div class="warning-icon-badge">
                <span class="material-icons warning-icon">delete_sweep</span>
              </div>
              <div>
                <h3>{{ title() }}</h3>
                <p class="subtitle">
                  {{ itemCount() === 1 ? ('1 ' + itemLabel() + ' selected for deletion') : (itemCount() + ' ' + itemLabel() + 's selected for deletion') }}
                </p>
              </div>
            </div>
            <button type="button" class="btn-icon" (click)="onCancel()" [disabled]="deleting()" title="Close">
              <span class="material-icons">close</span>
            </button>
          </div>

          <div class="modal-body delete-modal-body">
            <div class="delete-callout-banner">
              <span class="material-icons callout-icon">warning_amber</span>
              <div class="callout-text">
                <div class="callout-heading">{{ warningHeading() }}</div>
                <div class="callout-desc">
                  {{ warningText() || ('You are about to permanently delete the selected ' + (itemCount() === 1 ? itemLabel() : (itemLabel() + 's')) + '. This action cannot be undone.') }}
                </div>
              </div>
            </div>

            <!-- Optional Summary Slot -->
            <ng-content select="[summary]"></ng-content>

            <!-- Optional Item List Slot -->
            <ng-content select="[items]"></ng-content>

            <!-- General Content Slot -->
            <ng-content></ng-content>
          </div>

          <div class="modal-footer delete-modal-footer">
            <button type="button" class="btn btn-ghost" (click)="onCancel()" [disabled]="deleting()">
              Cancel
            </button>
            <button type="button" class="btn btn-danger btn-confirm-delete" (click)="onConfirm()" [disabled]="deleting()">
              @if (deleting()) {
                <span class="material-icons spin sm-icon">sync</span>
                <span>Deleting ({{ itemCount() }})...</span>
              } @else {
                <span class="material-icons sm-icon">delete_forever</span>
                <span>{{ confirmText() || ('Confirm Delete (' + itemCount() + ')') }}</span>
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      animation: fadeIn 0.18s ease-out;
    }

    .delete-modal {
      background: var(--bg-card, #121824);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-lg, 16px);
      width: 100%;
      max-width: 520px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }

    .delete-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));

      .warning-title-wrap {
        display: flex;
        align-items: center;
        gap: 12px;

        .warning-icon-badge {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;

          .warning-icon {
            font-size: 20px;
            color: #ef4444;
          }
        }

        h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary, #f8fafc);
        }

        .subtitle {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--text-muted, #94a3b8);
        }
      }

      .btn-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: transparent;
        border: none;
        color: var(--text-muted, #94a3b8);
        cursor: pointer;

        &:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary, #f8fafc);
        }
      }
    }

    .delete-modal-body {
      padding: 16px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .delete-callout-banner {
      display: flex;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);

      .callout-icon {
        font-size: 20px;
        color: #ef4444;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .callout-heading {
        font-size: 13px;
        font-weight: 700;
        color: #ef4444;
        margin-bottom: 2px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .callout-desc {
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary, #cbd5e1);
      }
    }

    .delete-modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
      background: rgba(0, 0, 0, 0.15);

      .btn {
        padding: 8px 18px;
        font-size: 13px;
        font-weight: 600;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .btn-ghost {
        background: transparent;
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
        color: var(--text-secondary, #cbd5e1);

        &:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-primary, #f8fafc);
        }
      }

      .btn-danger {
        background: #ef4444;
        border: 1px solid #dc2626;
        color: #ffffff;

        &:hover:not(:disabled) {
          background: #dc2626;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }

    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `]
})
export class ConfirmDeleteModalComponent {
  isOpen = input<boolean>(false);
  title = input<string>('Confirm Deletion');
  itemCount = input<number>(1);
  itemLabel = input<string>('holding');
  warningHeading = input<string>('Warning: Permanent Action');
  warningText = input<string>('');
  deleting = input<boolean>(false);
  confirmText = input<string>('');

  confirmed = output<void>();
  cancelled = output<void>();

  @HostListener('document:keydown.escape', ['$event'])
  onKeydown(event: Event) {
    if (this.isOpen() && !this.deleting()) {
      event.preventDefault();
      this.onCancel();
    }
  }

  onBackdropClick() {
    if (!this.deleting()) {
      this.onCancel();
    }
  }

  onCancel() {
    this.cancelled.emit();
  }

  onConfirm() {
    this.confirmed.emit();
  }
}
