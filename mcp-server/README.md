# 🚀 FinTracker MCP Server (Model Context Protocol)

A remote, cloud-deployable **Model Context Protocol (MCP)** server that connects AI assistants (Antigravity IDE, Claude Desktop, Cursor, Gemini) directly to your **FinTracker** personal finance database in Firebase Firestore.

---

## 🌟 Capabilities & Tools

The server equips your AI client with 8 specialized financial tools:

| Tool Name | Type | Description |
|---|---|---|
| `get_net_worth_overview` | **Read** | Calculates total net worth, invested capital, current valuation, liquid vs illiquid balance, profit/loss, and percentage breakdown across all asset classes. |
| `list_assets` | **Read** | Lists portfolio assets and holdings with optional filtering by `type` (Stock, MutualFund, FixedDeposit, Gold, Cash, etc.) or `isLiquid`. |
| `add_asset` | **Write** | Adds a new holding/investment (quantity, buy price, current price, currency, notes). |
| `update_asset_price` | **Write** | Updates market price and notes for an existing asset by ID. |
| `list_transactions` | **Read** | Queries transactions filtered by type (`Income`, `Expense`, `Buy`, `Sell`), category, bank, or date range. |
| `add_transaction` | **Write** | Records new income or expense transactions in Firestore with automatic category mapping. |
| `get_cashflow_summary` | **Read** | Computes monthly or yearly cashflow: total income, total expenses, net savings, savings rate (%), and top 5 expense categories. |
| `get_emergency_runway` | **Read** | Evaluates financial health: calculates exact runway in months by comparing liquid net worth (Cash + FDs) against recent average monthly burn rate. |

---

## 🔒 Security for Public GitHub Repositories

Because this repository is public, the server is built with zero-leak security:
1. **Zero Hardcoded Secrets**: All Firebase keys and authentication tokens are loaded exclusively from runtime environment variables.
2. **Bearer Token Authentication**: Every incoming remote request is authenticated via the `FINTRACKER_AUTH_TOKEN`. Unauthorized requests return `401 Unauthorized`.
3. **Strict `.gitignore`**: All local `.env` files and `*service-account*.json` keys are strictly blocked from git tracking.

---

## 📦 Local Quickstart & Testing

```bash
cd mcp-server
npm install
npm run build
```

### 1. Configure Local Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your `FINTRACKER_AUTH_TOKEN` and Firebase credentials.

### 2. Run the Remote SSE Server Locally
```bash
npm start
```
Visit `http://localhost:3000/` in your browser to verify the health check:
```json
{
  "status": "healthy",
  "service": "fintracker-mcp-server",
  "version": "1.0.0",
  "transport": "SSE (Server-Sent Events)"
}
```

### 3. Run in Local Stdio Mode
You can also run via stdio for direct local piping:
```bash
npm run start:stdio
```

---

## ☁️ Free Remote Deployment ($0 on Render.com)

See [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) for full step-by-step instructions with screenshots and configuration examples.
