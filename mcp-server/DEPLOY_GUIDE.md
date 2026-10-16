# 🌐 Remote Deployment Guide ($0 on Render.com)

This step-by-step guide walks you through deploying your **FinTracker MCP Server** to **Render.com** on their 100% free web service tier with bank-grade multi-user authentication.

---

## Architecture & Security Model

The MCP server implements **isolated multi-tenant security**:
* **Zero Shared Passwords Needed**: Each user (you and your friends) generates their own private, cryptographically secure key (`ft_mcp_<uid>_<secret>`) directly inside the FinTracker web app.
* **Hermetic User Isolation**: The MCP server verifies every request against Firestore and binds each session exclusively to that caller's UID. User A can never read or modify User B's portfolio.
* **Automatic Browser Redirection**: Visiting the server's root URL in a web browser automatically redirects you to `https://dmfintracker.web.app/login?redirect=/app/settings?tab=mcp`.

---

## Prerequisites (Gather Your Credentials)

You only need **one thing**: your Firebase Admin Service Account credentials.

### 1. Get Your Firebase Admin Service Account (Free)
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your FinTracker project (`dm-finance-tracker`).
3. Click the **Gear icon (Project settings)** in the top-left sidebar.
4. Go to the **Service accounts** tab.
5. Click **Generate new private key**, then click **Generate key**.
6. A JSON file will download. Open it in a text editor to see:
   - `project_id`: `dm-finance-tracker`
   - `client_email`: `firebase-adminsdk-xxxxx@dm-finance-tracker.iam.gserviceaccount.com`
   - `private_key`: `"-----BEGIN PRIVATE KEY-----\nMIIEvgIBA...-----END PRIVATE KEY-----\n"`

> ⚠️ **IMPORTANT**: Never commit this downloaded JSON file to GitHub! Keep it private.

---

## Deploying to Render.com (3 Minutes)

### Step 1: Push Changes to GitHub
Make sure your changes are committed and pushed to your GitHub repository:
```bash
git add .
git commit -m "feat(mcp): add multi-user authentication and settings UI"
git push origin master
```

---

### Step 2: Create a New Web Service on Render
1. Go to [Render.com](https://render.com/) and sign in with GitHub.
2. On your Render dashboard, click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository**, click **Next**.
4. Choose your `finance-tracker` repository.

---

### Step 3: Configure the Web Service
Fill in the following settings:

| Setting | Value | Description |
|---|---|---|
| **Name** | `finance-tracker-mcp` | *(Or your preferred service name)* |
| **Region** | `Singapore (Southeast Asia)` | Closest region for low latency |
| **Branch** | `master` | Target deployment branch |
| **Root Directory** | `mcp-server` | ⚠️ **Crucial**: Tells Render to build from the subfolder |
| **Runtime** | `Node` | Node.js runtime |
| **Build Command** | `npm install && npm run build` | Builds TypeScript server |
| **Start Command** | `npm start` | Launches HTTP & SSE server |
| **Instance Type** | `Free` ($0/month) | 100% free web service tier |

---

### Step 4: Add Environment Variables
Scroll down to the **Environment Variables** section and add the **3 Firebase variables** from your downloaded service account JSON:

| Key | Value | Description |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `dm-finance-tracker` | Your Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | *Your service account client email* | From your downloaded JSON file |
| `FIREBASE_PRIVATE_KEY` | *Your service account private key* | Include the full string with `-----BEGIN PRIVATE KEY-----` |

*(Note: Render accepts the private key with standard newlines or with `\n` — both work seamlessly!)*

> 🔒 **Security Notice:** You do **not** need `DEFAULT_USER_UID` or `FINTRACKER_AUTH_TOKEN`. Leaving them empty runs the server in pure multi-tenant mode where every user must authenticate with their own personal key from the app!

---

### Step 5: Click Deploy
1. Click **Deploy Web Service** at the bottom of the page.
2. Render will build and launch your server in ~2 minutes.
3. Once finished, you will see a green **Live** badge with your public URL:
   ```text
   https://finance-tracker-vczn.onrender.com
   ```

---

## Generating Your AI Key & Connecting

### Step 1: Generate Your Personal Key
1. Open the FinTracker app: [https://dmfintracker.web.app](https://dmfintracker.web.app)
2. Sign in with your account.
3. Go to **Settings** → **AI & MCP** (`/app/settings?tab=mcp`).
4. Click **Generate Personal AI Key**.
5. Your private key (`ft_mcp_<uid>_<secret>`) will be generated instantly.

---

### Step 2: Connect to Your AI Clients

The settings page provides 1-click copy buttons for your preferred AI tool:

#### Claude.ai & ChatGPT Web (Custom Connector)
* **Connector Name:** `Finance Tracker`
* **Remote MCP URL:** `https://finance-tracker-vczn.onrender.com/sse` *(or `/mcp`)*
* **Authentication:** `OAuth 2.0 / 2.1 (Automated Dynamic Client Registration)`
* **Steps:**
  1. In Claude.ai or ChatGPT, open **Connectors** &rarr; **Add custom connector**.
  2. Enter name `Finance Tracker` and URL `https://finance-tracker-vczn.onrender.com/sse`.
  3. Click **Continue**, then click **Connect**.
  4. In the authorization window that appears, paste your **Personal AI Key** and click **Authorize & Connect**!

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "fintracker": {
      "url": "https://finance-tracker-vczn.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_AI_KEY"
      }
    }
  }
}
```

#### Antigravity IDE (`mcp_config.json`)
```json
{
  "mcpServers": {
    "fintracker": {
      "url": "https://finance-tracker-vczn.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_AI_KEY"
      }
    }
  }
}
```

#### Cursor / Windsurf
* **Name:** `fintracker`
* **Type:** `sse`
* **URL:** `https://finance-tracker-vczn.onrender.com/sse?token=YOUR_PERSONAL_AI_KEY`

---

## 🎉 You're Done!

Now you and any of your friends can ask your AI assistants:
- *"What is my total net worth right now?"*
- *"Show my asset allocation breakdown across stocks and FDs."*
- *"How much did I spend on food this month?"*
- *"Add an expense of ₹450 for coffee using HDFC."*
- *"What is my emergency runway in months?"*
