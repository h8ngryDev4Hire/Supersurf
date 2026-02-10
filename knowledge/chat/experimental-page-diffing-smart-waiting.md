# Experimental Features: Page Diffing and Smart Waiting

**Date:** 2026-02-09
**Version:** v1

## Purpose
Differentiate SuperSurf from Blueprint MCP by adding two high-leverage experimental features that reduce token waste and improve agent experience with dynamic web content.

## Summary
- **Page Diffing**: Capture DOM before/after actions, return only changes instead of full page re-reads (saves tokens, reduces latency)
- **Smart Waiting**: Adaptive waiting after navigation based on network/DOM activity instead of hardcoded timeouts
- **Experiment Gating**: New `experimental_features` MCP tool lets agents enable/disable features per-session
- Both features tested across 13 real-world sites (HN, GitHub, Google, React docs, BBC, X, YouTube, Reddit, Instagram, Twitch, Discourse, IGN, StackOverflow)
- v1 design deliberately lightweight (~100-150 lines each) to validate core value before adding complexity
- Page diffing includes confidence metric with 70% threshold — below threshold, diff is excluded from result

## Research
- Blueprint MCP (reference implementation) — https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer
- Chrome DevTools Protocol DOM methods — https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- MutationObserver API — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver

## Consensus

### Experiment Gating

**MCP Tool: `experimental_features`**
- Always registered in the tool list (not dynamic)
- Agent calls `experimental_features({ page_diffing: true })` to enable, `({ page_diffing: false })` to disable
- Only ONE feature key per call (enforced) — prevents agents from cramming multiple toggles
- Session-scoped — all experiments expire when the MCP session ends
- Available experiments listed in the tool description (no separate `list_experiments` tool)
- No dynamic tool registration needed (`tools/list_changed` not required) — experiments modify behavior of existing tools, they don't create new MCP tools

**Server-side: `ExperimentRegistry`**
- Tracks enabled/disabled state per feature
- Imported via `import { ... } from '@experimental'` (tsconfig paths alias)
- Checked by existing tool handlers (`browser_interact`, `_handleNavigate`) to conditionally apply experimental behavior

### Page Diffing Implementation

**Architecture:**
- New directories: `server/src/experimental/` and `extension/src/experimental/` with barrel exports (`experimental/index.ts`)
- Import pattern: `import { ... } from '@experimental'` (tsconfig paths alias, fallback to relative imports if build targets fight it)
- NOT a standalone MCP tool — modifies `browser_interact` return type when enabled
- When enabled: `browser_interact` automatically captures before/after state and includes diff in its result
- Capture runs in content script via `capturePageState` command (existing messaging pattern, NO `browser_evaluate`/CDP eval)
- Comparison/diffing runs server-side in `tools.ts`

**Capture Strategy (v1 - lightweight):**
- Capture before/after: (1) element count, (2) set of visible text strings (direct text nodes only, deduped)
- Diff logic: `newStrings = after - before`, `removedStrings = before - after`, `countDelta = after.count - before.count`
- No element identity tracking, no position tracking, no shadow DOM traversal in v1
- Filter to visible elements in/near viewport only
- Expected capture cost: ~5ms per snapshot

**Confidence Metric:**
- Single threshold: **70%** (0.7)
- Above 0.7 → full diff included in `browser_interact` result with confidence score
- Below 0.7 → diff excluded, agent only gets: "diff confidence below threshold (X%)"
- Scoring system (base 1.0, deductions ranked by impact on agent understanding):

| Signal | Deduction | Reasoning |
|--------|-----------|-----------|
| Shadow DOM >10 roots | -0.35 | Biggest blind spot — content literally invisible to `querySelectorAll`. Agent misses all changes inside shadow trees. |
| Shadow DOM 1-10 roots | -0.15 | Some content hidden but most page still captured. |
| Iframes >5 | -0.20 | Cross-origin = invisible. Iframes skew toward ads/widgets, not primary content. |
| Iframes 1-5 | -0.10 | Minor — usually one embed or ad frame. |
| Page >5000 elements | -0.15 | Large surface area dilutes signal. Small meaningful changes get lost in noise. |
| Opacity:0 / hidden elements | -0.10 | False positive risk — text "appears" in diff when just revealed, not added. |

- Floor at 0.0
- Example outcomes: Reddit (550 shadow roots) → 0.65 → excluded. IGN (30 iframes) → 0.80 → included. Clean page → 1.0 → included.

**Key Technical Decisions:**
- Use direct text nodes only (`childNode.nodeType === 3`) to avoid parent/child duplication
- Exclude iframes entirely (cross-origin restriction)
- Skip shadow DOM in v1, note as confidence reduction
- Track text content changes on existing elements (YouTube case: same DOM structure, different video data)
- Prioritize high-z-index overlays/dialogs (Twitch error dialog) over footer changes
- Capture via `capturePageState` extension command (content script messaging), NOT `browser_evaluate` (IIFE return bug)
- Diff flow: server sends `capturePageState` → interact action → `capturePageState` → diff server-side → include in result if confidence ≥ 0.7

### Smart Waiting Implementation

**Architecture:**
- New method `_waitForPageReady()` on UnifiedBackend in `tools.ts`
- Extension command: `waitForReady` runs checks in content script (MutationObserver + network tracking)
- Auto-called after `_handleNavigate()` ONLY (navigation requiring full page reload)
- NOT an MCP tool — internal behavior enhancement, invisible to agent except faster/more reliable navigations
- Uses existing `network.ts` handler's pending request tracking (no new CDP listener)
- Default timeout: 10s
- No confidence metric for smart waiting in v1 — waiting is binary (ready or timed out)

**Readiness Algorithm (v1 - lightweight):**
1. **Network idle**: 0 pending XHR/fetch for 500ms (exclude WebSockets, EventSource)
2. **DOM stable**: no childList/subtree mutations for 300ms via MutationObserver
3. Both signals converge → ready
4. Timeout at 10s regardless

**Deliberately Excluded from v1:**
- Loader detection (too noisy: YouTube 84 hidden loaders, IGN loaders all ads, Discourse opacity:0 loader)
- Ad filtering heuristics
- Lazy image tracking
- Opacity checks
- Below-fold content monitoring

**Why This Design:**
- `readyState` is useless (React docs: complete with 16 unloaded images; SPAs never change readyState)
- Loader detection has too many false positives/negatives without complex heuristics
- Network idle + DOM stability = clean signals that handle most cases (including Reddit infinite scroll)
- ~100-150 lines vs potential 500+ with loader detection

### Testing Evidence

**Diffing Challenges Found:**
- HN: Static HTML outputs massively redundant data (LayoutTable cells, semantic nodes, InlineTextBox layers)
- GitHub trending: 3390 elements — must filter to visible + viewport
- Google search: 130 elements added, 15 suggestions — ideal granularity for diffing
- React docs SPA: 970 vs 2404 elements on different routes — completely different DOM
- StackOverflow: OneTrust SDK injected 17 children async after readyState=complete
- Reddit: 550 shadow roots, 2044 elements added via infinite scroll with ZERO loading indicators
- YouTube: same element count, different textContent — need to track text changes
- Twitch: overlay dialogs are high-priority changes (z-index clue)
- Discourse: opacity:0 loading bar = false positive for visibility
- IGN: 30 iframes, 5 visible loaders (all ad-related)

**Smart Waiting Challenges Found:**
- YouTube: scrollHeight === clientHeight (fixed container, no scroll overflow despite complex page)
- Reddit: infinite scroll loads 2044 elements silently
- Twitch: 2 legitimate spinners after 4s (one in viewport, one below fold)
- React docs: lazy images intentionally deferred, should ignore
- SPAs (React docs): URL changes via pushState don't fire load events
- Discourse: opacity:0 loader with height:3px passes bounding rect check
- IGN: all 5 visible loaders inside ad containers

### Future Enhancements (Post-v1)

**Page Diffing:**
- Shadow DOM traversal via CDP `DOM.getFlattenedDocument` (v2 priority — Reddit is a bigger target than same-origin iframes)
- Element identity tracking with composite keys (tag + position + attributes)
- Priority weighting (dialog appearing > footer text)
- Cross-iframe communication for same-origin frames

**Smart Waiting:**
- Loader detection with ad exclusion (`.closest('[class*="ad"]')`)
- Confidence metric (parallel to diffing)
- Integration with `browser_interact` onError for auto-retry
- History API watching for SPA navigation detection

**Experiment Gating:**
- Granular per-feature enable (already supported in v1 schema)
- When 5+ experiments exist, consider `list_experiments` tool or dynamic tool registration via `tools/list_changed`

## User Setup Required
- None — features are server-side and extension-side only

## Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| G1 | Experiment granularity | One feature per `experimental_features()` call. Session-scoped. |
| G2 | How agent discovers experiments | Listed in `experimental_features` tool description. |
| G3 | Dynamic tool registration | Not needed — experiments modify existing tool behavior, don't create new tools. |
| G4 | Tool naming/schema | `experimental_features({ feature_name: boolean })`. One key per call enforced. |
| 1 | Diff behavior when enabled | `browser_interact` auto-captures before/after and returns diff in result. No standalone diff tool. |
| 2 | Smart waiting scope | Auto after `_handleNavigate()` only. Not an MCP tool. Internal behavior. |
| 3 | Confidence threshold | Single threshold: 70%. Below → exclude diff, report "below threshold". Above → include full diff. |
| 4 | v2 priority | Shadow DOM traversal first (Reddit). |
| 5 | Standalone wait tool | No. Internal to navigation handler. |
| I1 | Barrel export alias | tsconfig paths `@experimental` → `./src/experimental/index.ts`. Fallback to relative imports if build fights it. |
| I2 | How diff capture runs JS | Content script messaging via `capturePageState` command. No eval. |
| I3 | Confidence score math | Base 1.0, deductions by blind-spot severity. Shadow DOM dominates. See table above. |
| I4 | Smart waiting confidence | No. Binary outcome (ready or timeout). |
| I5 | Network idle source | Existing `network.ts` handler. Imported via experimental module. |
