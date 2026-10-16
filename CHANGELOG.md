# FinTracker Changelog & Release Notes

All notable changes to the **FinTracker** platform, Model Context Protocol (MCP) server, and developer tooling are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-15

### 🚀 Model Context Protocol (MCP) Server & AI Automation
- **Autonomous AI Intelligence Engine**: Launched remote-ready Model Context Protocol (MCP) server under [`mcp-server/`](https://github.com/PDineshMurugan/finance-tracker/tree/master/mcp-server) allowing AI clients (**Google Antigravity**, **Claude Desktop**, **Cursor**, **Windsurf**) to query private wealth metrics, calculate runway, and inspect portfolios.
- **Dual Transport Protocols**:
  - **Remote HTTP SSE** (`/sse` & `/messages`) for zero-cost cloud deployment on Render, Railway, Fly.io, and container runtimes.
  - **Local Stdio Transport** (`node dist/index.js --stdio`) for private, offline command-line and desktop AI tooling.
- **8 Core Financial Tools**:
  | Tool Name | Scope | Capability |
  | :--- | :--- | :--- |
  | `get_portfolio_summary` | Portfolio | Net worth, total invested capital, unrealized P&L, asset distribution |
  | `list_assets` | Assets | Real-time holding balances with filtering by asset category |
  | `get_asset_details` | Assets | Deep dive into symbol holding, purchase history, and unrealized returns |
  | `list_transactions` | Ledger | Paginated transaction history with buy/sell/dividend/deposit filters |
  | `get_financial_health` | Intelligence | Emergency fund ratio, monthly runway months, and debt metrics |
  | `get_monthly_analytics` | Intelligence | Granular monthly cashflow, savings rate, and inflow/outflow breakdown |
  | `get_net_worth_trend` | Portfolio | Historical daily/monthly net worth progression curves |
  | `query_wealth_data` | Natural Language | Free-form natural language queries parsed against user financial records |
- **Enterprise Security & Scoping**:
  - Bearer Token authentication via Firebase Admin SDK.
  - Multi-tenant data segregation ensuring AI agents can only access records strictly belonging to the authenticated user ID.
  - Environment variable scaffolding with zero-credential leaks ([`.env.example`](https://github.com/PDineshMurugan/finance-tracker/blob/master/mcp-server/.env.example)).
  - Remote deployment automation guide ([`DEPLOY_GUIDE.md`](https://github.com/PDineshMurugan/finance-tracker/blob/master/mcp-server/DEPLOY_GUIDE.md)) for free-tier cloud deployment with Health Check keep-alive cron.

---

### 🎨 Developer Portal & Interactive Reference (`/docs`)
- **Public API & MCP Portal**: Added a dedicated, high-contrast industrial developer documentation portal available at [`/docs`](https://fintracker.web.app/docs).
- **Client Quick-Connect Guides**: 1-click configuration templates for **Google Antigravity** (`mcp_config.json`), **Claude Desktop** (`claude_desktop_config.json`), and **Cursor AI** (`mcp.json`).
- **Interactive Tool Explorer**:
  - Real-time tool search by name, description, or parameter.
  - Instant category filtering (`All`, `Portfolio`, `Assets`, `Transactions`, `Analytics`).
  - 1-click natural language prompt copy button for quick prompt generation.
  - Dynamic JSON-RPC 2.0 request/response previews.
- **Lightweight Architecture**: Reduced documentation chunk bundle by ~13 kB through schema refactoring and eliminated internal architecture dumps for third-party consumers.

---

### ⚡ Fluid Theme View Transition Engine
- **GPU-Accelerated Circular Ripple**: Engineered a custom theme transition engine in [`ThemeService`](https://github.com/PDineshMurugan/finance-tracker/blob/master/src/app/services/theme.service.ts) using the native `document.startViewTransition()` API with Web Animations clip-path interpolation.
- **Zero Stagger & Eliminated Flickering**:
  - Eliminated conflicting CSS transition timers where outer layouts (`0.3s–0.5s`) and inner cards (`0s–0.1s`) updated out of phase.
  - Added snapshot suppression classes (`html.theme-transitioning`) so the browser captures pristine snapshots of both themes before expanding the circular ripple.
  - Built a synchronized fallback (`html.theme-fade-transition`) ensuring browsers without View Transitions transition all elements in complete lockstep.

---

### 📊 "Reality Check" Financial Quotes Engine
- **Expanded Negative Return Tiers**: Added 114+ new loss quotes across 6 granular drawdown tiers in [`src/assets/quotes.json`](https://github.com/PDineshMurugan/finance-tracker/blob/master/src/assets/quotes.json):
  - `negative_100_extra` (🪦): Total capital loss (−100%)
  - `negative_70_to_99_extra` (☠️): Catastrophic drawdown (−70% to −99%)
  - `negative_50_to_70_extra` (🕳️): Deep drawdown (−50% to −70%)
  - `negative_20_to_50_extra` (💀): Heavy correction (−20% to −50%)
  - `negative_10_to_20_extra` (⚰️): Moderate correction (−10% to −20%)
  - `negative_5_to_10_extra` (🪦): Minor drawdown (−5% to −10%)
  - `negative_small_-1_to_-5_extra` (😵): Surface noise (−0.01% to −5%)
- **Dynamic Portfolio Evaluator**: Refactored [`DashboardComponent.dailyQuote`](https://github.com/PDineshMurugan/finance-tracker/blob/master/src/app/features/dashboard/dashboard.component.ts) computed signal to dynamically map the full spectrum of portfolio return percentages to matching icons and quotes with interactive refresh cycling.

---

### 🛡️ SEO & Routing
- Added canonical URL indexing and OpenGraph cards for the documentation portal.
- Registered `/docs` within [`public/sitemap.xml`](https://github.com/PDineshMurugan/finance-tracker/blob/master/public/sitemap.xml).
- Added routing bypass rules in Service Worker to allow instant access to dynamic developer resources.

---

## [0.0.21] - 2026-10-14
### Added
- Core finance tracking application models and state management interfaces.
- Net worth calculation engine with USD/INR real-time FX rate conversion via Google Finance.
- Transaction categorization engine (Equity, Mutual Funds, Real Estate, Crypto, Gold, Fixed Deposits).

---

## [0.0.18 - 0.0.20] - 2026-10-12
### Added
- AI Financial Advisory integration with Google Gemini API for personalized portfolio insights.
- Dynamic Chart Builder supporting custom timeframe comparisons and asset distribution overlays.
- Top navigation toolbar with quick balance conceal toggle and profile management.

---

## [0.0.12 - 0.0.17] - 2026-10-08
### Added
- Real-time market data service with proxy and fallback handlers for NSE, BSE, and US tickers.
- Bulk portfolio CSV import parser supporting Groww and INDmoney exported ledger formats.
- Offline-first IndexedDB caching layer for uninterrupted access during network drops.

---

## [0.0.5 - 0.0.11] - 2026-09-28
### Added
- Progressive Web App (PWA) manifest and Service Worker caching strategies.
- Biometric & numeric PIN authentication with automatic lock-out timers.
- Firebase Authentication supporting Google OAuth and email credential flows.
- GitHub Actions automated CI/CD pipeline for automated Firebase Hosting deployments.

---

## [0.0.1 - 0.0.4] - 2026-09-15
### Added
- Initial project architecture scaffolding utilizing Angular 20 standalone components and SCSS design tokens.
- High-contrast black & white minimalist aesthetic foundations.
