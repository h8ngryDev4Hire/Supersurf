import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChrome } from '../__mocks__/chrome';
import { ConsoleHandler } from '../../src/handlers/console';

function createMockLogger() {
  return {
    log: vi.fn(),
    logAlways: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    setDebugMode: vi.fn(),
  } as any;
}

describe('ConsoleHandler', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handler: ConsoleHandler;

  beforeEach(() => {
    mockChrome = createMockChrome();
    mockLogger = createMockLogger();
    handler = new ConsoleHandler(mockChrome, mockLogger);
  });

  describe('addMessage()', () => {
    it('stores a single message', () => {
      handler.addMessage({ level: 'log', text: 'hello', timestamp: 1000 });
      expect(handler.getMessages()).toHaveLength(1);
      expect(handler.getMessages()[0]).toEqual({
        level: 'log',
        text: 'hello',
        timestamp: 1000,
      });
    });

    it('stores multiple messages in order', () => {
      handler.addMessage({ level: 'log', text: 'first', timestamp: 1 });
      handler.addMessage({ level: 'warn', text: 'second', timestamp: 2 });
      handler.addMessage({ level: 'error', text: 'third', timestamp: 3 });

      const messages = handler.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].text).toBe('first');
      expect(messages[1].text).toBe('second');
      expect(messages[2].text).toBe('third');
    });

    it('enforces MAX_MESSAGES (1000) limit by removing oldest', () => {
      // Fill to the max
      for (let i = 0; i < 1000; i++) {
        handler.addMessage({ level: 'log', text: `msg-${i}`, timestamp: i });
      }
      expect(handler.getMessages()).toHaveLength(1000);

      // Adding one more should evict the oldest
      handler.addMessage({ level: 'log', text: 'overflow', timestamp: 9999 });
      const messages = handler.getMessages();
      expect(messages).toHaveLength(1000);
      expect(messages[0].text).toBe('msg-1'); // msg-0 was evicted
      expect(messages[messages.length - 1].text).toBe('overflow');
    });

    it('stores messages with tabId', () => {
      handler.addMessage({ level: 'log', text: 'tabbed', timestamp: 1, tabId: 42 });
      expect(handler.getMessages()[0].tabId).toBe(42);
    });
  });

  describe('getMessages()', () => {
    it('returns all messages when called without tabId', () => {
      handler.addMessage({ level: 'log', text: 'a', timestamp: 1, tabId: 1 });
      handler.addMessage({ level: 'log', text: 'b', timestamp: 2, tabId: 2 });

      expect(handler.getMessages()).toHaveLength(2);
    });

    it('returns a copy of the messages array', () => {
      handler.addMessage({ level: 'log', text: 'a', timestamp: 1 });

      const messages = handler.getMessages();
      messages.push({ level: 'log', text: 'injected', timestamp: 999 });

      // Original should be unaffected
      expect(handler.getMessages()).toHaveLength(1);
    });

    it('filters by tabId when provided', () => {
      handler.addMessage({ level: 'log', text: 'tab1-a', timestamp: 1, tabId: 1 });
      handler.addMessage({ level: 'log', text: 'tab2-a', timestamp: 2, tabId: 2 });
      handler.addMessage({ level: 'log', text: 'tab1-b', timestamp: 3, tabId: 1 });

      const tab1Messages = handler.getMessages(1);
      expect(tab1Messages).toHaveLength(2);
      expect(tab1Messages[0].text).toBe('tab1-a');
      expect(tab1Messages[1].text).toBe('tab1-b');
    });

    it('returns empty array when filtering by nonexistent tabId', () => {
      handler.addMessage({ level: 'log', text: 'a', timestamp: 1, tabId: 1 });

      expect(handler.getMessages(999)).toHaveLength(0);
    });
  });

  describe('clearMessages()', () => {
    it('empties the messages array', () => {
      handler.addMessage({ level: 'log', text: 'a', timestamp: 1 });
      handler.addMessage({ level: 'log', text: 'b', timestamp: 2 });
      expect(handler.getMessages()).toHaveLength(2);

      handler.clearMessages();
      expect(handler.getMessages()).toHaveLength(0);
    });

    it('allows new messages after clearing', () => {
      handler.addMessage({ level: 'log', text: 'before', timestamp: 1 });
      handler.clearMessages();
      handler.addMessage({ level: 'log', text: 'after', timestamp: 2 });

      expect(handler.getMessages()).toHaveLength(1);
      expect(handler.getMessages()[0].text).toBe('after');
    });
  });

  describe('setupMessageListener()', () => {
    it('registers a chrome.runtime.onMessage handler', () => {
      handler.setupMessageListener();
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it('calls addMessage for messages with type "console"', () => {
      handler.setupMessageListener();

      const sender = { tab: { id: 5 } };
      mockChrome.runtime.onMessage._fire(
        { type: 'console', level: 'warn', text: 'test warning', timestamp: 1234 },
        sender
      );

      const messages = handler.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        level: 'warn',
        text: 'test warning',
        timestamp: 1234,
        tabId: 5,
      });
    });

    it('uses Date.now() as default timestamp when message has no timestamp', () => {
      handler.setupMessageListener();

      const now = Date.now();
      mockChrome.runtime.onMessage._fire(
        { type: 'console', level: 'log', text: 'no-ts' },
        { tab: { id: 1 } }
      );

      const messages = handler.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(now);
    });

    it('ignores messages with type other than "console"', () => {
      handler.setupMessageListener();

      mockChrome.runtime.onMessage._fire(
        { type: 'network', data: 'something' },
        { tab: { id: 1 } }
      );

      expect(handler.getMessages()).toHaveLength(0);
    });

    it('handles sender without tab gracefully', () => {
      handler.setupMessageListener();

      mockChrome.runtime.onMessage._fire(
        { type: 'console', level: 'log', text: 'no tab', timestamp: 100 },
        {} // no tab property
      );

      const messages = handler.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].tabId).toBeUndefined();
    });
  });

  describe('injectConsoleCapture()', () => {
    it('calls chrome.scripting.executeScript with correct target', async () => {
      await handler.injectConsoleCapture(42);

      expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.target).toEqual({ tabId: 42 });
      expect(callArg.world).toBe('MAIN');
      expect(typeof callArg.func).toBe('function');
    });

    it('handles injection failure gracefully', async () => {
      mockChrome.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot inject'));

      // Should not throw
      await handler.injectConsoleCapture(42);
      expect(mockLogger.log).toHaveBeenCalled();
    });
  });
});
