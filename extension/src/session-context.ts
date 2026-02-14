/**
 * SessionContext — centralized extension state management.
 * Replaces fragmented state scattered across TabHandlers, IconManager, and background.ts.
 * Supports per-session state for multiplexer compatibility.
 */

export interface HumanizationConfig {
  enabled: boolean;
}

export interface SessionState {
  attachedTabId: number | null;
  stealthMode: boolean;
  stealthTabs: Map<number, boolean>;
  cursorPositions: Map<number, { x: number; y: number }>;
  humanizationConfig: HumanizationConfig;
}

function createSessionState(): SessionState {
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
  connected: boolean = false;
  debuggerAttached: boolean = false;
  currentDebuggerTabId: number | null = null;

  // Per-session state. null key = single-client mode.
  private sessions: Map<string | null, SessionState> = new Map();

  getSession(sessionId?: string | null): SessionState {
    const key = sessionId ?? null;
    let session = this.sessions.get(key);
    if (!session) {
      session = createSessionState();
      this.sessions.set(key, session);
    }
    return session;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Convenience accessors for single-client backwards compat
  // These delegate to the null-key session.

  get attachedTabId(): number | null {
    return this.getSession().attachedTabId;
  }

  set attachedTabId(value: number | null) {
    this.getSession().attachedTabId = value;
  }

  get stealthMode(): boolean {
    return this.getSession().stealthMode;
  }

  set stealthMode(value: boolean) {
    this.getSession().stealthMode = value;
  }

  get stealthTabs(): Map<number, boolean> {
    return this.getSession().stealthTabs;
  }

  get cursorPositions(): Map<number, { x: number; y: number }> {
    return this.getSession().cursorPositions;
  }

  get humanizationConfig(): HumanizationConfig {
    return this.getSession().humanizationConfig;
  }

  set humanizationConfig(value: HumanizationConfig) {
    this.getSession().humanizationConfig = value;
  }
}
