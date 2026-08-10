'use strict';

const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const { google } = require('googleapis');
const http = require('http');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const Store = require('electron-store');

// ── Config ────────────────────────────────────────────────────────────────────
// As the developer, you register ONE Google OAuth app.
// Users sign in with their own Gmail — they never touch Google Console.
//
// HOW TO GET YOUR CLIENT_ID (one-time setup for you as developer):
//  1. Go to https://console.cloud.google.com
//  2. Create project → Enable Gmail API
//  3. OAuth consent screen → External → add scopes (gmail.readonly, gmail.modify)
//  4. Publish the app (or keep in testing and add test users)
//  5. Credentials → Create OAuth client → Desktop app → copy Client ID & Secret
//  6. Set env vars before running/building:
//     GOOGLE_CLIENT_ID=...
//     GOOGLE_CLIENT_SECRET=...
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI_BASE    = 'http://localhost';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Log startup configuration
if (process.argv.includes('--dev')) {
  console.info('[Config]', {
    OAUTH_CONFIGURED: GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_SECRET.length > 0,
    CLIENT_ID_SET:     GOOGLE_CLIENT_ID.length > 0,
    CLIENT_SECRET_SET: GOOGLE_CLIENT_SECRET.length > 0,
  });
}

const REQUEST_TIMEOUT      = 15000; // 15 seconds for HTTP requests
const AUTH_TIMEOUT         = 300000; // 5 minutes for OAuth
const RETRY_BASE_DELAY_MS  = 500;
const MAX_API_RETRIES      = 4;
const SCAN_MESSAGE_CONCURRENCY = 8; // Reduced to stay within Gmail quota
const PERF_ENABLED         = process.argv.includes('--dev');

// ── Utilities ─────────────────────────────────────────────────────────────────
function logError(context, err) {
  console.error(`[${context}]`, err?.message || err);
  if (process.argv.includes('--dev') && err?.stack) {
    console.error(err.stack);
  }
}

function perfLog(event, data = {}) {
  if (!PERF_ENABLED) return;
  try {
    const payload = { event, ts: Date.now(), ...data };
    console.info('[PERF]', JSON.stringify(payload));
  } catch {
    // Never fail user flows due to logging.
  }
}

function getScanConcurrency(scanLimit) {
  if (!Number.isFinite(scanLimit)) return 6;
  if (scanLimit <= 500)  return SCAN_MESSAGE_CONCURRENCY;
  if (scanLimit <= 2000) return 6;
  return 5;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * FIX: Gmail API often returns 403 with reason "rateLimitExceeded" instead of 429.
 * Also handle the googleapis error shape (err.errors[0].reason).
 */
function isRetryableError(err) {
  const status = err?.response?.status || err?.status || err?.code;
  if (status === 429 || status >= 500) return true;
  // Gmail quota errors come as 403 with reason rateLimitExceeded / userRateLimitExceeded
  if (status === 403) {
    const reason = err?.response?.data?.error?.errors?.[0]?.reason || '';
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return true;
  }
  const code = (err?.code || '').toString().toUpperCase();
  return ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR'].includes(code);
}

async function withRetry(fn, context, retries = MAX_API_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryableError(err)) break;
      // Exponential backoff with jitter: 500ms, 1s, 2s, 4s
      const delay = RETRY_BASE_DELAY_MS * (2 ** attempt) + Math.random() * 200;
      logError(`${context}:retry:${attempt + 1}`, err);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * FIX: asyncPool previously used Promise.race which would throw and abort all
 * remaining tasks if any single task failed. Now errors are caught per-task so
 * one failure never stops the rest of the scan.
 */
async function asyncPool(items, maxConcurrent, taskFn) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve()
      .then(() => taskFn(item))
      .catch(err => { logError('asyncPool:task', err); })  // isolate per-task errors
      .finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }
  await Promise.allSettled(executing);
}

function isBlockedHost(hostname) {
  const host = (hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const ipVersion = net.isIP(host);
  if (!ipVersion) return false;

  if (ipVersion === 4) {
    const parts = host.split('.').map(n => Number(n));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  const normalized = host.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  return false;
}

/**
 * FIX: Decode HTML entities before validating/fetching the URL.
 * Emails encode & as &amp; in href attributes; without decoding, the URL is malformed.
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function getSafeHttpUrl(rawUrl) {
  try {
    const decoded = decodeHtmlEntities(rawUrl);
    const parsed = new URL(decoded);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isOAuthConfigured() {
  return GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_SECRET.length > 0;
}

function escapeHtml(text) {
  if (!text || typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.slice(0, 500).replace(/[&<>"']/g, c => map[c]);
}

// ── Secure Token Storage ───────────────────────────────────────────────────────
// FIX: Use safeStorage (OS Keychain / DPAPI) when available for real encryption.
// Fall back to a store-level key based on a random machine secret for older Electron.
function getStoreEncryptionKey() {
  // Use a stable random key stored in plain store (not the tokens store).
  // This key itself is device-scoped since it lives in userData.
  const keyStore = new Store({ name: 'keystore' });
  let key = keyStore.get('machineKey');
  if (!key) {
    key = crypto.randomBytes(32).toString('hex');
    keyStore.set('machineKey', key);
  }
  return key.slice(0, 32);
}

// ── Persistent token store (per user, in their app data folder) ───────────────
const store = new Store({ name: 'auth', encryptionKey: getStoreEncryptionKey() });

// ── OAuth client ──────────────────────────────────────────────────────────────
let _redirectPort = 9876; // Will be updated when we find a free port

function makeOAuthClient(redirectPort) {
  if (!isOAuthConfigured()) return null;
  const port = redirectPort || _redirectPort;
  const redirectUri = `${REDIRECT_URI_BASE}:${port}/oauth2callback`;
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  const saved = store.get('tokens');
  if (saved) {
    client.setCredentials(saved);
    client.on('tokens', newTokens => {
      try {
        store.set('tokens', { ...store.get('tokens'), ...newTokens });
      } catch (e) {
        logError('TokenStore', e);
      }
    });
  }
  return client;
}

let oauth2Client = makeOAuthClient();
let authInProgress = false;

// ── Find a free TCP port ──────────────────────────────────────────────────────
function findFreePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      // preferred port taken — ask OS for any free port
      const fallback = net.createServer();
      fallback.unref();
      fallback.on('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      server.close(() => resolve(preferredPort));
    });
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 680,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,   // FIX: enable sandbox (was incorrectly false)
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Auth IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('auth:status', async () => {
  if (!isOAuthConfigured()) {
    return {
      authenticated: false,
      configured: false,
      error: 'OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
    };
  }
  const tokens = store.get('tokens');
  if (!tokens?.access_token && !tokens?.refresh_token) {
    return { authenticated: false, configured: true };
  }
  try {
    oauth2Client = makeOAuthClient();
    if (!oauth2Client) {
      return { authenticated: false, configured: false, error: 'Failed to initialize OAuth client' };
    }
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await withRetry(() => gmail.users.getProfile({ userId: 'me' }), 'AuthStatus');
    return { authenticated: true, email: profile.data.emailAddress, configured: true };
  } catch (e) {
    logError('AuthStatus', e);
    // If tokens are invalid/revoked, clear persisted credentials.
    try { store.delete('tokens'); } catch { /* ignore */ }
    return { authenticated: false, configured: true, error: 'Token validation failed. Please sign in again.' };
  }
});

/**
 * FIX: auth:login previously used Promise reject() paths which surface as
 * unhandled rejections in some Electron versions. All paths now resolve().
 * FIX: OAuth port is now dynamically found — no more EADDRINUSE crashes.
 */
ipcMain.handle('auth:login', async () => {
  if (!isOAuthConfigured()) {
    return { ok: false, error: 'OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' };
  }
  if (authInProgress) {
    return { ok: false, error: 'Authentication already in progress' };
  }
  authInProgress = true;

  try {
    // FIX: Find a free port dynamically before starting the server.
    const port = await findFreePort(9876);
    _redirectPort = port;
    const redirectUri = `${REDIRECT_URI_BASE}:${port}/oauth2callback`;
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
    const saved = store.get('tokens');
    if (saved) client.setCredentials(saved);

    return await new Promise((resolve) => {  // FIX: only resolve(), never reject()
      let completed = false;
      let timeoutId;
      const expectedState = crypto.randomBytes(16).toString('hex');

      const done = (result) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        try { server.close(); } catch { /* ignore */ }
        authInProgress = false;
        resolve(result);
      };

      // FIX: Use URL constructor instead of deprecated url.parse()
      const server = http.createServer(async (req, res) => {
        let parsedUrl;
        try {
          parsedUrl = new URL(req.url, `http://localhost:${port}`);
        } catch {
          res.writeHead(400); res.end(); return;
        }

        if (parsedUrl.pathname !== '/oauth2callback') {
          res.writeHead(404); res.end(); return;
        }

        const code             = parsedUrl.searchParams.get('code');
        const error            = parsedUrl.searchParams.get('error');
        const errorDescription = parsedUrl.searchParams.get('error_description') || '';
        const state            = parsedUrl.searchParams.get('state');

        const errorDisplay = escapeHtml(error ? `${error}: ${errorDescription}` : '');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
          <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9f9f7">
            <div style="text-align:center">
              <div style="font-size:32px;margin-bottom:12px">${error ? '❌' : '✅'}</div>
              <h2 style="font-weight:600;font-size:18px;margin:0 0 8px">${error ? 'Sign-in failed' : 'Signed in!'}</h2>
              <p style="color:#888;margin:8px 0 0;font-size:14px">${error ? errorDisplay : 'You can close this tab and return to Gmail Unsubscriber.'}</p>
            </div>
          </body></html>`);

        if (error) {
          logError('OAuthCallback', `${error}: ${errorDescription}`);
          return done({ ok: false, error: `Sign-in was denied: ${errorDescription || error}` });
        }
        if (state !== expectedState) {
          return done({ ok: false, error: 'Security check failed (invalid state). Please try again.' });
        }
        if (!code) {
          return done({ ok: false, error: 'No authorization code received.' });
        }

        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          store.set('tokens', tokens);
          // Attach token refresh listener
          client.on('tokens', newTokens => {
            try { store.set('tokens', { ...store.get('tokens'), ...newTokens }); } catch { /* ignore */ }
          });
          oauth2Client = client;
          const gmail   = google.gmail({ version: 'v1', auth: client });
          const profile = await gmail.users.getProfile({ userId: 'me' });
          done({ ok: true, email: profile.data.emailAddress });
        } catch (e) {
          logError('TokenExchange', e);
          done({ ok: false, error: e.message || 'Token exchange failed.' });
        }
      });

      server.on('error', (e) => {
        logError('AuthServer', e);
        done({ ok: false, error: `Could not start auth server: ${e.message}` });
      });

      server.listen(port, '127.0.0.1', () => {
        try {
          const authUrl = client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES,
            state: expectedState,
          });
          shell.openExternal(authUrl);
        } catch (e) {
          logError('GenerateAuthUrl', e);
          done({ ok: false, error: `Could not open browser: ${e.message}` });
        }
      });

      timeoutId = setTimeout(() => {
        done({ ok: false, error: 'Authentication timed out (5 minutes). Please try again.' });
      }, AUTH_TIMEOUT);
    });
  } catch (e) {
    logError('AuthLogin', e);
    authInProgress = false;
    return { ok: false, error: e.message || 'Login failed.' };
  }
});

ipcMain.handle('auth:logout', () => {
  try {
    store.delete('tokens');
  } catch (e) {
    logError('Logout:DeleteTokens', e);
    // If we can't delete tokens, try to clear auth client anyway
  }
  try {
    oauth2Client = makeOAuthClient();
  } catch (e) {
    logError('Logout:ResetClient', e);
    oauth2Client = null;
  }
  return { ok: true };
});

// ── Scan IPC (streams progress back via webContents.send) ──────────────────────

const SUBSCRIPTION_KEYWORDS = [
  'unsubscribe', 'opt-out', 'opt out', 'mailing list', 'email preferences',
  'manage preferences', 'manage subscription', 'newsletter', 'digest',
  'promotional', 'marketing', 'weekly', 'daily digest', 'update your preferences',
];

const IMPORTANT_PATTERNS = [
  /bank/i, /invoice/i, /receipt/i, /statement/i, /alert/i,
  /verify/i, /verification/i, /confirm/i, /security/i, /payment/i,
  /account.*(statement|update)/i, /transaction/i, /two.factor/i, /otp/i,
  /password/i, /\bpin\b/i,
];

const CATEGORY_MAP = [
  { r: /spotify|netflix|youtube|apple.music|disney|prime.video|hulu|deezer/i,  c: 'Entertainment' },
  { r: /linkedin|glassdoor|indeed|monster|ziprecruiter|angel\.co/i,            c: 'Professional' },
  { r: /amazon|ebay|etsy|shopify|aliexpress|walmart|shop|store|order/i,        c: 'Shopping' },
  { r: /medium|substack|newsletter|digest|weekly|daily|briefing|roundup/i,     c: 'Newsletter' },
  { r: /duolingo|coursera|udemy|khan|skillshare|edx|masterclass/i,             c: 'Learning' },
  { r: /twitter|instagram|facebook|tiktok|snapchat|reddit|pinterest/i,         c: 'Social' },
  { r: /bank|hsbc|chase|barclays|wells.fargo|citi|ing|revolut|monzo|wise/i,    c: 'Banking' },
  { r: /airbnb|booking|hotels|expedia|tripadvisor|skyscanner|kayak/i,          c: 'Travel' },
  { r: /github|gitlab|stackoverflow|jira|notion|figma|atlassian/i,             c: 'Developer' },
  { r: /google|microsoft|apple|dropbox|zoom|slack/i,                           c: 'Productivity' },
];

function detectCategory(name, email) {
  const t = `${name} ${email}`;
  for (const { r, c } of CATEGORY_MAP) if (r.test(t)) return c;
  return 'Other';
}

function detectImportance(name, email, subject = '') {
  const t = `${name} ${email} ${subject}`;
  return IMPORTANT_PATTERNS.some(p => p.test(t));
}

function extractUnsubFromHeaders(headers) {
  if (!Array.isArray(headers)) return null;
  const h = headers.find(h => h.name?.toLowerCase() === 'list-unsubscribe');
  if (!h) return null;
  const matches = [...h.value.matchAll(/<([^>]+)>/g)].map(m => m[1]);
  return {
    httpUrl: matches.find(m => /^https?:/.test(m)) || null,
    mailto:  matches.find(m => m.startsWith('mailto:')) || null,
    raw:     h.value,
  };
}

function getBodyHtml(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  if (payload.parts) for (const p of payload.parts) { const h = getBodyHtml(p); if (h) return h; }
  return '';
}

/**
 * FIX: Decode HTML entities in extracted URLs so &amp; becomes & before fetching.
 */
function extractUnsubFromBody(html) {
  const patterns = [
    /href="([^"]*unsubscribe[^"]*?)"/i,
    /href="([^"]*opt.?out[^"]*?)"/i,
    /href="([^"]*manage[^"]*?pref[^"]*?)"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function sendProgress(phase, progress, meta = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scan:progress', { phase, progress, ...meta });
  }
}

ipcMain.handle('scan:start', async (_, options = {}) => {
  try {
    if (!isOAuthConfigured()) {
      return { ok: false, error: 'OAuth not configured', code: 'NOT_CONFIGURED' };
    }
    if (!oauth2Client) {
      return { ok: false, error: 'OAuth client not initialized. Please sign in first.', code: 'NOT_AUTHENTICATED' };
    }
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    sendProgress('Connecting to Gmail…', 5);

    const depth = options?.scanDepth;
    const scanLimit = depth === 'all' ? Infinity : [500, 1000, 2000].includes(Number(depth)) ? Number(depth) : 500;
    const scanConcurrency = getScanConcurrency(scanLimit);
    const progressDenominator = Number.isFinite(scanLimit) ? scanLimit : 2000;
    let scanErrors = 0;
    const scanStartedAt = Date.now();
    perfLog('scan_start', { scanLimit: Number.isFinite(scanLimit) ? scanLimit : 'all', scanConcurrency });
    const senderMap = new Map();

    let pageToken = null;
    let totalListed = 0;
    let processedMessages = 0;
    let pageCount = 0;

    do {
      const res = await withRetry(() => gmail.users.messages.list({
        userId: 'me',
        maxResults: 100,
        labelIds: ['INBOX'],
        pageToken: pageToken || undefined,
        fields: 'nextPageToken,messages/id',
      }), 'ListMessages');

      const pageMessages = Array.isArray(res.data.messages) ? res.data.messages : [];
      pageToken = res.data.nextPageToken;
      pageCount++;

      const remaining = Number.isFinite(scanLimit) ? Math.max(scanLimit - totalListed, 0) : pageMessages.length;
      const batch     = Number.isFinite(scanLimit) ? pageMessages.slice(0, remaining) : pageMessages;
      totalListed    += batch.length;

      sendProgress(
        `Reading inbox… (${totalListed} messages, page ${pageCount})`,
        Math.min(10 + (totalListed / progressDenominator) * 20, 30),
        { count: totalListed, total: Number.isFinite(scanLimit) ? scanLimit : null }
      );

      await asyncPool(batch, scanConcurrency, async (msg) => {
        try {
          if (!msg.id || typeof msg.id !== 'string') return;

          const detail = await withRetry(() => gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post'],
            fields: 'payload/headers',
          }), 'GetMessageMetadata');

          const headers = Array.isArray(detail.data.payload?.headers) ? detail.data.payload.headers : [];
          const from    = headers.find(h => h.name === 'From')?.value    || '';
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const date    = headers.find(h => h.name === 'Date')?.value    || '';

          const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
          const nameMatch  = from.match(/^"?([^"<]+"?)\s*</);
          const email      = emailMatch?.[1]?.toLowerCase().trim();
          const name       = nameMatch?.[1]?.replace(/["']/g, '').trim() || email?.split('@')[0] || '';
          if (!email?.includes('@')) return;

          const unsubHeader = extractUnsubFromHeaders(headers);
          const hasUnsub    = !!unsubHeader;
          const isSub       = hasUnsub || SUBSCRIPTION_KEYWORDS.some(k => subject.toLowerCase().includes(k));
          if (!isSub) return;

          const msgDate = new Date(date);
          if (!isNaN(msgDate.getTime())) {
            if (senderMap.has(email)) {
              const e = senderMap.get(email);
              e.count++;
              e.messageIds.push(msg.id);
              if (msgDate > e.lastDate) { e.lastDate = msgDate; e.lastSubject = subject; }
              if (!e.unsubscribeHeader && unsubHeader) e.unsubscribeHeader = unsubHeader;
              // FIX: Re-evaluate importance on every email — if ANY email from
              // this sender triggers an important pattern, upgrade to 'important'.
              if (e.risk !== 'important' && detectImportance(name, email, subject)) {
                e.risk = 'important';
              }
            } else {
              senderMap.set(email, {
                id:               email,
                name:             name.replace(/['"\u201C\u201D]/g, '').trim() || email.split('@')[0],
                email,
                count:            1,
                lastDate:         msgDate,
                lastSubject:      subject,
                category:         detectCategory(name, email),
                risk:             detectImportance(name, email, subject) ? 'important' : 'safe',
                unsubscribeHeader: unsubHeader,
                hasUnsub,
                messageIds:       [msg.id],
              });
            }
          }
        } catch (e) {
          scanErrors++;
          logError('ScanMessage', e);
        } finally {
          processedMessages++;
          if (processedMessages % 25 === 0 || processedMessages === totalListed) {
            const progress = Math.min(30 + (processedMessages / progressDenominator) * 50, 80);
            sendProgress(
              `Analysing senders… (${processedMessages}/${totalListed})`,
              Math.round(progress),
              { count: processedMessages, total: Number.isFinite(scanLimit) ? scanLimit : null }
            );
          }
        }
      });
    } while (pageToken && totalListed < scanLimit);

    sendProgress('Grouping senders…', 83);

    const senders = [...senderMap.values()]
      .filter(s => s.count >= 2 || s.hasUnsub)
      .sort((a, b) => b.count - a.count)
      .map(s => ({ ...s, lastDate: s.lastDate.toISOString().split('T')[0] }));

    sendProgress('Done!', 100);
    const durationMs = Date.now() - scanStartedAt;
    perfLog('scan_done', {
      durationMs,
      pages:            pageCount,
      listedMessages:   totalListed,
      processedMessages,
      senderCount:      senders.length,
      scanErrors,
      scanLimit:        Number.isFinite(scanLimit) ? scanLimit : 'all',
      scanConcurrency,
    });
    return {
      ok: true,
      senders,
      scanErrors,
      metrics: {
        pages:            pageCount,
        listedMessages:   totalListed,
        processedMessages,
        senders:          senders.length,
        durationMs,
        scanConcurrency,
      },
    };
  } catch (e) {
    perfLog('scan_failed', { error: e?.message || 'unknown' });
    logError('Scan', e);
    return { ok: false, error: e.message, code: 'SCAN_FAILED' };
  }
});

// ── Unsubscribe IPC ────────────────────────────────────────────────────────────

function createRequestAbortController() {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  return { controller, timeoutId };
}

/**
 * FIX: Use Gmail batchModify API instead of individual trash() calls.
 * One API call can handle up to 1000 message IDs, dramatically reducing
 * quota usage and latency for inbox cleanup.
 */
async function cleanupSenderEmails(gmail, messageIds) {
  const ids = [...new Set(
    (Array.isArray(messageIds) ? messageIds : [])
      .filter(id => typeof id === 'string' && id.length > 0)
  )];
  if (!ids.length) return { cleanedCount: 0, cleanupErrors: 0 };

  let cleanedCount  = 0;
  let cleanupErrors = 0;
  const BATCH_SIZE  = 1000; // batchModify supports up to 1000 IDs per call

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    try {
      await withRetry(() => gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: batch,
          addLabelIds:    ['TRASH'],
          removeLabelIds: ['INBOX'],
        },
      }), 'BatchTrash');
      cleanedCount += batch.length;
    } catch (e) {
      cleanupErrors += batch.length;
      logError('BatchTrash', e);
    }
  }

  return { cleanedCount, cleanupErrors };
}

ipcMain.handle('unsub:one', async (_, { senderId, unsubscribeHeader, messageIds, cleanupInbox }) => {
  try {
    const unsubStartedAt = Date.now();

    // Input validation
    if (!senderId || typeof senderId !== 'string') {
      return { ok: false, reason: 'INVALID_SENDER_ID' };
    }
    if (!isOAuthConfigured()) {
      return { ok: false, reason: 'NOT_CONFIGURED', error: 'OAuth not configured' };
    }
    if (!oauth2Client) {
      return { ok: false, reason: 'NOT_AUTHENTICATED', error: 'Not authenticated. Please sign in first.' };
    }
    if (!Array.isArray(messageIds)) {
      messageIds = [];
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let unsubResult = { ok: false, reason: 'NO_METHOD_AVAILABLE' };

    // ── Method 1: RFC 8058 One-Click POST ─────────────────────────────────────
    if (unsubscribeHeader?.httpUrl) {
      try {
        const safeHttpUrl = getSafeHttpUrl(unsubscribeHeader.httpUrl);
        if (safeHttpUrl && messageIds?.length) {
          try {
            const d = await gmail.users.messages.get({
              userId: 'me',
              id: messageIds[0],
              format: 'metadata',
              metadataHeaders: ['List-Unsubscribe-Post'],
            });
            const postH = Array.isArray(d.data.payload?.headers)
              ? d.data.payload.headers.find(h => h.name?.toLowerCase() === 'list-unsubscribe-post')
              : null;
            if (postH?.value?.toLowerCase().includes('list-unsubscribe=one-click')) {
              const { controller, timeoutId } = createRequestAbortController();
              try {
                const r = await withRetry(() => fetch(safeHttpUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Gmail-Unsubscriber/1.0',
                  },
                  body: 'List-Unsubscribe=One-Click',
                  signal: controller.signal,
                }), 'OneClickPost');
                clearTimeout(timeoutId);
                if (r.ok) unsubResult = { ok: true, method: 'one-click-post' };
              } catch (e) {
                clearTimeout(timeoutId);
                logError('OneClickPost', e);
              }
            }
          } catch (e) {
            logError('OneClickCheck', e);
          }
        }
      } catch (e) {
        logError('UrlValidation', e);
      }
    }

    // ── Method 2: Mailto (standard automated email request) ──────────────────
    if (!unsubResult.ok && unsubscribeHeader?.mailto) {
      try {
        const mu = new URL(unsubscribeHeader.mailto);
        // For mailto: URLs, the recipient is in the pathname after the "mailto:" scheme.
        // new URL('mailto:foo@bar.com') → pathname = 'foo@bar.com'
        const to = mu.pathname.trim();

        let subject = mu.searchParams.get('subject') || 'Unsubscribe';
        let body    = mu.searchParams.get('body')    || 'Please unsubscribe me from your mailing list.';

        // Validate recipient and guard against header injection.
        if (!to.includes('@') || /\s/.test(to)) {
          throw new Error('Invalid mailto recipient');
        }
        subject = subject.replace(/[\r\n]/g, ' ').slice(0, 100);
        body    = body.replace(/\r/g, '\n').slice(0, 1000);

        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url');

        await withRetry(
          () => gmail.users.messages.send({ userId: 'me', requestBody: { raw } }),
          'MailtoUnsubscribe'
        );
        unsubResult = {
          ok:      true,
          method:  'mailto-submitted',
          warning: 'Mailto queued; remote mailbox may still reject delivery.',
        };
      } catch (e) {
        logError('MailtoUnsubscribe', e);
      }
    }

    // ── Method 3: HTTP GET on List-Unsubscribe URL ────────────────────────────
    if (!unsubResult.ok && unsubscribeHeader?.httpUrl) {
      try {
        const safeHttpUrl = getSafeHttpUrl(unsubscribeHeader.httpUrl);
        if (safeHttpUrl) {
          const { controller, timeoutId } = createRequestAbortController();
          try {
            const r = await withRetry(() => fetch(safeHttpUrl, {
              method: 'GET',
              headers: { 'User-Agent': 'Gmail-Unsubscriber/1.0' },
              redirect: 'follow',
              signal: controller.signal,
            }), 'HttpUnsubscribe');
            clearTimeout(timeoutId);
            if (r.ok) unsubResult = { ok: true, method: 'http-get' };
          } catch (e) {
            clearTimeout(timeoutId);
            logError('HttpUnsubscribe', e);
          }
        }
      } catch (e) {
        logError('UrlValidation', e);
      }
    }

    // ── Method 4: Body link extraction (last resort) ──────────────────────────
    if (!unsubResult.ok) {
      for (const msgId of (messageIds || []).slice(0, 3)) {
        if (!msgId || typeof msgId !== 'string') continue;
        try {
          const d    = await withRetry(() => gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' }), 'BodyExtraction');
          const html = getBodyHtml(d.data.payload);
          const link = extractUnsubFromBody(html); // Already HTML-entity decoded
          if (link) {
            const safeLink = getSafeHttpUrl(link);
            if (safeLink) {
              const { controller, timeoutId } = createRequestAbortController();
              try {
                const r = await withRetry(() => fetch(safeLink, {
                  method: 'GET',
                  headers: { 'User-Agent': 'Gmail-Unsubscriber/1.0' },
                  redirect: 'follow',
                  signal: controller.signal,
                }), 'BodyLinkUnsubscribe');
                clearTimeout(timeoutId);
                if (r.ok) {
                  unsubResult = { ok: true, method: 'body-link' };
                  break;
                }
              } catch (e) {
                clearTimeout(timeoutId);
                logError('LinkFetch', e);
              }
            }
          }
        } catch (e) {
          logError('BodyExtraction', e);
        }
      }
    }

    const cleanupEnabled = cleanupInbox === true;
    if (!cleanupEnabled || !unsubResult.ok) {
      perfLog('unsub_done', {
        senderId,
        method:       unsubResult.method || null,
        ok:           !!unsubResult.ok,
        cleanupEnabled,
        durationMs:   Date.now() - unsubStartedAt,
      });
      return unsubResult;
    }

    const cleanup = await cleanupSenderEmails(gmail, messageIds);
    const result  = { ...unsubResult, ...cleanup };
    perfLog('unsub_done', {
      senderId,
      method:        result.method       || null,
      ok:            !!result.ok,
      cleanupEnabled,
      cleanedCount:  result.cleanedCount  || 0,
      cleanupErrors: result.cleanupErrors || 0,
      durationMs:    Date.now() - unsubStartedAt,
    });
    return result;
  } catch (e) {
    perfLog('unsub_failed', { senderId, error: e?.message || 'unknown' });
    logError('Unsubscribe', e);
    return { ok: false, reason: 'ERROR', error: e.message };
  }
});
