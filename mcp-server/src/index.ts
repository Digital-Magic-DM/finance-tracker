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

  // If visited by a web browser, redirect directly to the FinTracker app settings!
  res.redirect('https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp');
});

app.get('/connect', (_req: Request, res: Response) => {
  res.redirect('https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp');
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeSessions: activeTransports.size });
});

/**
 * Remote SSE Endpoint: Connects AI clients via streaming SSE with session-specific user UID
 * Supports both /sse and /mcp paths (used by Claude.ai custom connectors)
 */
app.get(['/sse', '/mcp'], authMiddleware, async (req: Request, res: Response) => {
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
