# Key Finder

<p align="left">
  <img src="icons/icon128.png" width="48" height="48" alt="Key Finder logo">
</p>

A Chrome extension (Manifest V3) that scans web pages for exposed API keys, tokens, credentials, and sensitive files. Helps developers and security researchers identify accidentally leaked secrets during development and testing.

## Features

- **Page Source Scan** — inspects HTML, inline scripts, and meta tags for credential patterns
- **Storage Scan** — checks `localStorage` and `sessionStorage` for stored tokens and secrets
- **External JS Scan** — fetches and scans external JavaScript files for leaked keys
- **Source Map Scan** — detects and scans source maps for hardcoded credentials
- **Endpoint Probe** — checks for exposed `.env`, configuration, and credential files
- **Dashboard** — full overview with severity breakdown, domain grouping, search, filter, pagination
- **Dark Mode** — default dark theme, toggleable via the theme button
- **Per-Tab Badge** — shows finding count for the current domain on the extension icon

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `key-finder` directory

## Usage

1. Click the Key Finder icon in the toolbar to open the popup
2. The popup shows findings for the current page/tab
3. Click **Open Dashboard** for a full overview across all scanned domains
4. Use filters, domain tabs, and search to explore findings
5. Toggle dark mode via the moon/sun icon

## Detection Patterns

Key Finder detects 45+ credential patterns including:

- AWS Access Keys
- Google API Keys (OAuth, Service Account, API Keys)
- GitHub Tokens (PAT, Fine-Grained, OAuth)
- OpenAI / Azure / Anthropic API Keys
- Slack / Discord / Telegram Bot Tokens
- JWT Tokens
- Private SSH Keys
- npm / NuGet API Keys
- Git credentials
- Generic base64-encoded secrets
- And more...

Additionally, 55+ endpoint paths are probed for exposed files like `.env`, `config.json`, `credentials`, and backup files.

## Screenshots
<img width="465" height="306" alt="image" src="https://github.com/user-attachments/assets/c75cdbfc-f3a4-4258-b010-96c2958e3722" />
<img width="1918" height="937" alt="image" src="https://github.com/user-attachments/assets/9efa8ab5-7962-49a0-ac52-9a221fe3cfb0" />
<img width="1918" height="935" alt="image" src="https://github.com/user-attachments/assets/348a1ff0-9828-41b0-8cc4-19b7db4fcb5f" />
<img width="1918" height="935" alt="image" src="https://github.com/user-attachments/assets/0cab300f-7082-48df-bf63-e1079983c441" />


## Privacy

Key Finder runs entirely in the browser. All scanning is done client-side. Findings are stored in `chrome.storage.local` and never leave your browser. No data is sent to any external server.

## License

MIT License — see [LICENSE](LICENSE).
