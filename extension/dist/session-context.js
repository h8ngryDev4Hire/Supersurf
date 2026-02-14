/**
 * SessionContext — centralized extension state management.
 * Replaces fragmented state scattered across TabHandlers, IconManager, and background.ts.
 * Supports per-session state for multiplexer compatibility.
 */
function createSessionState() {
    return {
        attachedTabId: null,
        stealthMode: false,
        stealthTabs: new Map(),
        cursorPositions: new Map(),
        humanizationConfig: { enabled: false },
    };
}
export class SessionContext {
    // Global state (not per-session)
    connected = false;
    debuggerAttached = false;
    currentDebuggerTabId = null;
    // Per-session state. null key = single-client mode.
    sessions = new Map();
    getSession(sessionId) {
        const key = sessionId ?? null;
        let session = this.sessions.get(key);
        if (!session) {
            session = createSessionState();
            this.sessions.set(key, session);
        }
        return session;
    }
    deleteSession(sessionId) {
        this.sessions.delete(sessionId);
    }
    // Convenience accessors for single-client backwards compat
    // These delegate to the null-key session.
    get attachedTabId() {
        return this.getSession().attachedTabId;
    }
    set attachedTabId(value) {
        this.getSession().attachedTabId = value;
    }
    get stealthMode() {
        return this.getSession().stealthMode;
    }
    set stealthMode(value) {
        this.getSession().stealthMode = value;
    }
    get stealthTabs() {
        return this.getSession().stealthTabs;
    }
    get cursorPositions() {
        return this.getSession().cursorPositions;
    }
    get humanizationConfig() {
        return this.getSession().humanizationConfig;
    }
    set humanizationConfig(value) {
        this.getSession().humanizationConfig = value;
    }
}
