# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperSurf is an MCP browser automation tool that gives AI agents control of a real Chrome browser via a Chrome extension + local MCP server. Built using Blueprint MCP (Apache 2.0) as a reference — the `blueprint-mcp/` directory is that reference project and is **not used at runtime**.

**Key design choice:** Extension-based approach over raw CDP. Extensions use real browser profiles (cookies, history, localStorage), content scripts run in isolated worlds undetectable by page JS, and extension presence is itself a human signal to anti-bot systems.

## Commands

```bash
# Build everything (server + extension)
npm run build

# Dev mode (server with debug logging + hot reload)
npm run dev:server

# Build individually
npm run build:server
npm run build:extension

# Extension watch mode
cd extension && npm run dev

# Register MCP server with Claude
npm run mcp

# Tests (server only, Jest — no tests written yet)
npm run test:server
```

**Server CLI flags:** `--debug` (verbose + hot reload), `--port <n>` (default 5555), `--log-file <path>`, `--script-mode` (JSON-RPC stdio, no MCP).

**Loading the extension:** Point Chrome to `extension/` directory (not `extension/dist/`) via chrome://extensions → Load unpacked.

## Architecture

```
AI Agent → stdio/MCP → Server (Node.js) → WebSocket (localhost:5555) → Chrome Extension → Chrome APIs/CDP
```

### Server (`server/src/`)

| File | Role |
|------|------|
| `cli.ts` | Entry point. Commander CLI. In debug mode, runs as wrapper that restarts child on exit code 42 (hot reload). |
| `backend.ts` | `ConnectionManager` — state machine (`passive` → `active` → `connected`), tool routing, status headers prepended to every response. |
| `tools.ts` | `BrowserBridge` — orchestrator for browser tools. CDP/eval helpers, element resolution, dispatches to `tools/` modules. |
| `tools/` | Modular tool handlers: `schemas.ts` (tool definitions), `interaction.ts` (click/type/scroll), `content.ts` (snapshot/lookup/extract), `styles.ts` (CSS inspection), `screenshot.ts` (capture/PDF), `network.ts` (traffic/console), `navigation.ts` (tabs/navigate), `forms.ts` (fill/drag/secure-fill), `misc.ts` (window/dialog/evaluate/verify/extensions/perf). |
| `bridge.ts` | `ExtensionServer` — WebSocket server on port 5555. JSON-RPC 2.0 request/response with 30s timeout. |

### Extension (`extension/src/`)

| File | Role |
|------|------|
| `background.ts` | Service worker. Registers ~20 command handlers, manages CDP debugger attachment, auto-reconnect via Chrome alarms. |
| `connection/websocket.ts` | WebSocket client. JSON-RPC 2.0 dispatch, reconnection with 5s backoff, 30s keepalive alarm. |
| `handlers/` | Modular handlers: `tabs.ts` (tab tracking + tech stacks), `network.ts` (CDP network interception), `console.ts` (message capture), `dialogs.ts` (alert/confirm override). |
| `content-script.ts` | Injected at `document_start`. Detects 40+ frameworks/libraries. |
| `secure-fill.ts` | Credential injection — agent sends env var name, extension resolves value locally, types char-by-char with randomized delays (40-120ms). Agent never sees raw credentials. |

### Connection Lifecycle

1. MCP client starts server via stdio → server enters `passive` state
2. Agent calls `enable` tool → server starts WebSocket on port 5555 → `active` state
3. Extension auto-connects, sends handshake (browser name, version, build timestamp) → `connected` state
4. Tools become available. Every response includes a status header line.

### Lazy Import Pattern

`backend.ts` lazy-imports `tools.ts` to avoid circular dependencies:
```typescript
let BrowserBridge: any = null;
async function getBrowserBridge() {
  if (!BrowserBridge) {
    const mod = await import('./tools');
    BrowserBridge = mod.BrowserBridge;
  }
  return BrowserBridge;
}
```

## Design Principles

**Content-script-first for DOM interaction.** CDP is only used for screenshots, network interception, and PDF generation. All DOM reads/writes go through content scripts (isolated world, undetectable by page JS). This is a deliberate anti-bot posture — CDP-injected scripts show as VM instances in memory profiling; content scripts don't.

**Extension over raw CDP.** Raw CDP's `chrome.debugger` exposes ~27 domains vs CDP's 80+, but the tradeoff is worth it: real browser profile (cookies, history, localStorage, extensions), no detectable launch flags, and the extension itself is a human signal. Chrome 136+ requires a separate `--user-data-dir` for remote debugging anyway — can't use the default profile with raw CDP.

**CI sideloading:** Extension can be loaded without user interaction via `chrome --load-extension=/path/to/extension`.

**Deferred work (intentionally not implemented yet):**
- Mouse pattern humanization — net-new work, Blueprint has no implementation either
- Profile preloading — synthesizing fake browsing data for fresh profiles

See `knowledge/chat/supersurf-browser-automation.md` for the full research context (CDP detection landscape, anti-bot evolution 2025-2026, source links).

## Code Conventions

**TypeScript:** Strict mode. Server targets CommonJS (Node.js), extension targets ES2022 modules (browser). Extension imports require `.js` extensions.

**Naming:** PascalCase classes, camelCase functions, snake_case MCP tool names, underscore-prefixed private members (`_state`, `_config`).

**Chrome API access:** Bracket notation for reserved words — `(chrome as any)['debugger']`.

**Error pattern:** Tool errors throw with user-facing messages (e.g., `'Extension not connected. Open the extension popup and click "Enable".'`). Extension handlers return `{ success: boolean, error?: string }`.

**Debug logging:** `debugLog()` only outputs when `global.DEBUG_MODE` is true. Server logs to `~/.config/supersurf-nodejs/supersurf-debug.log`.

## Dependencies

**Server runtime:** `@modelcontextprotocol/sdk`, `commander`, `ws`, `sharp` (screenshots), `image-size`, `jsonpath-plus` (network filtering), `env-paths`.

**Extension:** Zero runtime dependencies — browser APIs only.
