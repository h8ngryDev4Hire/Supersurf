# Brainstorm: SuperSurf — MCP Browser Automation Tool

**Date:** 2026-02-07
**Codename:** SuperSurf
**Note to reviewer:** See linked sources in the Research Findings section for deeper technical context on anti-bot detection and CDP architecture.

---

## Context

Evaluated Blueprint MCP (open-source browser automation MCP tool, Apache 2.0) as a reference architecture. Full security audit confirmed it's clean — no malware, no telemetry, no exfiltration. Decision: fresh build extracting proven patterns and PRO-gated features from Blueprint MCP.

---

## Research Findings

### CDP vs Extension Architecture
- Raw CDP gives 80+ protocol domains; extension's `chrome.debugger` wraps CDP but exposes only ~27 domains + shows an infobar
- Chrome 136+ requires separate `--user-data-dir` for remote debugging — can't use default profile with raw CDP
- Chrome M144 (beta) introduces connect-to-running-browser via `chrome://inspect/#remote-debugging`

### Anti-Bot Detection (2025-2026)
- `Runtime.enable` was the main CDP detection signal — **V8 patched it May 2025, detection is dead**
- Industry moved to behavioral analysis: mouse patterns, scrolling, timing, network fingerprinting
- CDP-injected scripts show as VM instances in memory profiling; content scripts don't
- Content scripts run in isolated world — undetectable by page JavaScript
- Cookie injection alone doesn't solve anti-bot (missing history, cache, localStorage, extensions)
- Extension presence is itself a human signal
- Modern anti-detect frameworks (Nodriver, Selenium-Driverless) explicitly moving away from CDP

### Sources
- [Castle: Detecting CDP-Injected Scripts](https://blog.castle.io/how-to-detect-scripts-injected-via-cdp-in-chrome-2/)
- [Castle: CDP Detection Signal Stopped Working](https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/)
- [Castle: Puppeteer Stealth to Nodriver Evolution](https://blog.castle.io/from-puppeteer-stealth-to-nodriver-how-anti-detect-frameworks-evolved-to-evade-bot-detection/)
- [Rebrowser: Runtime.Enable CDP Detection Fix](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries)
- [DataDome: CDP Signal Impact on Bot Detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)

---

## Decisions

1. **Keep extension architecture** — real browser profile, content script stealth, no detectable launch flags, lived-in environment
2. **Fresh build, extract logic** from Blueprint MCP (Apache 2.0) — not a fork/whitelabel
3. **Full Blueprint feature set** — everything Blueprint offers (navigation, DOM interaction, screenshots, network monitoring, console capture, form filling, cookie management, etc.)
4. **Extract Blueprint PRO features**: Script Mode (JSON-RPC stdio), Auto-connect, Advanced Reconnection
5. **Skip**: cloud relay, OAuth, multi-browser switching, shared access
6. **Extension must work OOB** — no user intervention, CI-friendly, sideloaded via `--load-extension`
7. **Content-script-first** for DOM interaction; CDP only for screenshots, network interception, PDF generation
8. **Mouse pattern humanization deferred** — Blueprint has no implementation for this either; net-new work for later
9. **Profile preloading deferred** — can synthesize fake browsing data later if needed

---

## Architecture

```
AI Agent --> MCP Server (Node.js, stdio) --> Local WebSocket --> Chrome Extension (sideloaded)
```

Chrome launched via:
```
chrome --load-extension=/path/to/extension --user-data-dir=/path/to/profile
```

No popup, no clicks, no pairing. Extension auto-connects to MCP server WebSocket on load.

---

## Credential Isolation Pipeline (`secure_fill`)

Sealed auth injection where the AI agent never sees raw credential values.

### Flow
1. Agent calls `secure_fill({ selector: "#password", credential_env: "LOGIN_PASSWORD" })`
2. MCP server forwards command to extension over WebSocket (env var name only, not the value)
3. Extension resolves env var value internally, injects via content script using real DOM events
4. Returns `{ success: true }` to agent — no credential data exposed

### Why Extension, Not Raw CDP
- Content script event dispatch goes through browser's normal event pipeline (stealthier)
- Raw CDP `Input.dispatchKeyEvent` goes through debugging protocol (detectable)
- Same security benefit (agent never sees creds) with better anti-bot posture

### Credential Storage
- **Primary: environment variables** — standard CI pattern, runner is ephemeral, agent only sees env var names, no bash access to resolve them
- Future: support for encrypted credential files, vault integrations (1Password, Bitwarden)

### Typing Humanization
- Character-by-character via content script DOM events
- Random inter-key delays (40-120ms) to simulate human typing
- No `element.value = "..."` — fires same events a real keyboard does
