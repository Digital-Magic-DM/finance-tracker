import { Component, ElementRef, ViewChild, ViewEncapsulation, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { AssetService } from '../../services/asset.service';
import { TransactionService } from '../../services/transaction.service';
import { SipService } from '../../services/sip.service';
import { toSignal } from '@angular/core/rxjs-interop';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
}

@Component({
  selector: 'app-ai-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (aiService.isChatOpen()) {
      <div class="ai-overlay" (click)="aiService.closeChat()"></div>
      <div class="ai-panel">
        <div class="ai-header">
          <div class="brand" style="display:flex; align-items:center; gap:8px;">
            <span class="material-icons" style="color:var(--text-primary)">auto_awesome</span>
            <h3 style="margin:0; text-transform:uppercase; font-weight:900;">FinTracker AI</h3>
          </div>
          <button class="btn-icon" (click)="aiService.closeChat()">
            <span class="material-icons">close</span>
          </button>
        </div>

        <div class="ai-content" #chatContainer>
          @if (!aiService.hasApiKey()) {
            <div class="message system">
              <div class="msg-bubble">
                <span class="material-icons">warning</span>
                API Key required. Go to <strong>Settings</strong> to connect your free Gemini API key to start chatting.
              </div>
            </div>
          } @else {
            @if (messages().length === 0) {
              <div class="message system">
                <div class="msg-bubble">
                  <strong>FinTracker AI Online</strong><br/><br/>
                  I have secure, local access to your current portfolio metrics and recent transactions. How can I analyze your data today?<br/><br/>
                  <span style="font-size: 11px; color: var(--text-muted);">
                    <strong>Note:</strong> Free API tiers have strict requests-per-minute (RPM) limits causing Quota Exhaustion (429) errors. Please do not spam the chat.
                  </span>
                </div>
              </div>
            }

            @for (msg of messages(); track msg.id) {
              <div class="message" [class.user]="msg.role === 'user'" [class.ai]="msg.role === 'ai'">
                <div class="msg-bubble" [innerHTML]="formatMessage(msg.content)"></div>
              </div>
            }

            @if (isTyping()) {
              <div class="message ai typing">
                <div class="msg-bubble" style="display:flex; align-items:center; gap:8px;">
                  Analyzing... 
                  <span class="material-icons rotating" style="font-size:16px;">sync</span>
                </div>
              </div>
            }
          }
        </div>

        <div style="padding: 20px; border-top: 2px solid var(--border-color); background: var(--bg-primary);">
          <div class="ai-footer" style="display: flex; gap: 12px; margin-bottom: 8px;">
            <input type="text" [(ngModel)]="currentPrompt" (keyup.enter)="sendMessage()"
                   placeholder="Ask about your portfolio..." 
                   [disabled]="!aiService.hasApiKey() || isTyping()">
            <button class="action-btn" (click)="sendMessage()" [disabled]="!aiService.hasApiKey() || isTyping() || !currentPrompt.trim()">
              <span class="material-icons">send</span>
            </button>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); text-align: right; font-family: monospace; letter-spacing: 0.5px;">
            PAYLOAD: {{ payloadSizeKb() }} KB / 1000.00 KB MAX
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .ai-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      backdrop-filter: blur(2px);
    }
    
    .ai-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      max-width: 90vw;
      height: 100vh;
      background: var(--bg-card);
      border-left: 2px solid var(--border-color);
      z-index: 1001;
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 30px rgba(0,0,0,0.2);
    }

    .ai-header {
      padding: 20px;
      border-bottom: 2px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-primary);
    }

    .ai-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      display: flex;
      width: 100%;
    }

    .message.user {
      justify-content: flex-end;
    }
    .message.user .msg-bubble {
      background: var(--text-primary);
      color: var(--bg-primary);
      border: none;
    }

    .message.ai .msg-bubble {
      background: var(--bg-card-hover);
      border: 1px solid var(--border-light);
    }

    .message.system {
      justify-content: center;
    }
    .message.system .msg-bubble {
      background: transparent;
      border: 1px dashed var(--border-color);
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
    }

    .msg-bubble {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 0; /* Brutalist sharp corners */
      font-size: 14px;
      line-height: 1.5;
      font-weight: 500;
    }

    .msg-bubble h2 { margin: 16px 0 8px 0; font-weight: 900; text-transform: uppercase; font-size: 1.3em; }
    .msg-bubble h3 { margin: 14px 0 8px 0; font-weight: 800; text-transform: uppercase; font-size: 1.2em; }
    .msg-bubble h4 { margin: 12px 0 8px 0; font-weight: 800; text-transform: uppercase; font-size: 1.1em; }
    .msg-bubble p { margin-bottom: 8px; }
    .msg-bubble p:last-child { margin-bottom: 0; }
    .msg-bubble strong { font-weight: 800; }
    .msg-bubble ul { padding-left: 20px; margin-top: 8px; }
    
    .ai-footer input {
      flex: 1;
      padding: 12px 16px;
      background: transparent;
      border: 2px solid var(--border-color);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      border-radius: 0;
    }
    .ai-footer input:focus {
      border-color: var(--text-primary);
    }
    
    .action-btn {
      background: var(--text-primary);
      color: var(--bg-primary);
      border: none;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .rotating {
      animation: spin 1s linear infinite;
    }
  `]
})
export class AiChatComponent {
  aiService = inject(AiService);
  private assetService = inject(AssetService);
  private txService = inject(TransactionService);
  private sipService = inject(SipService);

  @ViewChild('chatContainer') chatContainer!: ElementRef;

  currentPrompt = '';
  isTyping = signal(false);
  messages = signal<ChatMessage[]>([]);

  // Get raw JSON context for the AI
  assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
  transactions = toSignal(this.txService.getTransactions(), { initialValue: [] });

  contextPayload = computed(() => {
    const sips = this.sipService.sips();
    const activeSips = sips.filter((s) => s.status === 'Active');
    const summary = this.sipService.summaryMetrics();

    return {
      totalAssetsCount: this.assets().length,
      assets: this.assets().map((a: any) => ({
        sym: a.symbol,
        qty: a.quantity,
        price: a.currentPrice,
        type: a.type
      })),
      recentTransactions: this.transactions().slice(0, 20).map((t: any) => ({
        amount: t.amount,
        type: t.type,
        category: t.category,
        date: t.date?.seconds ? new Date(t.date.seconds * 1000).toISOString().split('T')[0] : String(t.date).split('T')[0]
      })),
      sipCommitments: {
        totalActiveSips: summary.totalActiveSips,
        monthlySipOutflow: summary.totalMonthlyCommitment,
        totalInvestedToDate: summary.totalInvested,
        activePlans: activeSips.map((s) => ({
          name: s.name,
          category: s.category,
          amount: s.amount,
          frequency: s.frequency,
          sipDay: s.sipDay,
          nextExecutionDate: s.nextExecutionDate,
          stepUp: s.stepUp?.enabled ? `+${s.stepUp.value}% annual` : 'None'
        }))
      }
    };
  });

  payloadSizeKb = computed(() => {
    const str = JSON.stringify(this.contextPayload());
    return (str.length / 1024).toFixed(2);
  });

  constructor() {
    // Scroll to bottom whenever messages update
    effect(() => {
      this.messages(); // track dependency
      setTimeout(() => this.scrollToBottom(), 100);
    });
  }

  async sendMessage() {
    const text = this.currentPrompt.trim();
    if (!text) return;

    // Append user message
    this.messages.update(m => [...m, { id: Date.now().toString(), role: 'user', content: text }]);
    this.currentPrompt = '';
    this.isTyping.set(true);

    // Use the computed lightweight portfolio payload
    let contextData = this.contextPayload();

    // Failsafe: Hard cap at roughly 1MB of UTF-8 data to protect against bloated quota utilization
    let payloadString = JSON.stringify(contextData);
    if (payloadString.length > 500000) {
      contextData.assets = contextData.assets.slice(0, 50);
      contextData.recentTransactions = contextData.recentTransactions.slice(0, 5);
    }

    try {
      const response = await this.aiService.chatWithData(text, contextData);
      
      this.messages.update(m => [...m, { 
        id: Date.now().toString(), 
        role: 'ai', 
        content: response 
      }]);
    } catch (e: any) {
      this.messages.update(m => [...m, { 
        id: Date.now().toString(), 
        role: 'system', 
        content: 'Error: ' + e.message
      }]);
    }

    this.isTyping.set(false);
  }

  scrollToBottom() {
    try {
      if (this.chatContainer) {
        this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
      }
    } catch(err) {}
  }

  formatMessage(text: string): string {
    if (!text) return '';
    let formatted = text;
    // Parse Headers (Stop at the first occurrence of ** to prevent flatline wall-of-text consumption)
    formatted = formatted.replace(/(?:^|\s)### (.*?)(?=\*\*|<br|\n|$)/gim, '<h4>$1</h4>');
    formatted = formatted.replace(/(?:^|\s)## (.*?)(?=\*\*|<br|\n|$)/gim, '<h3>$1</h3>');
    formatted = formatted.replace(/(?:^|\s)# (.*?)(?=\*\*|<br|\n|$)/gim, '<h2>$1</h2>');
    // Parse Bold and Italics
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?<!\w)\*(.*?)\*(?!\w)/g, '<em>$1</em>');
    // Parse Newlines
    formatted = formatted.replace(/\n/g, '<br/>');
    return formatted;
  }
}
