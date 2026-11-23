import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty-state-wrapper">
      @if (icon()) {
        <div class="empty-icon-box">
          <span class="material-icons empty-icon">{{ icon() }}</span>
        </div>
      }
      @if (title()) {
        <h3 class="empty-title">{{ title() }}</h3>
      }
      @if (description()) {
        <p class="empty-desc">{{ description() }}</p>
      }
      @if (actionText()) {
        <button type="button" class="btn btn-primary empty-btn" (click)="action.emit()">
          @if (actionIcon()) {
            <span class="material-icons sm-icon">{{ actionIcon() }}</span>
          }
          <span>{{ actionText() }}</span>
        </button>
      }
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    .empty-state-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 36px 20px;
      border-radius: var(--radius-md, 12px);
      background: var(--bg-card, rgba(255, 255, 255, 0.02));
      border: 1px dashed var(--border-color, rgba(255, 255, 255, 0.08));
      margin: 12px 0;
      width: 100%;
    }

    .empty-icon-box {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }

    .empty-icon {
      font-size: 28px;
      color: var(--text-muted, #94a3b8);
      opacity: 0.8;
    }

    .empty-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary, #f8fafc);
      margin: 0 0 6px 0;
      letter-spacing: -0.2px;
    }

    .empty-desc {
      font-size: 13px;
      color: var(--text-muted, #94a3b8);
      margin: 0 0 16px 0;
      max-width: 420px;
      line-height: 1.5;
    }

    .empty-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      border-radius: var(--radius-sm, 8px);
      cursor: pointer;
      transition: all 0.2s ease;
    }
  `]
})
export class EmptyStateComponent {
  icon = input<string>('inbox');
  title = input<string>('No data found');
  description = input<string>('');
  actionText = input<string>('');
  actionIcon = input<string>('');
  action = output<void>();
}
