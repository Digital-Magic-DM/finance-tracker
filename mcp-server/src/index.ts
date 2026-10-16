import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createFinTrackerMcpServer } from './server.js';
import { getFirestoreDb, getFirebaseAuth } from './firebase.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// ==========================================
// OAuth 2.0 / 2.1 Storage & Session Maps
// ==========================================
interface OAuthClient {
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
}

interface OAuthAuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  uid: string;
  email?: string;
  displayName?: string;
  expiresAt: number;
}

interface OAuthAccessToken {
  uid: string;
  email?: string;
  displayName?: string;
  expiresAt: number;
}

const oauthClients = new Map<string, OAuthClient>();
const oauthAuthCodes = new Map<string, OAuthAuthCode>();
const oauthAccessTokens = new Map<string, OAuthAccessToken>();

/**
 * Direct Token Verification Helper:
 * Validates personal AI keys (ft_mcp_...), OAuth tokens (ft_oauth_...), or master secret.
 */
async function verifyTokenDirectly(providedToken: string): Promise<AuthenticatedUser | null> {
  // 1. Check OAuth access token (ft_oauth_...)
  if (providedToken.startsWith('ft_oauth_')) {
    const tokenData = oauthAccessTokens.get(providedToken);
    if (tokenData && tokenData.expiresAt > Date.now()) {
      return {
        uid: tokenData.uid,
        email: tokenData.email,
        displayName: tokenData.displayName,
        authType: 'personal_key',
      };
    }
  }

  // 2. Check Personal MCP Key format (ft_mcp_<uid>_<secret>)
  if (providedToken.startsWith('ft_mcp_')) {
    const match = providedToken.match(/^ft_mcp_([A-Za-z0-9_-]+)_[A-Za-z0-9]+$/);
    if (match) {
      const userUid = match[1];
      try {
        const db = getFirestoreDb();
        const authDoc = await db.doc(`users/${userUid}/security/mcp_auth`).get();

        if (authDoc.exists) {
          const data = authDoc.data();
          if (data && data.status === 'active' && data.token === providedToken) {
            authDoc.ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});
            return {
              uid: userUid,
              email: data.userEmail || undefined,
              displayName: data.displayName || undefined,
              authType: 'personal_key',
            };
          }
        }
      } catch (err: any) {
        console.error('[MCP Auth] Error verifying personal key against Firestore:', err);
      }
    }
  }

  // 3. Fallback: Master Admin Secret Token (FINTRACKER_AUTH_TOKEN)
  const masterToken = process.env.FINTRACKER_AUTH_TOKEN;
  if (masterToken && providedToken === masterToken) {
    const defaultUid = process.env.DEFAULT_USER_UID;
    if (!defaultUid) {
      console.warn('[MCP Auth] Master token rejected: DEFAULT_USER_UID must be explicitly set to bind admin sessions safely.');
      return null;
    }
    return {
      uid: defaultUid,
      authType: 'master_token',
    };
  }

  return null;
}

/**
 * Multi-Tenant Authentication Middleware:
 * Supports:
 * 1. OAuth Access Token: ft_oauth_... (Minted via Claude OAuth flow)
 * 2. Personal User MCP Key: ft_mcp_<uid>_<secret> (Validated against Firestore users/<uid>/security/mcp_auth)
 * 3. Firebase ID Token: Bearer eyJ... (Cryptographically verified via Firebase Admin Auth)
 * 4. Master Token: FINTRACKER_AUTH_TOKEN (Admin/testing fallback)
 */
async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Allow pre-flight CORS OPTIONS requests
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const queryToken = ((req.query.token as string) || (req.query.apiKey as string))?.trim();

  const providedToken = bearerToken || queryToken;

  if (!providedToken) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="FinTracker", error="unauthorized"');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing authentication token. Provide your personal FinTracker AI Key or connect via OAuth.',
      loginUrl: 'https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp',
    });
    return;
  }

  // 1. Verify via Direct Token Checker
  const user = await verifyTokenDirectly(providedToken);
  if (user) {
    req.authenticatedUser = user;
    return next();
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
    }
  }

  res.setHeader('WWW-Authenticate', 'Bearer realm="FinTracker", error="invalid_token"');
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid authentication credentials. Visit FinTracker to generate or reset your personal AI key.',
    loginUrl: 'https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp',
  });
}

// ==========================================
// OAuth 2.0 / 2.1 RFC 8414 & RFC 7591 Endpoints
// Enables 1-Click "Connect" in Claude.ai Custom Connectors
// ==========================================

function getBaseUrl(req: Request): string {
  const host = req.get('host') || 'finance-tracker-vczn.onrender.com';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

app.get(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write'],
  });
});

app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
  });
});

/**
 * Dynamic Client Registration (RFC 7591)
 * Claude dynamically registers itself with FinTracker upon connecting.
 */
app.post(['/register', '/oauth/register'], (req: Request, res: Response) => {
  const { client_name, redirect_uris, grant_types, response_types } = req.body;
  const clientId = 'ft_client_' + crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');

  const registeredUris = Array.isArray(redirect_uris) && redirect_uris.length > 0
    ? redirect_uris
    : ['https://claude.ai/api/mcp/auth_callback'];

  oauthClients.set(clientId, {
    clientId,
    clientSecret,
    clientName: client_name || 'Claude Custom Connector',
    redirectUris: registeredUris,
  });

  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: registeredUris,
    grant_types: grant_types || ['authorization_code', 'refresh_token'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: 'none',
  });
});

/**
 * OAuth Authorization Consent Endpoint
 * Renders user consent page or auto-authorizes if key/token provided
 */
app.get(['/authorize', '/oauth/authorize'], async (req: Request, res: Response) => {
  const clientId = (req.query.client_id as string) || '';
  const redirectUri = (req.query.redirect_uri as string) || 'https://claude.ai/api/mcp/auth_callback';
  const state = (req.query.state as string) || '';
  const codeChallenge = (req.query.code_challenge as string) || '';
  const codeChallengeMethod = (req.query.code_challenge_method as string) || '';

  // If token is already passed in query parameter (e.g. ?token=ft_mcp_...), authorize immediately!
  const queryToken = (req.query.token as string)?.trim();
  if (queryToken) {
    const user = await verifyTokenDirectly(queryToken);
    if (user) {
      const code = 'ft_code_' + crypto.randomBytes(16).toString('hex');
      oauthAuthCodes.set(code, {
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      if (state) target.searchParams.set('state', state);
      return res.redirect(target.toString());
    }
  }

  // Render clean FinTracker authorization portal
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect FinTracker to Claude</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      max-width: 460px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 { font-size: 20px; font-weight: 700; color: #fff; margin: 0 0 8px; }
    p { font-size: 14px; line-height: 1.5; color: #8b949e; margin: 0 0 24px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #e6edf3; margin-bottom: 8px; }
    input[type="text"] {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 14px;
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      margin-bottom: 20px;
      outline: none;
    }
    input[type="text"]:focus { border-color: #38bdf8; }
    button {
      width: 100%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 13px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.95; }
    .hint {
      margin-top: 20px;
      font-size: 12px;
      color: #8b949e;
      text-align: center;
      line-height: 1.4;
    }
    .hint a { color: #38bdf8; text-decoration: none; }
    .hint a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Model Context Protocol</div>
    <h1>Authorize Claude Connection</h1>
    <p>Connect Claude securely to your FinTracker account to query balances, log expenses, and analyze spending habits.</p>
    <form method="POST" action="/oauth/authorize-submit">
      <input type="hidden" name="client_id" value="${encodeURIComponent(clientId)}">
      <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirectUri)}">
      <input type="hidden" name="state" value="${encodeURIComponent(state)}">
      <input type="hidden" name="code_challenge" value="${encodeURIComponent(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${encodeURIComponent(codeChallengeMethod)}">
      <label for="apiKey">Personal FinTracker AI Key</label>
      <input type="text" id="apiKey" name="apiKey" placeholder="ft_mcp_..." required autofocus>
      <button type="submit">Authorize & Connect</button>
    </form>
    <div class="hint">
      Find or create your AI Key in your <a href="https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp" target="_blank">FinTracker Settings &rarr; AI & MCP</a>.
    </div>
  </div>
</body>
</html>`);
});

/**
 * Handle Authorization Form Submission
 */
app.post('/oauth/authorize-submit', async (req: Request, res: Response) => {
  const apiKey = (req.body.apiKey as string)?.trim();
  const clientId = decodeURIComponent(req.body.client_id || '');
  const redirectUri = decodeURIComponent(req.body.redirect_uri || '');
  const state = decodeURIComponent(req.body.state || '');
  const codeChallenge = decodeURIComponent(req.body.code_challenge || '');
  const codeChallengeMethod = decodeURIComponent(req.body.code_challenge_method || '');

  if (!apiKey) {
    res.status(400).send('Missing API key. Please go back and enter your key.');
    return;
  }

  const user = await verifyTokenDirectly(apiKey);
  if (!user) {
    res.status(401).send(`
      <!DOCTYPE html><html><body style="background:#0d1117;color:#fff;font-family:sans-serif;padding:32px;text-align:center;">
        <h2 style="color:#ef4444;">Invalid AI Key</h2>
        <p style="color:#8b949e;">The provided key does not exist or has been revoked.</p>
        <a href="javascript:history.back()" style="color:#38bdf8;">Go back and try again</a>
      </body></html>
    `);
    return;
  }

  const code = 'ft_code_' + crypto.randomBytes(16).toString('hex');
  oauthAuthCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  res.redirect(target.toString());
});

/**
 * Token Endpoint: Exchanges authorization code for an OAuth access token
 */
app.post(['/token', '/oauth/token'], (req: Request, res: Response) => {
  const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;
  const authData = oauthAuthCodes.get(code);

  if (!authData || authData.expiresAt < Date.now()) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    return;
  }

  oauthAuthCodes.delete(code);

  const accessToken = 'ft_oauth_' + crypto.randomBytes(32).toString('hex');
  const refreshToken = 'ft_refresh_' + crypto.randomBytes(32).toString('hex');

  oauthAccessTokens.set(accessToken, {
    uid: authData.uid,
    email: authData.email,
    displayName: authData.displayName,
    expiresAt: Date.now() + 30 * 86400 * 1000, // 30 days
  });

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 2592000,
    refresh_token: refreshToken,
  });
});

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
app.all('/', (req: Request, res: Response) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (!acceptsHtml) {
    res.json({
      status: 'healthy',
      service: 'fintracker-mcp-server',
      version: '1.0.0',
      transport: 'SSE & Streamable HTTP',
      multiUserAuth: 'enabled',
      oauth: 'enabled',
      endpoints: {
        health: 'GET /health',
        sse: 'ALL /sse',
        mcp: 'ALL /mcp',
        oauthDiscovery: 'GET /.well-known/oauth-authorization-server',
        register: 'POST /oauth/register',
        authorize: 'GET /oauth/authorize',
        token: 'POST /oauth/token',
      },
      activeSessions: activeTransports.size,
    });
    return;
  }

  // If visited by a web browser, redirect directly to FinTracker app settings!
  res.redirect('https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp');
});

app.get('/connect', (_req: Request, res: Response) => {
  res.redirect('https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp');
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeSessions: activeTransports.size });
});

/**
 * Remote SSE & Streamable HTTP Endpoint:
 * Supports both /sse and /mcp paths for all AI clients
 */
app.all(['/sse', '/mcp'], authMiddleware, async (req: Request, res: Response) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  const userUid = req.authenticatedUser?.uid;
  console.log(`[MCP] Request (${req.method}) from authenticated user: ${userUid} (${req.authenticatedUser?.authType})`);

  if (req.method === 'POST') {
    // If request contains a sessionId, route to post message handler
    const sessionId = (req.query.sessionId as string) || (req.body?.sessionId as string);
    if (sessionId && activeTransports.has(sessionId)) {
      const session = activeTransports.get(sessionId)!;
      await session.transport.handlePostMessage(req, res);
      return;
    }

    // Health / Handshake check response for Streamable HTTP probes
    res.json({
      status: 'active',
      transport: 'streamable-http',
      user: userUid,
      message: 'FinTracker MCP endpoint is operational and authenticated',
    });
    return;
  }

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
  console.log(`  MCP Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`  OAuth Discovery: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  console.log('====================================================');
});
