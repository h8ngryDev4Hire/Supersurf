# Multi-Agent Session Multiplexing

**Date:** 2026-02-10
**Version:** v1

## Purpose
Explored architecture for supporting multiple AI agents using the same SuperSurf browser simultaneously, addressing limitations of the current single-client, single-browser, single-tab design.

## Summary
- **Problem:** Current architecture cannot handle concurrent agent access (e.g., two Claude Code instances or parallel subagents). WebSocket server accepts single client, state machine tracks one active session.
- **Solution:** Session multiplexing within a single MCP server acting as broker. Multiple logical sessions with isolated Chrome tab groups, eliminating need for multiple server instances.
- **Architecture:** Two-track system—Content Script operations run parallel (no serialization needed), CDP operations use serialized round-robin queue per session to prevent starvation.
- **Scope:** ~500-800 lines, 3-4 new files, 5-6 modified files. Extension-side changes are hardest (25+ handlers need session awareness).
- **Decision:** Defer until ongoing codebase rename/differentiation from Blueprint MCP completes (all file/class/function names changing).

## Research
No external research conducted—design discussion based on existing architecture and MCP SDK limitations.

## Consensus

### Architecture Design
- **Session multiplexing over multi-server:** One MCP server brokers multiple logical sessions. Avoids port conflicts, simplifies state management, aligns with MCP SDK's 1:1 StdioServerTransport model.
- **Two-track execution model:**
  - **Content Script track:** Parallel execution (Chrome handles isolation). No queue needed.
  - **CDP track:** Serialized fair round-robin queue per session. Prevents one session from monopolizing CDP debugger.
- **Split timeouts:**
  - Queue wait timeout: Scales with connected sessions (e.g., 30s base + 10s per additional session).
  - Execution timeout: Fixed 30s regardless of queue depth.
- **Round-robin scheduling:** Fair per-session rotation vs pure FIFO to prevent starvation when one session floods requests.

### Tool Domain Mapping
All 23 MCP tools mapped to execution tracks:

| Track | Tools | Count |
|-------|-------|-------|
| Chrome API (instant) | `enable`, `disable`, `status`, `experimental_features`, `browser_tabs`, `browser_navigate` (url/reload), `browser_window`, `browser_list_extensions`, `browser_reload_extensions` | 9 |
| Content Script (parallel) | `secure_fill`, `browser_console_messages`, `browser_handle_dialog`, `browser_verify_text_visible`, `browser_verify_element_visible` | 5 |
| CDP (serialized queue) | `browser_interact`, `browser_drag`, `browser_snapshot`, `browser_lookup`, `browser_extract_content`, `browser_get_element_styles`, `browser_take_screenshot`, `browser_evaluate`, `browser_fill_form`, `browser_navigate` (back/forward), `browser_pdf_save`, `browser_performance_metrics`, `browser_network_requests` | 13 |

### Experimental Feature Gating
- Can gate behind `experimentRegistry.isEnabled('multi_session')` but architectural difference noted.
- Existing experiments (`page_diffing`, `smart_waiting`) are lightweight wrappers; this is deep plumbing.
- Gating useful for gradual rollout despite structural differences.

### Implementation Deferral
- Agreed to defer until codebase rename completes.
- Rename affects file names, class names (`StatefulBackend`, `UnifiedBackend`), and general differentiation from Blueprint MCP reference code.
- Building session multiplexing on unstable foundation would require immediate refactor.

## User Setup Required
No manual setup steps—architectural planning only.

## Open Questions
- [ ] How should session IDs be generated and assigned? (UUID? Sequential? Agent-provided?)
- [ ] Should tab groups persist across server restarts? (Chrome profile remembers groups, but session-to-group mapping?)
- [ ] What happens when primary agent disconnects but subagent sessions remain active?
- [ ] Should there be a configurable max concurrent sessions limit?
- [ ] How should session creation be exposed in MCP tools? (Implicit on first `enable` call with session_id param? Explicit `create_session` tool?)
- [ ] Testing strategy without existing test infrastructure? (Integration tests via MCP Inspector? Unit tests for scheduler alone?)
