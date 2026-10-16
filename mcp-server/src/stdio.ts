import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFinTrackerMcpServer } from './server.js';

dotenv.config();

async function runStdioServer() {
  const server = createFinTrackerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP Stdio] FinTracker MCP Server running via stdio transport.');
}

runStdioServer().catch((err) => {
  console.error('[MCP Stdio] Fatal server error:', err);
  process.exit(1);
});
