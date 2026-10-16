import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createFinTrackerMcpServer } from './server.js';
import { getFirestoreDb, getFirebaseAuth } from './firebase.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  displayName?: string;
  authType: 'personal_key' | 'firebase_id_token' | 'master_token';
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

interface SessionContext {
  transport: SSEServerTransport;
  uid: string;
  email?: string;
}

// Map of active SSE client sessions
const activeTransports = new Map<string, SessionContext>();

/**
 * Multi-Tenant Authentication Middleware:
 * Supports:
 * 1. Personal User MCP Key: ft_mcp_<uid>_<secret> (Validated against Firestore users/<uid>/security/mcp_auth)
 * 2. Firebase ID Token: Bearer eyJ... (Cryptographically verified via Firebase Admin Auth)
 * 3. Master Token: FINTRACKER_AUTH_TOKEN (Admin/testing fallback)
 */
async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const queryToken = ((req.query.token as string) || (req.query.apiKey as string))?.trim();

  const providedToken = bearerToken || queryToken;

  if (!providedToken) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing authentication token. Provide your personal FinTracker AI Key as Bearer token or ?token=<key>.',
      loginUrl: 'https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp',
    });
    return;
  }

  // 1. Check Personal MCP Key format (ft_mcp_<uid>_<secret>)
  if (providedToken.startsWith('ft_mcp_')) {
    const match = providedToken.match(/^ft_mcp_([A-Za-z0-9_-]+)_[A-Za-z0-9]+$/);
    if (!match) {
      res.status(401).json({
        error: 'InvalidTokenFormat',
        message: 'The provided key format is invalid. Keys must match "ft_mcp_<uid>_<secret>".',
      });
      return;
    }

    const userUid = match[1];

    try {
      const db = getFirestoreDb();
      const authDoc = await db.doc(`users/${userUid}/security/mcp_auth`).get();

      if (authDoc.exists) {
        const data = authDoc.data();
        if (data && data.status === 'active' && data.token === providedToken) {
          req.authenticatedUser = {
            uid: userUid,
            email: data.userEmail || undefined,
            displayName: data.displayName || undefined,
            authType: 'personal_key',
          };

          // Asynchronously touch lastUsedAt without slowing down response
          authDoc.ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});
          return next();
        }
      }

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or revoked FinTracker AI key. Please generate a new key in FinTracker Settings.',
        settingsUrl: 'https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp',
      });
      return;
    } catch (err: any) {
      console.error('[MCP Auth] Error verifying personal key against Firestore:', err);
      res.status(500).json({ error: 'AuthError', message: 'Unable to verify credentials with database.' });
      return;
    }
  }

  // 2. Check Firebase ID Token (JWT format)
  if (providedToken.startsWith('ey') && providedToken.split('.').length === 3) {
    try {
      const auth = getFirebaseAuth();
      const decoded = await auth.verifyIdToken(providedToken);
      req.authenticatedUser = {
        uid: decoded.uid,
        email: decoded.email || undefined,
        authType: 'firebase_id_token',
      };
      return next();
    } catch (jwtErr: any) {
      console.warn('[MCP Auth] Firebase ID Token verification failed:', jwtErr.message);
      // Fall through to master token check
    }
  }

  // 3. Fallback: Master Admin Secret Token (FINTRACKER_AUTH_TOKEN)
  const masterToken = process.env.FINTRACKER_AUTH_TOKEN;
  if (masterToken && providedToken === masterToken) {
    req.authenticatedUser = {
      uid: process.env.DEFAULT_USER_UID || '',
      authType: 'master_token',
    };
    return next();
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid authentication credentials. Visit FinTracker to generate or reset your personal AI key.',
    loginUrl: 'https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp',
  });
}

/**
 * Diagnostic Verification API:
 * Allows user to verify if their token is valid and returns authenticated profile info.
 */
app.all('/api/verify-token', authMiddleware, (req: Request, res: Response) => {
  res.json({
    valid: true,
    authenticatedUser: req.authenticatedUser,
    message: `Authenticated successfully as ${req.authenticatedUser?.displayName || req.authenticatedUser?.email || req.authenticatedUser?.uid}`,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Public Landing & Connect Portal (Serves HTML for browsers, JSON for automated monitors)
 */
app.get('/', (req: Request, res: Response) => {
  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (!acceptsHtml) {
    res.json({
      status: 'healthy',
      service: 'fintracker-mcp-server',
      version: '1.0.0',
      transport: 'SSE (Server-Sent Events)',
      multiUserAuth: 'enabled',
      endpoints: {
        health: 'GET /health',
        sse: 'GET /sse?token=<personal_key>',
        verify: 'GET /api/verify-token',
        connect: 'GET /connect',
      },
      activeSessions: activeTransports.size,
    });
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FinTracker Remote MCP Server</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      max-width: 680px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 36px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
      margin-bottom: 16px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); }
    h1 { font-size: 26px; font-weight: 800; margin-bottom: 8px; color: #fff; }
    p.lead { font-size: 15px; color: var(--text-muted); line-height: 1.6; margin-bottom: 24px; }
    .features {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .feature-item { font-size: 13.5px; color: var(--text); display: flex; align-items: center; gap: 8px; }
    .feature-item span { color: var(--accent); }
    .btn-connect {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 20px;
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      border-radius: 10px;
      text-decoration: none;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }
    .btn-connect:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6); }
    .diagnostics {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--card-border);
    }
    .diag-title { font-size: 13px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; }
    .diag-box { display: flex; gap: 8px; }
    .diag-input {
      flex: 1;
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      outline: none;
    }
    .btn-verify {
      background: #1f2937;
      color: #fff;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 10px 18px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-verify:hover { background: #374151; }
    #diagResult { margin-top: 10px; font-size: 13px; font-family: monospace; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge"><span class="dot"></span> Online & Ready</div>
    <h1>FinTracker MCP Server</h1>
    <p class="lead">
      Production Model Context Protocol (MCP) server connecting AI clients (Antigravity IDE, Claude Desktop, Cursor) to personal portfolios with multi-tenant user isolation.
    </p>

    <div class="features">
      <div class="feature-item"><span>✓</span> Isolated Multi-User Security</div>
      <div class="feature-item"><span>✓</span> Real-Time Net Worth & Assets</div>
      <div class="feature-item"><span>✓</span> Cashflow & Runway Analysis</div>
      <div class="feature-item"><span>✓</span> Conversational Transactions</div>
    </div>

    <a href="https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp" class="btn-connect">
      🔐 Connect With FinTracker Web App
    </a>

    <div class="diagnostics">
      <div class="diag-title">Key Tester & Diagnostics</div>
      <div class="diag-box">
        <input type="text" id="tokenInput" class="diag-input" placeholder="Paste your ft_mcp_ key here to test...">
        <button class="btn-verify" onclick="testKey()">Verify</button>
      </div>
      <div id="diagResult"></div>
    </div>
  </div>

  <script>
    async function testKey() {
      const token = document.getElementById('tokenInput').value.trim();
      const resEl = document.getElementById('diagResult');
      if (!token) return;
      resEl.style.display = 'block';
      resEl.innerHTML = '<span style="color:#9ca3af;">Verifying with server...</span>';

      try {
        const resp = await fetch('/api/verify-token', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        if (resp.ok && data.valid) {
          resEl.innerHTML = '<span style="color:#10b981;">✓ ' + data.message + '</span>';
        } else {
          resEl.innerHTML = '<span style="color:#ef4444;">✗ ' + (data.message || 'Invalid key') + '</span>';
        }
      } catch (e) {
        resEl.innerHTML = '<span style="color:#ef4444;">✗ Network error: ' + e.message + '</span>';
      }
    }
  </script>
</body>
</html>`;

  res.send(html);
});

/**
 * Shortcut /connect redirect: sends users directly to FinTracker MCP Settings
 */
app.get('/connect', (_req: Request, res: Response) => {
  res.redirect('https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp');
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeSessions: activeTransports.size });
});

/**
 * Remote SSE Endpoint: Connects AI clients via streaming SSE with session-specific user UID
 */
app.get('/sse', authMiddleware, async (req: Request, res: Response) => {
  const userUid = req.authenticatedUser?.uid;
  console.log(`[MCP] New SSE connection request from authenticated user: ${userUid} (${req.authenticatedUser?.authType})`);

  try {
    // Create MCP Server instance strictly bound to this caller's UID
    const server = createFinTrackerMcpServer(userUid);
    const transport = new SSEServerTransport('/message', res);

    activeTransports.set(transport.sessionId, {
      transport,
      uid: userUid || '',
      email: req.authenticatedUser?.email,
    });

    console.log(`[MCP] Session created: ${transport.sessionId} for UID: ${userUid} (Active: ${activeTransports.size})`);

    res.on('close', () => {
      activeTransports.delete(transport.sessionId);
      console.log(`[MCP] Session closed: ${transport.sessionId} (Active: ${activeTransports.size})`);
    });

    await server.connect(transport);
  } catch (err) {
    console.error('[MCP] Error establishing SSE transport:', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to initialize MCP SSE connection');
    }
  }
});

/**
 * Message Endpoint: Handles JSON-RPC requests for active sessions
 */
app.post('/message', authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).send('Missing "sessionId" query parameter');
    return;
  }

  const session = activeTransports.get(sessionId);
  if (!session) {
    res.status(404).send(`Session with ID "${sessionId}" not found or expired`);
    return;
  }

  // Multi-tenant check: caller must match session user
  if (session.uid && req.authenticatedUser?.uid && session.uid !== req.authenticatedUser.uid) {
    res.status(403).send('Forbidden: This session belongs to a different authenticated user');
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err) {
    console.error(`[MCP] Error handling message for session ${sessionId}:`, err);
    if (!res.headersSent) {
      res.status(500).send('Error processing MCP message');
    }
  }
});

// Start Express HTTP server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`  FinTracker Remote MCP Server running on port ${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/`);
  console.log(`  SSE Endpoint: http://localhost:${PORT}/sse`);
  console.log('====================================================');
});
