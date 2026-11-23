# Agent & Developer Guidelines: Finance Tracker

## ⚠️ CRITICAL RULE: STRICT DATA SEPARATION & TESTING POLICY

> **NEVER test, seed, authenticate with, or run test operations against `dineshmurugan518@gmail.com`!**

### 1. Personal Production Data vs Test Data
* **Real Personal Account**: The email `dineshmurugan518@gmail.com` is the developer's **real personal production account** containing actual private financial records, real portfolio holdings, and live transaction histories.
* **No Test Operations**: Under no circumstances should test fixtures, dummy assets, simulated CAS statements, mock transactions, or automated integration tests ever be executed against or injected into this account.

### 2. Permitted Test Email Accounts
For all automated testing, manual feature verification, statement import simulations, unit tests, and MCP server queries, always use mock or dedicated test emails, such as:
* `test.user@example.com`
* `demo.portfolio@example.com`
* `investor@example.com`
* `tester@financetracker.dev`
* Any custom placeholder email (e.g., `user_<random>@test.local`)

### 3. Verification & Mocking Standard
* When writing or running tests, mock the authentication state (`AuthService.currentUser`) with dummy UIDs and test emails.
* In statement parser test components (e.g., `cas-parser-test`), ensure sample investor records continue using dummy emails (`investor@example.com`).
* When issuing MCP tool commands or testing remote MCP endpoints, use generated test keys or mock sessions, never the personal production user session.
