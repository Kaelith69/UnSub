# Security Policy

Gmail Unsubscriber is designed with privacy and security as first-class concerns. This document outlines the security measures in place.

## Data Processing

- **Local-Only Processing**: All email data is processed entirely on your local machine. No email content, metadata, or tokens are sent to any server other than Google's Gmail API.
- **Token Encryption**: OAuth tokens are encrypted using a cryptographically random 32-byte key generated on first run and stored in the application data directory via `electron-store`. The key is device-scoped and not derivable from external information.
- **No Analytics**: No usage analytics, telemetry, or tracking is performed.
- **No External Services**: The application does not communicate with any external services except Google's Gmail API.

## OAuth Security

- **OAuth 2.0**: Industry-standard OAuth 2.0 flow with proper state validation
- **Offline Access**: The application requests `access_type: 'offline'` to handle token refresh automatically
- **Scopes**: Only the minimum necessary scopes are requested:
  - `gmail.readonly` - Read-only access to Gmail
  - `gmail.modify` - Ability to trash emails and send unsubscribe emails
  - `userinfo.email` - Retrieve authenticated user's email

## URL Validation

All unsubscribe URLs extracted from emails are validated before fetching:
- **Scheme Check**: Only `http://` and `https://` URLs are allowed
- **Host Validation**: SSRF protection blocks requests to:
  - Loopback addresses (127.0.0.1, ::1)
  - Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - Link-local addresses (169.254.0.0/16)
  - Local domain names (*.local)

## Input Validation

- **Email Validation**: Recipients and addresses are validated before use
- **Header Injection Prevention**: SMTP headers (To, Subject, Body) are sanitized to prevent header injection attacks
- **HTML Escaping**: OAuth callback responses are HTML-escaped to prevent injection attacks
- **CSS.escape**: DOM IDs and selectors use `CSS.escape()` for safety

## Electron Security

- **Context Isolation**: `contextIsolation: true` - Renderer and main processes are isolated
- **Node Integration Disabled**: `nodeIntegration: false` - Web content cannot access Node.js APIs
- **Sandbox**: Renderer processes run in sandbox mode
- **Preload Bridge**: Only necessary APIs are exposed via `contextBridge.exposeInMainWorld()`

## Network Security

- **HTTPS Preferred**: Unsubscribe links are validated to use HTTPS when possible
- **Timeout Protection**: Network requests have timeouts to prevent hanging
- **Retry Logic**: Exponential backoff for transient failures, with maximum retry limits
- **User-Agent**: Identifies as "Gmail-Unsubscriber/1.0" for transparency

## Code Review & Updates

- Regular dependency updates to patch security vulnerabilities
- Automated vulnerability scanning via npm audit
- Regular code review for security issues

## Reporting Security Issues

If you discover a security vulnerability, please email the maintainers with details. Do **not** open a public issue for security vulnerabilities.

## Compliance

- **GDPR**: The application is designed to be GDPR-compliant as it processes data only locally
- **CCPA**: Compliant with California Consumer Privacy Act requirements
- **SOC 2**: Designed with security controls compatible with SOC 2 compliance

## Best Practices

1. Keep the application updated to receive the latest security patches
2. Use a strong password for your Google account
3. Enable two-factor authentication on your Google account
4. Only run the application from trusted, secured computers
5. Do not share your .env file containing OAuth credentials
