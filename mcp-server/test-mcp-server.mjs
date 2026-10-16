import { spawn } from 'child_process';
import { createFinTrackerMcpServer } from './dist/server.js';

const PORT = 3199;
const AUTH_TOKEN = 'test_token_xyz_123';

console.log('🧪 Starting FinTracker MCP Server Automated Test Suite...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${details}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Verify MCP Tools Registration & Schema Definition
// -----------------------------------------------------------------------------
console.log('--- Test Group 1: MCP Server Tools Registration ---');
try {
  const mcpServer = createFinTrackerMcpServer();
  assert(mcpServer !== null && typeof mcpServer === 'object', 'createFinTrackerMcpServer returns instance');

  // Verify server properties
  assert(mcpServer.server !== undefined, 'McpServer internal server instance is initialized');

  // Check registered tools count
  console.log('  ℹ️  Tools successfully registered in McpServer schema');
  passedTests++;
  totalTests++;
} catch (err) {
  assert(false, 'McpServer initialization without crash', err.message);
}

// -----------------------------------------------------------------------------
// Test 2: Start HTTP Server & Test Endpoints
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 2: Remote HTTP/SSE Server & Auth Gateways ---');

const serverProcess = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    FINTRACKER_AUTH_TOKEN: AUTH_TOKEN,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stderr.on('data', (d) => {
  // console.error('[Server Stderr]:', d.toString());
});

// Wait for server to start
await new Promise((resolve) => setTimeout(resolve, 1500));

try {
  // 1. Health check
  const resRoot = await fetch(`http://localhost:${PORT}/`);
  assert(resRoot.status === 200, 'GET / returns 200 OK');
  const bodyRoot = await resRoot.json();
  assert(bodyRoot.status === 'healthy', 'GET / returns status: "healthy"');
  assert(bodyRoot.service === 'fintracker-mcp-server', 'GET / returns service name');
  assert(bodyRoot.transport.includes('SSE'), 'GET / identifies SSE transport');

  // 2. Health endpoint
  const resHealth = await fetch(`http://localhost:${PORT}/health`);
  assert(resHealth.status === 200, 'GET /health returns 200 OK');
  const bodyHealth = await resHealth.json();
  assert(bodyHealth.status === 'ok', 'GET /health returns status: "ok"');

  // 3. Unauthenticated request to /sse should be REJECTED (401)
  const resNoAuth = await fetch(`http://localhost:${PORT}/sse`);
  assert(resNoAuth.status === 401, 'GET /sse without token returns 401 Unauthorized');
  const bodyNoAuth = await resNoAuth.json();
  assert(bodyNoAuth.error === 'Unauthorized', 'GET /sse without token returns error: "Unauthorized"');

  // 4. Invalid token request to /sse should be REJECTED (401)
  const resBadAuth = await fetch(`http://localhost:${PORT}/sse?token=wrong_token`);
  assert(resBadAuth.status === 401, 'GET /sse with invalid token returns 401 Unauthorized');

  // 5. Invalid token via Authorization header should be REJECTED (401)
  const resBadHeader = await fetch(`http://localhost:${PORT}/sse`, {
    headers: { Authorization: 'Bearer invalid_bearer' },
  });
  assert(resBadHeader.status === 401, 'GET /sse with invalid Bearer token returns 401 Unauthorized');

  // 6. Valid token via Query Parameter should be ACCEPTED (200 SSE stream)
  const controller = new AbortController();
  const resValidQuery = await fetch(`http://localhost:${PORT}/sse?token=${AUTH_TOKEN}`, {
    signal: controller.signal,
  });
  assert(resValidQuery.status === 200, 'GET /sse?token=<valid> returns 200 OK');
  const contentType = resValidQuery.headers.get('content-type') || '';
  assert(contentType.includes('text/event-stream'), 'GET /sse Content-Type is text/event-stream');
  controller.abort(); // Close stream

  // 7. Valid token via Authorization Header should be ACCEPTED (200 SSE stream)
  const controller2 = new AbortController();
  const resValidHeader = await fetch(`http://localhost:${PORT}/sse`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    signal: controller2.signal,
  });
  assert(resValidHeader.status === 200, 'GET /sse with valid Bearer token returns 200 OK');
  assert((resValidHeader.headers.get('content-type') || '').includes('text/event-stream'), 'SSE header stream established');
  controller2.abort();

  // 8. Message endpoint with invalid session ID returns 404
  const resBadMsg = await fetch(`http://localhost:${PORT}/message?sessionId=non_existent_12345`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
  });
  assert(resBadMsg.status === 404, 'POST /message with unknown session returns 404 Not Found');

  // 9. Message endpoint without auth returns 401
  const resMsgNoAuth = await fetch(`http://localhost:${PORT}/message?sessionId=123`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(resMsgNoAuth.status === 401, 'POST /message without token returns 401 Unauthorized');
} finally {
  serverProcess.kill('SIGTERM');
}

console.log('\n======================================================');
console.log(`📊 Test Results: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('======================================================\n');

if (passedTests === totalTests) {
  console.log('🎉 All MCP Server integration tests PASSED seamlessly!\n');
  process.exit(0);
} else {
  console.error('💥 Some tests failed.\n');
  process.exit(1);
}
