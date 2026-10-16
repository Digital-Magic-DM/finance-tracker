# 🌐 Remote Deployment Guide ($0 on Render.com)

This step-by-step guide walks you through deploying your **FinTracker MCP Server** to **Render.com** on their 100% free web service tier.

---

## Prerequisites (Gather Your Credentials)

### 1. Generate an Authentication Token
Pick or generate a strong random secret passphrase. For example:
```bash
# In terminal:
openssl rand -hex 24
# Or any secure random string like:
fintracker_mcp_sec_8f93b1a20c74de5f68a
```
Save this string — this is your `FINTRACKER_AUTH_TOKEN`.

---

### 2. Get Your Firebase Admin Service Account (Free)
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your FinTracker project (`dm-finance-tracker`).
3. Click the **Gear icon (Project settings)** in the top-left sidebar.
4. Go to the **Service accounts** tab.
5. Click **Generate new private key**, then click **Generate key**.
6. A JSON file will download. Open it in a text editor to see:
   - `project_id`: (e.g. `dm-finance-tracker`)
   - `client_email`: (e.g. `firebase-adminsdk-xxxxx@dm-finance-tracker.iam.gserviceaccount.com`)
   - `private_key`: (e.g. `"-----BEGIN PRIVATE KEY-----\nMIIEvgIBA...-----END PRIVATE KEY-----\n"`)

> ⚠️ **IMPORTANT**: Never commit this downloaded JSON file to GitHub!

---

### 3. Get Your FinTracker User UID
1. In the Firebase Console, navigate to **Authentication** -> **Users**.
2. Copy your User UID (a string like `a1B2c3D4e5F6g7H8...`).
3. This is your `DEFAULT_USER_UID`.

---

## Deploying to Render.com (3 Minutes)

### Step 1: Push Changes to GitHub
Make sure your changes are committed and pushed to your GitHub repository:
```bash
git add mcp-server .gitignore
git commit -m "feat(mcp): add FinTracker remote MCP server"
git push origin master
```

---

### Step 2: Create a New Web Service on Render
1. Go to [Render.com](https://render.com/) and sign in (or create a free account with GitHub).
2. On your Render dashboard, click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository**, click **Next**.
4. Choose your `finance-tracker` repository.

---

### Step 3: Configure the Web Service
Fill in the following settings:

| Setting | Value |
|---|---|
| **Name** | `fintracker-mcp` (or any name you prefer) |
| **Region** | Choose the closest region (e.g., Singapore, Frankfurt, Oregon) |
| **Branch** | `master` (or `main`) |
| **Root Directory** | `mcp-server` *(Critical: points Render to the server subfolder)* |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` ($0/month) |

---

### Step 4: Add Environment Variables
Scroll down to the **Environment Variables** section and click **Add Environment Variable** for each:

| Key | Value | Description |
|---|---|---|
| `FINTRACKER_AUTH_TOKEN` | *Your secret token from Step 1* | Protects your remote endpoint |
| `DEFAULT_USER_UID` | *Your Firebase user UID from Step 3* | Default user profile to query |
| `FIREBASE_PROJECT_ID` | `dm-finance-tracker` | Your Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | *Your service account client email* | From your service account JSON |
| `FIREBASE_PRIVATE_KEY` | *Your service account private key* | Include the full string with `-----BEGIN PRIVATE KEY-----` |

*(Note: In Render's dashboard, you can paste the private key directly with standard newlines or with `\n` — Render handles both!)*

---

### Step 5: Click Deploy
1. Click **Deploy Web Service** at the bottom of the page.
2. Render will clone the repo, run `npm install && npm run build`, and launch the server.
3. Once finished, you will see a green **Live** badge with your public URL:
   ```text
   https://fintracker-mcp.onrender.com
   ```

---

## Verifying Your Remote MCP Server

Open your browser or run curl to test the public health check:
```bash
curl https://fintracker-mcp.onrender.com/
```
Expected Response:
```json
{
  "status": "healthy",
  "service": "fintracker-mcp-server",
  "version": "1.0.0",
  "transport": "SSE (Server-Sent Events)"
}
```

If you query `/sse` without the token:
```bash
curl https://fintracker-mcp.onrender.com/sse
```
Expected Response:
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid authentication token."
}
```

---

## Connecting to Your AI Clients

### 1. Antigravity IDE / Claude Desktop
Add this to your MCP configuration file (e.g. `~/.gemini/antigravity-ide/mcp_config.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fintracker": {
      "url": "https://fintracker-mcp.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_TOKEN_HERE"
      }
    }
  }
}
```

*Or via query parameter (if headers are not supported by the client):*
```json
{
  "mcpServers": {
    "fintracker": {
      "url": "https://fintracker-mcp.onrender.com/sse?token=YOUR_SECRET_TOKEN_HERE"
    }
  }
}
```

---

## 🎉 You're Done!

Now in your AI assistant, you can type:
- *"What is my total net worth right now?"*
- *"Show my asset allocation breakdown across stocks and FDs."*
- *"How much did I spend on groceries this month?"*
- *"Add an expense of ₹650 for dinner at Swiggy using HDFC."*
- *"What is my emergency runway in months?"*
