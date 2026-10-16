# 🚀 FinTracker MCP Server (Model Context Protocol)

A remote, cloud-deployable **Model Context Protocol (MCP)** server that connects AI assistants (Antigravity IDE, Claude Desktop, Cursor) directly to your **FinTracker** personal finance database in Firebase Firestore with **isolated multi-user authentication**.

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

## 🔒 Multi-Tenant Security & Isolation

1. **Personal User Keys**: Each user generates a private, cryptographically strong key (`ft_mcp_<uid>_<secret>`) directly inside the FinTracker app under **Settings → AI & MCP**.
2. **Hermetic Session Scoping**: The MCP server extracts the caller's verified `uid` and restricts all 8 financial tools exclusively to that user's Firestore records. No user can ever query or tamper with another user's data.
3. **Zero Hardcoded Secrets**: All Firebase keys are loaded exclusively from runtime environment variables.
4. **Strict `.gitignore`**: All local `.env` files and `*service-account*.json` keys are strictly blocked from git tracking.

---

## 📦 Local Quickstart & Testing

```bash
cd mcp-server
npm install
npm run build
```

### Run Server Locally
```bash
npm start
```
Visit `http://localhost:3000/` in your browser. It automatically redirects to your FinTracker web app login!

---

## ☁️ Remote Cloud Deployment (Render.com)

Live Production URL: **`https://finance-tracker-vczn.onrender.com`**

See [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) for full step-by-step instructions on deploying the server for $0/month on Render.com with only 3 environment variables.
