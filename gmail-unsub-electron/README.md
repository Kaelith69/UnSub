# Gmail Unsubscriber

<svg width="100%" viewBox="0 0 960 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gmail Unsubscriber banner">
   <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="#0b1220" />
         <stop offset="100%" stop-color="#1c2942" />
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
         <stop offset="0%" stop-color="#34d399" />
         <stop offset="100%" stop-color="#60a5fa" />
      </linearGradient>
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
         <feGaussianBlur stdDeviation="3" result="blur"/>
         <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
         </feMerge>
      </filter>
   </defs>

   <rect x="0" y="0" width="960" height="240" rx="18" fill="url(#bg)"/>
   <rect x="24" y="24" width="912" height="192" rx="14" fill="none" stroke="url(#accent)" stroke-opacity="0.45"/>

   <circle cx="120" cy="120" r="42" fill="#111827" stroke="#34d399" stroke-width="2" filter="url(#softGlow)">
      <animate attributeName="r" values="40;42;40" dur="3.2s" repeatCount="indefinite"/>
   </circle>
   <text x="120" y="128" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="28" fill="#e5e7eb">0xU</text>

   <text x="200" y="105" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="46" font-weight="700" fill="#f9fafb">Gmail Unsubscriber</text>
   <text x="200" y="145" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="22" fill="#cbd5e1">Clean your inbox like a machine</text>

   <rect x="200" y="166" width="340" height="6" rx="3" fill="url(#accent)">
      <animate attributeName="width" values="210;340;210" dur="2.8s" repeatCount="indefinite"/>
   </rect>
</svg>

## 1. Project Overview

Inbox chaos is real. This app gives you a deterministic unsubscribe workflow without sending your mail data to some random cloud backend.

### 🚀 Quick Start

```bash
# 1. Clone & install
git clone https://github.com/Kaelith69/UnSub.git && cd UnSub && npm install

# 2. Get OAuth credentials (Google Cloud Console)
# See "Step 1: Google OAuth Setup" below

# 3. Create .env from template
cp .env.example .env
# Edit .env and add your client ID & secret

# 4. Run locally
npm run dev
```

**Full setup instructions below** ⬇️

---

## 2. Why It Exists

- Newsletters multiply faster than tabs in a weekend debug session
- Gmail UI is great, but not optimized for bulk unsubscribe triage
- You should be able to clean up at scale without sacrificing privacy
- Subscription cleanup should be transparent, reversible where possible, and fast

## 3. Key Idea

- Authenticate once with Google OAuth
- Scan inbox metadata safely and incrementally
- Group by sender and detect unsubscribe mechanisms
- Execute unsubscribe in controlled batches with progress and fallbacks

## 4. Features

- Gmail OAuth login: Secure browser-based OAuth flow with token lifecycle handling
- Inbox scanning: Incremental Gmail pagination with progress updates
- Subscription detection: List-Unsubscribe header + subject heuristics
- Sender grouping: Aggregates by sender for practical decision making
- Bulk unsubscribe: Batched unsubscribe execution with retries and status reporting
- Local processing: Runs on-device with no remote analytics backend

## 5. Demo Flow

1. Sign in with Google
2. Scan inbox (select scan depth)
3. Review grouped senders
4. Select safe or custom targets
5. Execute unsubscribe and optional inbox cleanup

## 6. System Architecture

```mermaid
flowchart LR
   UI[Frontend<br/>Electron Renderer] --> IPC[IPC Bridge<br/>preload.js]
   IPC --> AUTH[Auth Module<br/>OAuth + Token Store]
   IPC --> SCAN[Processing Engine<br/>Scan + Grouping]
   AUTH --> GAPI[Gmail API]
   SCAN --> GAPI
   SCAN --> EXEC[Unsubscribe Executor]
   EXEC --> GAPI
   EXEC --> HTTP[HTTP Unsubscribe Endpoints]
```

## 7. Data Flow Diagram

```mermaid
flowchart TD
   U[User] --> A[Auth]
   A --> G[Gmail API]
   G --> P[Processing]
   P --> V[UI Sender View]
   V --> X[Unsubscribe Execution]
   X --> G
```

## 8. Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript (Electron renderer)
- Desktop runtime: Electron
- Main process: Node.js
- APIs: Gmail API via Google OAuth2
- Libraries:
  - googleapis
  - electron-store
  - cheerio
  - electron-builder

## 9. How It Works (Deep Dive)

### OAuth flow

1. Renderer calls auth IPC
2. Main process spins OAuth flow in browser
3. Callback exchanges code for tokens
4. Tokens stored locally (encrypted store)
5. Profile check validates session health

### Email fetching

- Uses Gmail pagination (messages list)
- Pulls only required fields for efficiency
- Processes incrementally to avoid full in-memory message loading

### Subscription detection logic

- Primary signal: List-Unsubscribe headers
- Secondary signal: subject/keyword heuristics
- Sender risk classification flags likely important senders

### Unsubscribe execution

Execution order is deliberate:

1. RFC 8058 one-click POST (best when available)
2. Header/body HTTP unsubscribe links
3. Mailto fallback (queued, delivery not guaranteed)

Plus:

- Retries with exponential backoff for transient failures
- Optional inbox cleanup (move matching messages to Trash)
- Detailed per-sender progress and outcome reporting

## 10. Performance Strategy

- Batching: controlled promise pools for scan and execution
- Lazy/incremental processing: page-streamed scan pipeline
- Concurrency control: adaptive limits by scan size
- UI virtualization: large sender lists render only visible rows
- O(1) lookups: sender map indexing and filtered result caching

## 11. Privacy + Security

- **Local processing first:** No third-party analytics pipeline
- **Token handling:** Encrypted local persistence via `electron-store`
- **Secret hygiene:** OAuth credentials stored in `.env` file (git-ignored, never committed)
- **Network safety:** Unsubscribe URL validation blocks private/local IP targets
- **Environment-based config:** All sensitive values from env vars, not hardcoded
- **No plaintext commits:** Compatible with GitHub push protection

### Best Practices

1. Never share or commit `.env` file

```bash
# This should be in .gitignore (it is):
cat .gitignore
# Should show: .env
```

1. Use `.env.example` as a template for other developers

```bash
cp .env.example .env
# Then fill in your credentials
```

1. Rotate OAuth secrets periodically
   - Generate new credentials in Google Cloud Console
   - Update `.env` locally
   - Rebuild and redistribute

## 12. Setup Instructions

### Prerequisites

- Node.js 18+
- npm
- Google Cloud account (free tier available)

### Step 1: Google OAuth Setup (One-Time)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Create Project**
   - Project name: "Gmail Unsubscriber" (or your choice)
3. Select your project → **Enable APIs and Services**
4. Search for **Gmail API** → Click **Enable**
5. Go to **Credentials** in the left sidebar
   - Click **+ Create Credentials** → OAuth client ID
   - Choose **Desktop application**
   - Download the JSON file
   - Copy `client_id` and `client_secret` values
6. Configure OAuth consent screen:
   - Go to **OAuth consent screen**
   - Choose **External** user type
   - Add required Scopes:
     - `gmail.readonly`
     - `gmail.modify`
     - `userinfo.email`
   - Add test users if keeping in development mode

### Step 2: Clone & Install

```bash
git clone https://github.com/Kaelith69/UnSub.git
cd UnSub
npm install
```

### Step 3: Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your OAuth credentials
# GOOGLE_CLIENT_ID=your_client_id_from_step_1
# GOOGLE_CLIENT_SECRET=your_client_secret_from_step_1
```

**Important:** `.env` is in `.gitignore` and will never be committed.

### Step 4: Run Locally

```bash
npm run dev
```

The app will launch. Authenticate with your Google account on first run.

### Step 5: Build for Distribution

```bash
# Windows installer
npm run build:win

# Linux AppImage + deb
npm run build:linux

# Both
npm run build:all
```

Build outputs are in the `dist/` directory.

Build outputs are in the `dist/` directory.

| Output | Platform |
| --- | --- |
| `.exe` + installer | Windows |
| `.AppImage` | Linux (portable) |
| `.deb` | Linux (system package) |

## 13. Troubleshooting

### "OAuth client not configured" at startup

**Issue:** App shows "OAuth not configured"

**Fix:** Verify `.env` file exists in workspace root with valid credentials:

```bash
# Check file exists
ls -la .env  # or `dir .env` on Windows

# Verify content
cat .env
# Should show:
# GOOGLE_CLIENT_ID=abc123...
# GOOGLE_CLIENT_SECRET=xyz789...
```

### "Failed to fetch messages" / 403 Forbidden errors

**Issue:** Scan fails with permission errors

**Potential causes:**

1. OAuth consent screen not published (only test users can auth in dev mode)
   - **Fix:** Publish your OAuth app in Google Cloud Console
2. Gmail API not enabled
   - **Fix:** Verify in Google Cloud Console → APIs → Gmail API is enabled

### Unsubscribe "Mailto" emails return as read

**Issue:** Some unsubscribes open email draft that auto-marks as read

**Expected behavior:** Mailto unsubscribes are fallback only—try HTTP links first

**Mitigation:** Enable "optional cleanup" to move matching messages to Trash

### App crashes on large inbox scan

**Issue:** Scan fails or freezes on very large inboxes (100k+ messages)

**Diagnosis:**

```bash
# Run with performance logging enabled
npm run dev -- --dev
# Watch console for timing metrics
```

**Fix:** Reduce scan depth (select "Last 3 months" or "Last 1 month" from UI dropdown)

- AI prioritization for sender importance scoring
- Smart filters (frequency + intent + engagement)
- Lightweight analytics dashboard for cleanup sessions
- Better mailto outcome tracking and suppression policy tuning

## 14. Contributing

PRs are welcome. Keep changes focused and measurable.

Guidelines:

1. Open an issue with problem statement and expected behavior
2. Keep commits atomic and descriptive
3. Include validation notes (what changed, how it was tested)
4. Avoid introducing hardcoded secrets or local-only assumptions
5. Use environment variables for all configuration

## 15. License

This project is currently licensed under the **MIT License**.

See [LICENSE](./LICENSE) for details, or:

```text
MIT License - Free to use, modify, and distribute
Requires: Include copyright notice and license text
```

### Quick Summary

✅ You can use this for personal, commercial, or educational purposes  
✅ You can modify and redistribute  
✅ Include the license notice when distributing  
❌ No warranty provided
