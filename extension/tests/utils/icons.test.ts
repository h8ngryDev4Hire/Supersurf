import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChrome } from '../__mocks__/chrome';
import { IconManager } from '../../src/utils/icons';
import { SessionContext } from '../../src/session-context';

function createMockLogger() {
  return {
    log: vi.fn(),
    logAlways: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    setDebugMode: vi.fn(),
  } as any;
}

describe('IconManager', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let sessionContext: SessionContext;
  let iconManager: IconManager;

  beforeEach(() => {
    mockChrome = createMockChrome();
    mockLogger = createMockLogger();
    sessionContext = new SessionContext();
    iconManager = new IconManager(mockChrome, mockLogger, sessionContext);
  });

  describe('init()', () => {
    it('registers a tab onActivated listener', () => {
      iconManager.init();
      expect(mockChrome.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    });

    it('registers a tab onRemoved listener', () => {
      iconManager.init();
      expect(mockChrome.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);
    });

    it('onRemoved listener clears attachedTab when the attached tab is closed', async () => {
      iconManager.init();

      // Attach a tab first
      mockChrome.tabs.query.mockResolvedValue([{ id: 42 }]);
      iconManager.setAttachedTab(42);

      // Fire tab removed for that tab
      mockChrome.tabs.onRemoved._fire(42, { windowId: 1, isWindowClosing: false });

      // Now the badge should update with no attached tab
      // We verify indirectly: if we call updateBadgeForTab and the active tab is 42,
      // it should call clearBadge since attachedTabId was nulled.
      mockChrome.tabs.query.mockResolvedValue([{ id: 42 }]);
      await iconManager.updateBadgeForTab();
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ text: '' })
      );
    });
  });

  describe('setAttachedTab()', () => {
    it('triggers badge update', async () => {
      mockChrome.tabs.query.mockResolvedValue([{ id: 10 }]);
      iconManager.setAttachedTab(10);

      // Wait for the async updateBadgeForTab to settle
      await vi.waitFor(() => {
        expect(mockChrome.tabs.query).toHaveBeenCalled();
      });
    });
  });

  describe('updateBadgeForTab()', () => {
    it('shows checkmark on the attached tab', async () => {
      iconManager.setAttachedTab(99);
      mockChrome.tabs.query.mockResolvedValue([{ id: 99 }]);

      await iconManager.updateBadgeForTab();

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '\u2713', tabId: 99 });
      expect(mockChrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#1c75bc',
        tabId: 99,
      });
      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf \u2014 Automated',
        tabId: 99,
      });
    });

    it('clears badge on non-attached tab', async () => {
      iconManager.setAttachedTab(99);
      mockChrome.tabs.query.mockResolvedValue([{ id: 50 }]);

      await iconManager.updateBadgeForTab();

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 50 });
      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf',
        tabId: 50,
      });
    });

    it('does nothing when no active tab is found', async () => {
      mockChrome.tabs.query.mockResolvedValue([]);
      await iconManager.updateBadgeForTab();

      expect(mockChrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it('does nothing when active tab has no id', async () => {
      mockChrome.tabs.query.mockResolvedValue([{ id: undefined }]);
      await iconManager.updateBadgeForTab();

      expect(mockChrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      mockChrome.tabs.query.mockRejectedValue(new Error('Tab gone'));
      // Should not throw
      await iconManager.updateBadgeForTab();
    });
  });

  describe('setStealthMode()', () => {
    it('changes badge color to stealth grey when enabled', async () => {
      iconManager.setAttachedTab(77);
      mockChrome.tabs.query.mockResolvedValue([{ id: 77 }]);

      iconManager.setStealthMode(true);

      await vi.waitFor(() => {
        expect(mockChrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
          expect.objectContaining({ color: '#333333' })
        );
      });
    });

    it('uses standard blue when stealth mode is off', async () => {
      iconManager.setAttachedTab(77);
      iconManager.setStealthMode(true);

      // Reset mocks
      mockChrome.action.setBadgeBackgroundColor.mockClear();
      mockChrome.tabs.query.mockResolvedValue([{ id: 77 }]);

      iconManager.setStealthMode(false);

      await vi.waitFor(() => {
        expect(mockChrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
          expect.objectContaining({ color: '#1c75bc' })
        );
      });
    });
  });

  describe('clearBadge()', () => {
    it('removes badge text', async () => {
      await iconManager.clearBadge(42);

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 42 });
    });

    it('sets title to default SuperSurf', async () => {
      await iconManager.clearBadge(42);

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf',
        tabId: 42,
      });
    });

    it('handles errors gracefully', async () => {
      mockChrome.action.setBadgeText.mockRejectedValueOnce(new Error('Tab gone'));
      // Should not throw
      await iconManager.clearBadge(42);
    });
  });

  describe('setGlobalIcon()', () => {
    it('sets title with the given state description', async () => {
      await iconManager.setGlobalIcon('connected' as any, 'Connected to MCP server');

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf \u2014 Connected to MCP server',
      });
    });

    it('logs the state change', async () => {
      await iconManager.setGlobalIcon('connecting' as any, 'Connecting...');

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('setGlobalIcon')
      );
    });
  });

  describe('updateConnectingBadge()', () => {
    it('delegates to setGlobalIcon with connecting state', async () => {
      await iconManager.updateConnectingBadge();

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf \u2014 Connecting...',
      });
    });
  });

  describe('updateBadge()', () => {
    it('sets badge text, color, and title for a specific tab', async () => {
      await iconManager.updateBadge(5, {
        text: 'X',
        color: '#ff0000',
        title: 'Error',
      });

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'X', tabId: 5 });
      expect(mockChrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#ff0000',
        tabId: 5,
      });
      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'SuperSurf \u2014 Error',
        tabId: 5,
      });
    });

    it('handles errors gracefully', async () => {
      mockChrome.action.setBadgeText.mockRejectedValueOnce(new Error('Tab gone'));
      // Should not throw
      await iconManager.updateBadge(5, { text: 'X', color: '#ff0000', title: 'Error' });
    });
  });
});
