import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { McpAuthService } from '../../services/mcp-auth.service';

@Component({
  selector: 'app-mcp-authorize',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="mcp-auth-container">
      <div class="mcp-auth-card">
        <!-- Brand Header -->
        <div class="brand-badge">
          <span class="material-icons">account_balance_wallet</span>
          <span>FinTracker SSO</span>
        </div>

        <div class="connector-header">
          <div class="connector-icon-wrap">
            <span class="material-icons ai-icon">smart_toy</span>
          </div>
          <h2>Connect with AI Assistant</h2>
          <p class="subtitle">
            An external AI connector is requesting authorization to interact with your FinTracker account.
          </p>
        </div>

        <!-- Authenticated User Profile -->
        @if (currentUser(); as user) {
          <div class="user-profile-pill">
            <div class="user-avatar">
              @if (user.photoURL) {
                <img [src]="user.photoURL" alt="User avatar" />
              } @else {
                <span class="material-icons">person</span>
              }
            </div>
            <div class="user-info">
              <span class="user-name">{{ user.displayName || 'FinTracker User' }}</span>
              <span class="user-email">{{ user.email }}</span>
            </div>
            <span class="sso-badge">
              <span class="material-icons check-icon">verified</span>
              Verified SSO
            </span>
          </div>
        } @else {
          <div class="auth-loading-pill">
            <span class="spinner"></span>
            <span>Checking FinTracker authentication...</span>
          </div>
        }

        <!-- Permissions / Scopes -->
        <div class="scopes-card">
          <span class="scopes-title">This connection will allow the assistant to:</span>
          <ul class="scopes-list">
            <li>
              <span class="material-icons scope-icon green">check_circle</span>
              <div>
                <strong>Read Portfolio & Net Worth</strong>
                <span>View current asset valuations, balances, and savings rates</span>
              </div>
            </li>
            <li>
              <span class="material-icons scope-icon green">check_circle</span>
              <div>
                <strong>Query Recent Transactions</strong>
                <span>Filter and analyze income and expenses by category</span>
              </div>
            </li>
            <li>
              <span class="material-icons scope-icon green">check_circle</span>
              <div>
                <strong>Add Transactions & Assets</strong>
                <span>Log expenses or record new investments on your behalf</span>
              </div>
            </li>
          </ul>
        </div>

        <!-- Security Note -->
        <div class="security-note">
          <span class="material-icons sec-icon">lock</span>
          <span>Hermetic user isolation active. The AI will only access data belonging to your account.</span>
        </div>

        <!-- Action Buttons -->
        <div class="actions-row">
          <button class="btn-cancel" (click)="cancel()">
            <span>Cancel</span>
          </button>
          <button 
            class="btn-approve" 
            [disabled]="isAuthorizing() || !currentUser()" 
            (click)="authorizeAndConnect()">
            <span class="material-icons">{{ isAuthorizing() ? 'sync' : 'bolt' }}</span>
            <span>{{ isAuthorizing() ? 'Connecting...' : 'Authorize & Connect' }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .mcp-auth-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #090d16 60%, #030712 100%);
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
    }

    .mcp-auth-card {
      width: 100%;
      max-width: 480px;
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 80px rgba(99, 102, 241, 0.15);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .brand-badge {
      align-self: center;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: #a5b4fc;

      .material-icons {
        font-size: 16px;
        color: #818cf8;
      }
    }

    .connector-header {
      text-align: center;

      .connector-icon-wrap {
        width: 60px;
        height: 60px;
        margin: 0 auto 12px;
        border-radius: 14px;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35);

        .ai-icon {
          font-size: 32px;
          color: #fff;
        }
      }

      h2 {
        font-size: 20px;
        font-weight: 700;
        margin: 0 0 6px;
        color: #f8fafc;
      }

      .subtitle {
        margin: 0;
        font-size: 13.5px;
        color: #94a3b8;
        line-height: 1.5;
      }
    }

    .user-profile-pill {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;

      .user-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        overflow: hidden;
        background: #334155;
        display: flex;
        align-items: center;
        justify-content: center;

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .material-icons {
          color: #94a3b8;
          font-size: 24px;
        }
      }

      .user-info {
        flex: 1;
        display: flex;
        flex-direction: column;

        .user-name {
          font-size: 14px;
          font-weight: 600;
          color: #f8fafc;
        }

        .user-email {
          font-size: 12px;
          color: #94a3b8;
        }
      }

      .sso-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: #34d399;
        background: rgba(16, 185, 129, 0.12);
        padding: 4px 8px;
        border-radius: 6px;

        .check-icon {
          font-size: 14px;
        }
      }
    }

    .auth-loading-pill {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 14px;
      font-size: 13px;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.4);
      border-radius: 10px;

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: #818cf8;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .scopes-card {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px;

      .scopes-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #94a3b8;
        display: block;
        margin-bottom: 12px;
      }

      .scopes-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;

        li {
          display: flex;
          align-items: flex-start;
          gap: 10px;

          .scope-icon {
            font-size: 18px;
            margin-top: 1px;

            &.green { color: #10b981; }
          }

          div {
            display: flex;
            flex-direction: column;

            strong {
              font-size: 13px;
              color: #f1f5f9;
            }

            span {
              font-size: 11.5px;
              color: #94a3b8;
            }
          }
        }
      }
    }

    .security-note {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      color: #94a3b8;
      padding: 0 4px;

      .sec-icon {
        font-size: 15px;
        color: #64748b;
      }
    }

    .actions-row {
      display: flex;
      gap: 12px;
      margin-top: 4px;

      button {
        flex: 1;
        padding: 12px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;

        .material-icons {
          font-size: 18px;
        }
      }

      .btn-cancel {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #cbd5e1;

        &:hover {
          background: rgba(255, 255, 255, 0.12);
        }
      }

      .btn-approve {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border: none;
        color: #fff;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);

        &:hover:not(:disabled) {
          opacity: 0.95;
          transform: translateY(-1px);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
    }
  `]
})
export class McpAuthorizeComponent implements OnInit {
  private auth = inject(Auth);
  private mcpAuth = inject(McpAuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  currentUser = signal<any>(null);
  isAuthorizing = signal(false);

  // OAuth query parameters
  private clientId = '';
  private redirectUri = '';
  private state = '';
  private codeChallenge = '';
  private codeChallengeMethod = '';
  private mcpServerBase = 'https://finance-tracker-vczn.onrender.com';

  ngOnInit(): void {
    // Extract OAuth parameters forwarded from MCP server
    this.route.queryParams.subscribe((params) => {
      this.clientId = params['client_id'] || '';
      this.redirectUri = params['redirect_uri'] || '';
      this.state = params['state'] || '';
      this.codeChallenge = params['code_challenge'] || '';
      this.codeChallengeMethod = params['code_challenge_method'] || '';
      if (params['server']) {
        this.mcpServerBase = params['server'];
      }
    });

    // Check Firebase authentication state
    this.auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.currentUser.set(user);
        // Preload or generate active MCP key for this user
        await this.mcpAuth.loadUserMcpAuth(user.uid);
        if (!this.mcpAuth.token()) {
          await this.mcpAuth.generatePersonalMcpKey('AI Connector');
        }
      } else {
        // Not logged in -> Redirect to login page preserving the authorize URL
        const currentUrl = this.router.url;
        this.router.navigate(['/login'], { queryParams: { redirect: currentUrl } });
      }
    });
  }

  async authorizeAndConnect(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;

    this.isAuthorizing.set(true);

    try {
      // Ensure user has an active token
      let token = this.mcpAuth.token();
      if (!token) {
        token = await this.mcpAuth.generatePersonalMcpKey('AI Connector');
      }

      if (!token) {
        alert('Failed to retrieve personal key. Please try again.');
        this.isAuthorizing.set(false);
        return;
      }

      // Build the callback URL back to MCP server to finish the OAuth code exchange
      const callbackUrl = new URL(`${this.mcpServerBase}/oauth/authorize`);
      callbackUrl.searchParams.set('token', token);
      if (this.clientId) callbackUrl.searchParams.set('client_id', this.clientId);
      if (this.redirectUri) callbackUrl.searchParams.set('redirect_uri', this.redirectUri);
      if (this.state) callbackUrl.searchParams.set('state', this.state);
      if (this.codeChallenge) callbackUrl.searchParams.set('code_challenge', this.codeChallenge);
      if (this.codeChallengeMethod) callbackUrl.searchParams.set('code_challenge_method', this.codeChallengeMethod);

      // Redirect browser back to the MCP server endpoint with token attached
      window.location.href = callbackUrl.toString();
    } catch (err: any) {
      console.error('[McpAuthorize] Authorization failed:', err);
      alert('Error during authorization: ' + err.message);
      this.isAuthorizing.set(false);
    }
  }

  cancel(): void {
    if (this.redirectUri) {
      const cancelUrl = new URL(this.redirectUri);
      cancelUrl.searchParams.set('error', 'access_denied');
      cancelUrl.searchParams.set('error_description', 'User cancelled authorization');
      if (this.state) cancelUrl.searchParams.set('state', this.state);
      window.location.href = cancelUrl.toString();
    } else {
      this.router.navigate(['/app/dashboard']);
    }
  }
}
