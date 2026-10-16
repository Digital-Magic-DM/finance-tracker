import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createFinTrackerMcpServer } from './server.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for web-based or external clients
app.use(cors());

// Map of active SSE client transports by sessionId
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Authentication Middleware: Protects endpoints on public web deployments.
 * Supports "Authorization: Bearer <token>" header or "?token=<token>" query parameter.
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.FINTRACKER_AUTH_TOKEN;

  // If no auth token is configured, log a warning but allow for zero-config local prototyping
  if (!expectedToken) {
    console.warn(
      '[MCP Security Warning] FINTRACKER_AUTH_TOKEN is not set in environment! Requests are currently unauthenticated.'
    );
    return next();
  }

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const queryToken = (req.query.token as string) || (req.query.apiKey as string);

  const providedToken = bearerToken || queryToken;

  if (!providedToken || providedToken !== expectedToken) {
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'Missing or invalid authentication token. Provide Authorization: Bearer <token> header or ?token=<token> in the URL.',
    });
    return;
  }

  next();
}

/**
 * Public Health Check (Render.com and uptime monitoring services use this)
 */
app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'fintracker-mcp-server',
    version: '1.0.0',
    transport: 'SSE (Server-Sent Events)',
    endpoints: {
      health: 'GET /',
      sse: 'GET /sse',
      message: 'POST /message?sessionId=<sessionId>',
    },
    activeSessions: activeTransports.size,
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * Remote SSE Endpoint: Connects AI clients (Claude, Antigravity, Cursor) via streaming SSE
 */
app.get('/sse', authMiddleware, async (_req: Request, res: Response) => {
  console.log('[MCP] New incoming SSE connection request...');

  try {
    const server = createFinTrackerMcpServer();
    const transport = new SSEServerTransport('/message', res);

    activeTransports.set(transport.sessionId, transport);
    console.log(`[MCP] Session created: ${transport.sessionId} (Total active: ${activeTransports.size})`);

    res.on('close', () => {
      activeTransports.delete(transport.sessionId);
      console.log(`[MCP] Session closed: ${transport.sessionId} (Total active: ${activeTransports.size})`);
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
 * Message Endpoint: Handles JSON-RPC requests sent by the connected SSE client
 */
app.post('/message', authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).send('Missing "sessionId" query parameter');
    return;
  }

  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).send(`Session with ID "${sessionId}" not found or expired`);
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
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
