# Changelog

All notable changes to Gmail Unsubscriber are documented in this file.

## [1.0.0] - 2025-05-25

### Fixed
- **Security**: Fixed 14 npm vulnerabilities including critical issues in Electron, tar, uuid, and xml parsing libraries
- **Dependencies**: Removed unused `cheerio` dependency that was included but never used
- **Error Handling**: Improved error messages and validation throughout the application
- **OAuth Configuration**: Added validation and helpful error messages when OAuth credentials are not configured
- **Network Errors**: Better handling of network timeouts and retryable errors

### Added
- **UI Feedback**: Enhanced toast notifications with specific error codes and recovery suggestions
- **Configuration Display**: Shows OAuth configuration status on the auth screen when credentials are missing
- **Developer Logging**: Added startup configuration logging in dev mode for easier troubleshooting
- **Window Management**: Proper cleanup handlers for window lifecycle events
- **Setup Documentation**: Comprehensive setup guide with step-by-step OAuth credential creation instructions
- **Troubleshooting Guide**: Common issues and solutions in README

### Improved
- **Error Messages**: More descriptive error messages for authentication, scanning, and execution phases
- **User Feedback**: Better progress reporting and completion messages
- **Retry Logic**: Enhanced retry handling with exponential backoff for transient failures
- **Code Quality**: Consistent error handling patterns throughout the codebase

### Updated
- **Dependencies**: Updated all npm packages to latest secure versions:
  - electron: ^28.0.0 → 42.2.0
  - electron-builder: ^24.9.1 → 26.8.1
  - googleapis: ^140.0.0 → 172.0.0

## [0.1.0] - Initial Release

Initial release of Gmail Unsubscriber with core functionality:
- OAuth 2.0 Gmail authentication
- Inbox scanning with configurable depth
- Unsubscribe execution with multiple methods (RFC 8058, HTTP, Body link, Mailto)
- Email cleanup/archival
- Local-only processing with no external data transmission
