import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChrome } from '../__mocks__/chrome';
import { DialogHandler } from '../../src/handlers/dialogs';

function createMockLogger() {
  return {
    log: vi.fn(),
    logAlways: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    setDebugMode: vi.fn(),
  } as any;
}

describe('DialogHandler', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handler: DialogHandler;

  beforeEach(() => {
    mockChrome = createMockChrome();
    mockLogger = createMockLogger();
    handler = new DialogHandler(mockChrome, mockLogger);
  });

  describe('setupDialogOverrides()', () => {
    it('calls chrome.scripting.executeScript with correct target and world', async () => {
      await handler.setupDialogOverrides(42);

      expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.target).toEqual({ tabId: 42 });
      expect(callArg.world).toBe('MAIN');
      expect(typeof callArg.func).toBe('function');
    });

    it('passes accept=true and empty promptText as default args', async () => {
      await handler.setupDialogOverrides(42);

      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.args).toEqual([true, '']);
    });

    it('passes custom accept and promptText args', async () => {
      await handler.setupDialogOverrides(42, false, 'custom text');

      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.args).toEqual([false, 'custom text']);
    });

    it('handles errors gracefully', async () => {
      mockChrome.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot inject'));

      // Should not throw
      await handler.setupDialogOverrides(42);
      expect(mockLogger.log).toHaveBeenCalled();
    });
  });

  describe('getDialogEvents()', () => {
    it('calls chrome.scripting.executeScript with correct target', async () => {
      await handler.getDialogEvents(42);

      expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.target).toEqual({ tabId: 42 });
      expect(callArg.world).toBe('MAIN');
    });

    it('returns the result from executeScript', async () => {
      const mockEvents = [
        { type: 'alert', message: 'Hello', response: 'accepted', timestamp: 1000 },
      ];
      mockChrome.scripting.executeScript.mockResolvedValueOnce([{ result: mockEvents }]);

      const events = await handler.getDialogEvents(42);
      expect(events).toEqual(mockEvents);
    });

    it('returns empty array when no events exist', async () => {
      mockChrome.scripting.executeScript.mockResolvedValueOnce([{ result: [] }]);

      const events = await handler.getDialogEvents(42);
      expect(events).toEqual([]);
    });

    it('returns empty array when executeScript returns null result', async () => {
      mockChrome.scripting.executeScript.mockResolvedValueOnce([{ result: null }]);

      const events = await handler.getDialogEvents(42);
      expect(events).toEqual([]);
    });

    it('returns empty array when executeScript returns undefined', async () => {
      mockChrome.scripting.executeScript.mockResolvedValueOnce(undefined);

      const events = await handler.getDialogEvents(42);
      expect(events).toEqual([]);
    });

    it('returns empty array on failure', async () => {
      mockChrome.scripting.executeScript.mockRejectedValueOnce(new Error('Tab gone'));

      const events = await handler.getDialogEvents(42);
      expect(events).toEqual([]);
    });
  });

  describe('clearDialogEvents()', () => {
    it('calls chrome.scripting.executeScript with correct target', async () => {
      await handler.clearDialogEvents(42);

      expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
      const callArg = mockChrome.scripting.executeScript.mock.calls[0][0];
      expect(callArg.target).toEqual({ tabId: 42 });
      expect(callArg.world).toBe('MAIN');
    });

    it('handles errors gracefully', async () => {
      mockChrome.scripting.executeScript.mockRejectedValueOnce(new Error('Tab gone'));

      // Should not throw
      await handler.clearDialogEvents(42);
    });
  });
});
