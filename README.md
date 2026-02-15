# SuperSurf

MCP browser automation that gives AI agents control of a real Chrome browser.

Unlike tools that spin up headless browsers or inject CDP scripts, SuperSurf uses a Chrome extension to interact with pages through content scripts. This means your agent operates in a real browser profile with your cookies, history, and localStorage intact — and page JavaScript can't detect it.

## Table of Contents

- [Features](#features)
- [Why SuperSurf over Puppeteer/Selenium?](#why-supersurf-over-puppeteerselenium)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [Load the Extension](#load-the-extension)
  - [Register the MCP Server](#register-the-mcp-server)
- [Usage](#usage)
  - [Tools](#tools)
  - [Experimental Features](#experimental-features)
- [Server CLI Flags](#server-cli-flags)
- [Why Extension-Based?](#why-extension-based)
- [License](#license)

## Features

- **Undetectable DOM interaction** — All page interaction runs through Chrome's content script context. No CDP fingerprints, no VM script artifacts, nothing for page JavaScript to observe.
- **Real browser profile** — Your agent browses with your actual cookies, history, localStorage, and extensions. No sterile headless environment that screams "bot."
- **Secure credential handling** — `secure_fill` injects passwords from environment variables directly in the extension. The agent sends an env var *name*, never the value. Characters are typed with randomized delays to mimic human input.
- **30+ browser tools via MCP** — Full coverage: navigation, interaction, screenshots, network monitoring, console access, form filling, CSS inspection, PDF export, performance metrics, file downloads.
- **Session multiplexing** (experimental) — Multiple MCP clients share one browser. A leader/follower architecture with tab ownership tracking and round-robin scheduling keeps sessions isolated.
- **Framework detection** — Content script identifies 40+ frontend frameworks and libraries on any page, giving the agent context about what it's working with.
- **CI-ready** — Sideload the extension with `--load-extension` and a throwaway profile. No manual setup needed for automation pipelines.
- **Zero extension dependencies** — The Chrome extension uses browser APIs only. No bundled libraries, no supply chain surface.

## Why SuperSurf over Puppeteer/Selenium?

| | SuperSurf | Puppeteer | Selenium |
|---|---|---|---|
| **Detection surface** | Content scripts (isolated + invisible to webpage JS) | CDP over pipe — detectable via `navigator.webdriver`, CDP leak, `Runtime.evaluate` VM artifacts | WebDriver protocol — `navigator.webdriver` flag, predictable DOM mutation patterns |
| **Browser profile** | Your real profile (cookies, history, extensions, localStorage) | Fresh profile by default. Can reuse a data dir, but launch flags (`--remote-debugging-*`) are detectable | Fresh profile. Can load a custom one, but WebDriver flags persist |
| **Credential security** | Agent never sees raw values — env var resolved extension-side | Credentials pass through your script in plaintext | Credentials pass through your script in plaintext |
| **Anti-bot posture** | Extension presence is a human signal. No suspicious launch flags | Headless Chrome is increasingly blocked. Stealth plugins are a cat-and-mouse game | Widely fingerprinted. Most commercial anti-bot systems flag it immediately |
| **Multi-agent** | Built-in multiplexing — multiple MCP clients share one browser with tab isolation | One connection per browser. Sharing requires custom orchestration | Grid supports parallelism, but each session gets its own browser |
| **Designed for** | AI agents via MCP | Scripted automation | Scripted testing |

Puppeteer and Selenium are great tools for scripted automation and testing. SuperSurf solves a different problem: giving an AI agent a browser that looks and behaves like a human's, with an MCP interface designed for tool-calling LLMs rather than imperative scripts.

## How It Works

```
AI Agent  -->  MCP Server (stdio)  -->  WebSocket  -->  Chrome Extension  -->  Browser
```

The MCP server runs locally and communicates with the Chrome extension over a WebSocket on `localhost:5555`. The extension handles all DOM interaction through content scripts (isolated world, invisible to page JS). CDP is only used for screenshots, network interception, and PDF export.

### Project Structure

```
supersurf/
  server/
    src/           # MCP server source (TypeScript)
    dist/          # MCP server (Node.js)
  extension/
    src/           # Extension source (TypeScript)
    dist/          # Chrome extension (Manifest V3)
    manifest.json
```

## Prerequisites

- Node.js >= 18
- Chrome or Chromium
- An MCP client (Claude Code, Claude Desktop, etc.)

## Setup

```bash
npm install
```

### Load the Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory (not `extension/dist/`)

### Register the MCP Server

**Claude Code:**
```bash
npm run mcp
# or manually:
claude mcp add supersurf -- node server/dist/cli.js
```

**Claude Desktop** — add to your MCP config:
```json
{
  "mcpServers": {
    "supersurf": {
      "command": "node",
      "args": ["/absolute/path/to/supersurf/server/dist/cli.js"]
    }
  }
}
```

## Usage

Once the MCP server is registered, your agent has access to browser tools. The typical flow:

1. Agent calls `enable` to start the WebSocket server
2. The extension auto-connects
3. Agent uses `browser_tabs` to open/attach to a tab
4. Agent interacts with the page using the tools below

### Tools

| Tool | Description |
|------|-------------|
| `enable` | Start browser automation session |
| `disable` | Stop browser automation session |
| `status` | Show connection state |
| `experimental_features` | Toggle experimental features |
| `browser_tabs` | List, create, attach, or close tabs |
| `browser_navigate` | Go to URL, back, forward, reload |
| `browser_interact` | Click, type, press keys, hover, scroll, wait, select, upload files |
| `browser_snapshot` | Get the page's accessibility tree as structured DOM |
| `browser_lookup` | Find elements by visible text, returns CSS selectors |
| `browser_extract_content` | Pull page content as clean markdown |
| `browser_get_element_styles` | Inspect computed CSS like DevTools Styles panel |
| `browser_take_screenshot` | Capture viewport, full page, element, or region |
| `browser_evaluate` | Run JavaScript in page context |
| `browser_console_messages` | Read console output, filter by level/text/URL |
| `browser_fill_form` | Set values on multiple form fields at once |
| `browser_drag` | Drag one element to another |
| `browser_window` | Resize, close, minimize, maximize |
| `browser_verify_text_visible` | Assert text is visible on page |
| `browser_verify_element_visible` | Assert element is visible on page |
| `browser_network_requests` | Monitor/inspect/replay network traffic |
| `browser_pdf_save` | Export page as PDF |
| `browser_handle_dialog` | Accept or dismiss alerts/confirms/prompts |
| `browser_list_extensions` | List installed Chrome extensions |
| `browser_reload_extensions` | Reload unpacked extensions |
| `browser_performance_metrics` | Collect Web Vitals (FCP, LCP, CLS, TTFB) |
| `browser_download` | Download a file via the browser |
| `secure_fill` | Fill a field with a credential from an env var (agent never sees the value) |

### Experimental Features

Experimental features can be enabled via the `SUPERSURF_EXPERIMENTS` environment variable:

```bash
SUPERSURF_EXPERIMENTS=page_diffing,smart_waiting,mouse_humanization
```

Session-based features can be toggled with the `experimental_features` tool:

- **page_diffing** — After interactions, returns only DOM changes instead of a full re-read. Includes a confidence score.
- **smart_waiting** — Replaces fixed delays with adaptive DOM stability + network idle detection.
- **storage_inspection** — Inspect and modify browser storage (localStorage, sessionStorage).
- **mouse_humanization** — Replaces instant cursor teleportation with human-like Bezier trajectories, overshoot correction, and idle micro-movements. Uses hand-tuned constants from the Balabit Mouse Dynamics dataset.
- **secure_eval** — Analyzes JavaScript in `browser_evaluate` for dangerous patterns (network calls, storage access, code injection, obfuscation) via AST parsing. Blocks unsafe code before execution.

Infrastructure experiments (not session-toggleable, env var only):

- **multiplexer** — Session multiplexing for concurrent MCP clients. One instance acts as the leader (owns the extension connection), others connect as followers and proxy commands through it. Includes tab ownership tracking and round-robin scheduling across sessions.

## Server CLI Flags

| Flag | Description |
|------|-------------|
| `--debug` | Verbose logging + hot reload. Logs truncated by default. |
| `--debug=no_truncate` | Full-verbosity debug mode — no payload truncation. |
| `--port <n>` | WebSocket port (default: 5555) |
| `--log-file <path>` | Custom server log file path |
| `--script-mode` | JSON-RPC over stdio without MCP framing |

### Debug Logging

When `--debug` is enabled, logs are written to:

- **Server log:** `~/.supersurf/logs/server.log` — startup, connection lifecycle, all WS traffic
- **Session logs:** `~/.supersurf/logs/sessions/supersurf-debug-{client_id}-{timestamp}.log` — created per `enable` call, closed on `disable`

All outgoing/incoming WebSocket commands log their params and responses. CDP passthrough commands unwrap to show the inner method (e.g., `→ forwardCDPCommand: Input.dispatchMouseEvent { ... }`). Base64 payloads (screenshots, PDFs) are automatically redacted in truncated mode.

## Why Extension-Based?

**Content scripts are invisible.** CDP-injected scripts appear as VM instances in memory profiling. Content scripts run in an isolated world that page JavaScript cannot observe.

**Real browser profile.** No synthetic launch flags, no blank profile. Your agent browses with the same cookies, history, and extensions as a human user.

**Extension presence is a human signal.** Anti-bot systems check for installed extensions as evidence of a real user. A browser with zero extensions is suspicious.

**CI-compatible.** The extension can be sideloaded without user interaction:
```bash
chrome --load-extension=./extension --user-data-dir=/tmp/supersurf-profile
```

## License

Apache-2.0
