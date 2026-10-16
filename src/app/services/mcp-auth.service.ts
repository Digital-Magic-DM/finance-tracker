import { Injectable, inject, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, updateDoc } from '@angular/fire/firestore';
import { SnackbarService } from './snackbar.service';

export interface McpAuthState {
  token: string;
  uid: string;
  userEmail: string;
  displayName: string;
  status: 'active' | 'revoked';
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class McpAuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private snackbar = inject(SnackbarService);

  readonly token = signal<string | null>(null);
  readonly status = signal<'active' | 'revoked' | 'unconfigured'>('unconfigured');
  readonly createdAt = signal<string | null>(null);
  readonly lastUsedAt = signal<string | null>(null);
  readonly label = signal<string>('Personal Assistant');
  readonly isLoading = signal<boolean>(false);
  readonly isActionInProgress = signal<boolean>(false);

  // Default production MCP server URL
  readonly serverBaseUrl = 'https://finance-tracker-vczn.onrender.com';

  constructor() {
    this.auth.onAuthStateChanged((user) => {
      if (user) {
        this.loadUserMcpAuth(user.uid);
      } else {
        this.resetState();
      }
    });
  }

  /**
   * Loads existing MCP authorization credentials for a user from Firestore
   */
  async loadUserMcpAuth(uid?: string): Promise<boolean> {
    const targetUid = uid || this.auth.currentUser?.uid;
    if (!targetUid) return false;

    this.isLoading.set(true);
    try {
      const ref = doc(this.firestore, 'users', targetUid, 'security', 'mcp_auth');
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data() as McpAuthState;
        if (data.status === 'active' && data.token) {
          this.token.set(data.token);
          this.status.set('active');
          this.createdAt.set(data.createdAt || null);
          this.lastUsedAt.set(data.lastUsedAt || null);
          this.label.set(data.label || 'Personal Assistant');
          return true;
        } else if (data.status === 'revoked') {
          this.token.set(null);
          this.status.set('revoked');
          this.createdAt.set(data.createdAt || null);
          return false;
        }
      }

      this.resetState();
      return false;
    } catch (err) {
      console.error('[McpAuthService] Error loading user MCP credentials:', err);
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Generates a brand new cryptographically random personal MCP key for this user.
   * Format: ft_mcp_<uid>_<48_random_hex_characters>
   */
  async generatePersonalMcpKey(label = 'Personal Assistant'): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) {
      this.snackbar.show('You must be signed in to generate an AI key.', 'error');
      return null;
    }

    this.isActionInProgress.set(true);
    try {
      // Generate 24 secure random bytes (48 hex characters)
      const randomBytes = new Uint8Array(24);
      crypto.getRandomValues(randomBytes);
      const secretHex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

      // Token format includes UID for O(1) multi-tenant routing + cryptographically strong secret
      const newToken = `ft_mcp_${user.uid}_${secretHex}`;
      const now = new Date().toISOString();

      const payload: McpAuthState = {
        token: newToken,
        uid: user.uid,
        userEmail: user.email || '',
        displayName: user.displayName || 'FinTracker User',
        status: 'active',
        label,
        createdAt: now,
      };

      const ref = doc(this.firestore, 'users', user.uid, 'security', 'mcp_auth');
      await setDoc(ref, payload);

      this.token.set(newToken);
      this.status.set('active');
      this.createdAt.set(now);
      this.lastUsedAt.set(null);
      this.label.set(label);

      this.snackbar.show('Personal AI / MCP Key generated successfully!', 'success');
      return newToken;
    } catch (err: any) {
      console.error('[McpAuthService] Failed to generate MCP key:', err);
      this.snackbar.show('Failed to generate AI key: ' + (err.message || 'Firestore error'), 'error');
      return null;
    } finally {
      this.isActionInProgress.set(false);
    }
  }

  /**
   * Revokes the current MCP key immediately.
   */
  async revokePersonalMcpKey(): Promise<boolean> {
    const user = this.auth.currentUser;
    if (!user) return false;

    this.isActionInProgress.set(true);
    try {
      const ref = doc(this.firestore, 'users', user.uid, 'security', 'mcp_auth');
      const now = new Date().toISOString();
      await updateDoc(ref, {
        status: 'revoked',
        revokedAt: now,
      });

      this.token.set(null);
      this.status.set('revoked');
      this.snackbar.show('AI Key revoked. Any connected assistants can no longer access your data.', 'info');
      return true;
    } catch (err: any) {
      console.error('[McpAuthService] Failed to revoke key:', err);
      this.snackbar.show('Failed to revoke key: ' + (err.message || 'Error'), 'error');
      return false;
    } finally {
      this.isActionInProgress.set(false);
    }
  }

  /**
   * Resets local signals to unconfigured state
   */
  private resetState() {
    this.token.set(null);
    this.status.set('unconfigured');
    this.createdAt.set(null);
    this.lastUsedAt.set(null);
    this.label.set('Personal Assistant');
  }

  /**
   * Helper: Remote SSE Connection URL with Bearer query parameter
   */
  getRemoteSseUrl(token?: string): string {
    const activeToken = token || this.token();
    if (!activeToken) return `${this.serverBaseUrl}/sse`;
    return `${this.serverBaseUrl}/sse?token=${encodeURIComponent(activeToken)}`;
  }

  /**
   * Helper: Ready-to-paste Claude Desktop JSON configuration
   */
  getClaudeDesktopConfig(token?: string): string {
    const activeToken = token || this.token() || 'YOUR_PERSONAL_TOKEN_HERE';
    return JSON.stringify(
      {
        mcpServers: {
          fintracker: {
            url: `${this.serverBaseUrl}/sse`,
            headers: {
              Authorization: `Bearer ${activeToken}`,
            },
          },
        },
      },
      null,
      2
    );
  }

  /**
   * Helper: Ready-to-paste Antigravity IDE JSON configuration (mcp_config.json)
   */
  getAntigravityConfig(token?: string): string {
    return this.getClaudeDesktopConfig(token);
  }

  /**
   * Helper: Ready-to-paste Cursor / Windsurf command-line or SSE config
   */
  getCursorConfig(token?: string): string {
    const activeToken = token || this.token() || 'YOUR_PERSONAL_TOKEN_HERE';
    return `Server Name: fintracker\nType: SSE\nURL: ${this.serverBaseUrl}/sse?token=${activeToken}`;
  }
}
