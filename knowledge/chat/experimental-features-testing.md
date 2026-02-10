# Experimental Features Testing

**Date:** 2026-02-09
**Version:** v1

## Purpose
Implementation and live validation of two experimental SuperSurf features: page diffing (incremental DOM change detection) and smart waiting (adaptive navigation timing).

## Summary
- Built opt-in experimental feature system gated behind `experimental_features` MCP tool
- Page diffing returns only DOM changes after interactions instead of requiring full re-reads, includes confidence scoring for accuracy transparency
- Smart waiting replaces hardcoded 1500ms delays with MutationObserver + network idle detection
- All experimental code isolated in `experimental/` directories with minimal touchpoints in stable code
- Live testing across real-world sites (Reddit, HN, MBARI, Smithsonian) validated both features work independently and together
- Extension tests directory renamed from `__tests__` to `tests` to fix Chrome unpacked extension underscore restriction

## Implementation Details

**Files Created:**
- `server/src/experimental/index.ts` — ExperimentRegistry singleton
- `server/src/experimental/page-diffing.ts` — diffSnapshots, confidence scoring
- `extension/src/experimental/capture-page-state.ts` — Injected via chrome.scripting.executeScript
- `extension/src/experimental/wait-for-ready.ts` — MutationObserver-based stability check
- `extension/src/experimental/index.ts` — Handler registration

**Files Modified:**
- `server/src/backend.ts` — Added experimental_features tool (2 lines)
- `server/src/tools.ts` — Before/after capture in _handleInteract, smart waiting in _handleNavigate
- `extension/src/background.ts` — Import + registerHandlers (2 lines)

## Testing Results

All tests conducted live via MCP tools in real Chrome:

| Feature | Test Cases | Status |
|---------|------------|--------|
| Page diffing | Added text, removed text, batch mutations (3 items), confidence scoring (90% simple, 45% Reddit) | Pass (18/18) |
| Smart waiting | url/back/forward/reload navigation, fallback to 1500ms when disabled | Pass (8/8) |
| Integration | Both features simultaneously on real-world pages, full web search workflow | Pass |

## Consensus
- Features remain experimental — no promotion to stable until refinements complete
- No unit tests required yet (acceptable for experimental status)
- Content-script.ts stays untouched — experimental functions injected via chrome.scripting.executeScript
- All 102 server tests + 189 extension tests pass post-implementation

## Open Questions
- [ ] **SPA accuracy:** Does text-based diffing miss React/Vue virtual DOM state changes? Need heavy SPA testing.
- [ ] **Confidence calibration:** Are 0.7 threshold and current penalty weights optimal? Need real-world data.
- [ ] **Smart waiting edge cases:** How to handle pages with infinite polling (WebSocket, live feeds)? Need max ceiling + polling heuristic.
- [ ] **Diff output format:** Should diffs show semantic context (element type, parent) instead of raw text strings?
- [ ] **Performance measurement:** What are actual time savings from smart waiting? Need elapsed time logging.
- [ ] **Unit test coverage:** When to write tests for ExperimentRegistry, diffSnapshots, calculateConfidence?
