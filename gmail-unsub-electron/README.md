# Gmail Unsubscriber — Electron App

A desktop app for Windows and Linux. Users install it and sign in with Google — no setup required on their end.

---

## For You (Developer) — One-Time Setup

### 1. Register your OAuth app on Google Cloud

1. Go to https://console.cloud.google.com
2. Create a project → **Enable the Gmail API**
3. **OAuth consent screen** → External → fill in app name, support email
   - Add scopes: `gmail.readonly`, `gmail.modify`, `userinfo.email`
   - **Publish the app** (click "Publish App" so any Google account can sign in)
   - If keeping in Testing mode, add specific test users instead
4. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Name: Gmail Unsubscriber
5. Copy the **Client ID** and **Client Secret**

### 2. Add credentials via environment variables

Create a `.env` file in the project root (or set system env vars):

```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

Never hardcode these in source files.

### 3. Install dependencies and build

```bash
npm install

# Build for both platforms:
npm run build:all

# Or individually:
npm run build:win    # → dist/Gmail Unsubscriber Setup 1.0.0.exe
npm run build:linux  # → dist/Gmail Unsubscriber-1.0.0.AppImage
                     # → dist/gmail-unsubscriber_1.0.0_amd64.deb
```

Built installers appear in the `dist/` folder.

---

## For End Users

### Windows
1. Download `Gmail Unsubscriber Setup 1.0.0.exe`
2. Double-click → installs silently → app opens
3. Click **Sign in with Google** → browser opens → approve → done

### Linux (AppImage)
```bash
chmod +x "Gmail Unsubscriber-1.0.0.AppImage"
./"Gmail Unsubscriber-1.0.0.AppImage"
```

### Linux (Debian/Ubuntu)
```bash
sudo dpkg -i gmail-unsubscriber_1.0.0_amd64.deb
gmail-unsubscriber
```

---

## How it works

| Step | What happens |
|------|-------------|
| Sign in | Opens Google's OAuth page in your browser — we never see your password |
| Scan | Reads up to 500 inbox emails (metadata/headers only) via Gmail API |
| Select | Groups by sender, detects List-Unsubscribe headers, flags banking senders |
| Confirm | Shows full summary before any action |
| Execute | Fires unsubscribe requests in batches: RFC 8058 → HTTP → mailto → body link |

## Security

- OAuth token stored encrypted in your OS app-data folder (never on a server)
- No telemetry, no analytics, no remote servers
- Open source — all logic is in `src/main.js` and `src/index.html`

---

## Dev mode

```bash
npm install
npm run dev     # opens app with DevTools attached
```

## Project structure

```
gmail-unsub-electron/
├── src/
│   ├── main.js        ← Electron main process + Gmail API logic
│   ├── preload.js     ← Secure IPC bridge
│   └── index.html     ← Full UI (no framework, no build step)
├── assets/
│   ├── icon.png       ← 256×256 PNG app icon
│   └── icon.ico       ← Windows ICO icon
├── package.json
└── README.md
```

## Adding app icons

Place your icon files in `assets/`:
- `icon.png` — 256×256 or 512×512 PNG (Linux + macOS)
- `icon.ico` — Windows ICO (multi-size, 16/32/48/256px)

Free icon generators: https://icoconvert.com / https://www.img2go.com/convert-to-ico
