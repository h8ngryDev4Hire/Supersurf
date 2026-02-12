# Multi-Agent Session Multiplexing

**Date:** 2026-02-10
**Version:** v2

## Purpose
Revisited multiplexing architecture after rejecting full daemon model. Moved to simpler leader/follower approach within ExtensionServer that preserves zero-config startup.

## Summary
- **Architectural pivot:** Daemon model (external WebSocket coordinator + fallback to port 5556-5580) rejected. Too complex, breaks zero-config, adds IPC layer.
- **New design:** Dual-mode ExtensionServer. Server (leader) mode binds port 5555; client (follower) mode connects to existing leader when port is taken.
- **Leader promotion:** When leader dies, followers detect broken connection, apply random jitter (50-200ms), one successfully binds port 5555 and becomes new leader. Extension auto-reconnects on 5s backoff.
- **Hard tab isolation:** Server-side ACL in multiplexer tracks session→tab mapping. Requests and responses filtered so sessions can't see or control other sessions' tabs.
- **Session identity:** Duplicate `client_id` rejected with "session name already in use" error.

## Research
No external research—design discussion based on SuperSurf architecture and rejection of complexity introduced by daemon models.

## Consensus

### Architecture: Leader/Follower Within ExtensionServer

**Two operating modes:**
1. **Server (leader) mode:** Binds WebSocket to port 5555. Directly communicates with extension. Proxies tool requests from followers.
2. **Client (follower) mode:** Connects to leader's WebSocket. Sends tool requests, receives responses. No direct extension connection.

**Mode selection (automatic):**
- On `enable` tool call, `Multiplexer` attempts to bind port 5555
- If successful → leader mode
- If EADDRINUSE → follower mode, connect to `ws://localhost:5555`

### New Component: `server/src/experimental/multiplexer.ts`

Owns:
- Dual-mode logic (server/client)
- Peer connection management (WebSocket client for followers)
- Request proxying (followers → leader → extension)
- Response routing (leader → correct follower)
- Leader promotion (jitter, port binding race)
- Session→tab ACL (tracks who owns what tabs)

### Modified Files

**`server/src/extensionServer.ts`:**
- Stop rejecting second WebSocket connections
- Accept multiple clients, each identified by unique `client_id` in handshake

**`server/src/backend.ts`:**
- `onEnable()` creates `Multiplexer` instead of raw `ExtensionServer`
- Multiplexer exposes same `sendCmd()` interface as DirectTransport (no tool changes needed)

**Untouched:**
- `tools.ts`: Same `sendCmd()` call pattern regardless of mode
- `extension/*`: No awareness of multiplexing—sees leader as single client

### Leader Promotion Protocol

1. Follower detects broken WebSocket connection
2. Random jitter delay: 50-200ms (prevents thundering herd)
3. Attempt to bind port 5555
4. If successful → transition to leader mode, extension will reconnect on next 5s backoff tick
5. If failed (another follower won the race) → reconnect as follower

**No readiness signal needed:** Extension's 5s reconnect backoff >> 200ms promotion window. By the time extension reconnects, new leader is already listening.

### Hard Tab Isolation (ACL)

Multiplexer maintains `sessionTabMap`:
```typescript
Map<string, Set<number>> // session_id → Set<tab_id>
```

**Request filtering:**
- `browser_tabs`, `browser_navigate`, `browser_snapshot`, etc. with tab ID → check ACL
- If tab not owned by session → return "permission denied" error
- No tab ID provided → session can only access its own tabs (implicit scope)

**Response filtering:**
- Tab list responses filtered to only include session's tabs
- Console messages, network requests tagged with tab ownership

**Tab creation:**
- New tabs auto-assigned to session that created them
- Tabs survive leader promotion (ACL state transferred)

### Session Identity

- `client_id` sent in MCP connection handshake (or auto-generated UUID if not provided)
- Leader maintains active sessions registry
- Duplicate `client_id` rejected: `"Error: session name 'xyz' already in use"`

### In-Flight Request Failures

**During leader promotion:**
- Followers' in-flight requests fail with connection error
- Agents handle retries naturally (MCP SDK retry logic + agent prompt context)
- No special signaling needed—treat like any transient network failure

### Experimental Feature Gating

**Multiplexer bypasses MCP experiment registry:**
- Not toggleable via `experimental_features` tool
- Always active by default (if you run multiple servers, you get multiplexing)

**New CLI flag:** `--disable-experimental-features [features...]`
- No params → disables everything, including the MCP experiment system itself
- With params → disables specific features (e.g., `--disable-experimental-features multi_session page_diffing`)

### Build Order

1. **Multiplexer core** (`multiplexer.ts`): Dual-mode logic, port binding race, peer connections
2. **CLI flag** (`--disable-experimental-features`): Add to Commander CLI, wire to Multiplexer constructor
3. **Integration** (`backend.ts`, `extensionServer.ts`): Replace DirectTransport with Multiplexer, allow multiple extension clients
4. **ACL enforcement** (within `multiplexer.ts`): Session→tab mapping, request/response filtering

## User Setup Required
No manual setup—zero-config design preserved.

## Open Questions
- [ ] Should ACL state persist across full server shutdowns? (Leader promotion transfers state, but full restart loses it)
- [ ] Max concurrent sessions limit? (Or rely on system resource limits?)
- [ ] Should followers cache tool responses to reduce leader traffic? (Likely premature optimization)
- [ ] What's the UI for listing active sessions and their tab assignments? (New MCP tool?)
- [ ] Should session names be hierarchical? (e.g., `main.subagent1`, `main.subagent2` for parent/child relationships)
- [ ] How should network request filtering work with per-session filters? (Union of all sessions' filters, or isolated per-session?)
