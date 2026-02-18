import { describe, it, expect, beforeEach } from 'vitest';
import { SessionContext } from '../src/session-context';

describe('SessionContext', () => {
  let ctx: SessionContext;

  beforeEach(() => {
    ctx = new SessionContext();
  });

  describe('global state', () => {
    it('defaults connected to false', () => {
      expect(ctx.connected).toBe(false);
    });

    it('defaults debuggerAttached to false', () => {
      expect(ctx.debuggerAttached).toBe(false);
    });

    it('defaults currentDebuggerTabId to null', () => {
      expect(ctx.currentDebuggerTabId).toBeNull();
    });

    it('allows setting global state', () => {
      ctx.connected = true;
      ctx.debuggerAttached = true;
      ctx.currentDebuggerTabId = 42;

      expect(ctx.connected).toBe(true);
      expect(ctx.debuggerAttached).toBe(true);
      expect(ctx.currentDebuggerTabId).toBe(42);
    });
  });

  describe('getSession()', () => {
    it('creates a session lazily on first access', () => {
      const session = ctx.getSession('session-1');
      expect(session).toBeDefined();
      expect(session.attachedTabId).toBeNull();
      expect(session.stealthMode).toBe(false);
      expect(session.stealthTabs).toBeInstanceOf(Map);
      expect(session.cursorPositions).toBeInstanceOf(Map);
      expect(session.humanizationConfig.enabled).toBe(false);
    });

    it('returns the same session on repeated access', () => {
      const s1 = ctx.getSession('session-1');
      const s2 = ctx.getSession('session-1');
      expect(s1).toBe(s2);
    });

    it('isolates different sessions', () => {
      const s1 = ctx.getSession('session-1');
      const s2 = ctx.getSession('session-2');
      expect(s1).not.toBe(s2);

      s1.attachedTabId = 10;
      s2.attachedTabId = 20;
      expect(s1.attachedTabId).toBe(10);
      expect(s2.attachedTabId).toBe(20);
    });

    it('uses null key for default/single-client session', () => {
      const defaultSession = ctx.getSession();
      const nullSession = ctx.getSession(null);
      expect(defaultSession).toBe(nullSession);
    });
  });

  describe('deleteSession()', () => {
    it('removes a session', () => {
      const s = ctx.getSession('temp');
      s.attachedTabId = 99;

      ctx.deleteSession('temp');

      // Getting it again creates a fresh session
      const s2 = ctx.getSession('temp');
      expect(s2.attachedTabId).toBeNull();
      expect(s2).not.toBe(s);
    });
  });

  describe('convenience accessors', () => {
    it('attachedTabId delegates to null-key session', () => {
      expect(ctx.attachedTabId).toBeNull();

      ctx.attachedTabId = 42;
      expect(ctx.attachedTabId).toBe(42);
      expect(ctx.getSession().attachedTabId).toBe(42);
    });

    it('stealthMode delegates to null-key session', () => {
      expect(ctx.stealthMode).toBe(false);

      ctx.stealthMode = true;
      expect(ctx.stealthMode).toBe(true);
      expect(ctx.getSession().stealthMode).toBe(true);
    });

    it('stealthTabs delegates to null-key session', () => {
      const tabs = ctx.stealthTabs;
      expect(tabs).toBeInstanceOf(Map);

      tabs.set(1, true);
      expect(ctx.getSession().stealthTabs.get(1)).toBe(true);
    });

    it('cursorPositions delegates to null-key session', () => {
      const positions = ctx.cursorPositions;
      expect(positions).toBeInstanceOf(Map);

      positions.set(1, { x: 100, y: 200 });
      expect(ctx.getSession().cursorPositions.get(1)).toEqual({ x: 100, y: 200 });
    });

    it('humanizationConfig delegates to null-key session', () => {
      expect(ctx.humanizationConfig.enabled).toBe(false);

      ctx.humanizationConfig = { enabled: true };
      expect(ctx.humanizationConfig.enabled).toBe(true);
      expect(ctx.getSession().humanizationConfig.enabled).toBe(true);
    });
  });
});
