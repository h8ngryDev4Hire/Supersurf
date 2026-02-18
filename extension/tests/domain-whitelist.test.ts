import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockChrome } from './__mocks__/chrome';

// Mock chrome globally before importing DomainWhitelist
let mockChrome: ReturnType<typeof createMockChrome>;

beforeEach(() => {
  mockChrome = createMockChrome();
  (globalThis as any).chrome = mockChrome;
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Must import after globalThis.chrome is set — but since ES imports are hoisted,
// we re-import via dynamic import in each test suite instead.
// Actually, vitest hoists imports but the module reads `chrome` at call time, not import time.
import { DomainWhitelist } from '../src/domain-whitelist';

describe('DomainWhitelist', () => {
  let whitelist: DomainWhitelist;

  beforeEach(() => {
    whitelist = new DomainWhitelist();
  });

  describe('init()', () => {
    it('loads enabled state from storage', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        domainWhitelistData: ['google.com', 'github.com'],
        domainWhitelistLastFetch: Date.now(),
      });

      await whitelist.init();

      expect(whitelist.enabled).toBe(true);
      expect(whitelist.getStats().domainCount).toBe(2);
    });

    it('defaults to disabled when storage is empty', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({});

      await whitelist.init();

      expect(whitelist.enabled).toBe(false);
      expect(whitelist.getStats().domainCount).toBe(0);
    });

    it('handles missing data gracefully', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        // no data array
      });

      await whitelist.init();

      expect(whitelist.enabled).toBe(true);
      expect(whitelist.getStats().domainCount).toBe(0);
    });

    it('does not make network requests', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({});
      await whitelist.init();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('enable()', () => {
    it('sets enabled state in storage', async () => {
      mockChrome.storage.local.get.mockResolvedValue({
        domainWhitelistData: ['google.com'],
        domainWhitelistLastFetch: Date.now(),
      });

      await whitelist.enable();

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ domainWhitelistEnabled: true })
      );
    });

    it('uses cached data if fresh', async () => {
      // Pre-populate via init
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: false,
        domainWhitelistData: ['google.com', 'github.com'],
        domainWhitelistLastFetch: Date.now(),
      });
      await whitelist.init();

      // Now enable — should use existing cache
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistData: ['google.com', 'github.com'],
        domainWhitelistLastFetch: Date.now(),
      });
      await whitelist.enable();

      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches when cache is stale', async () => {
      const staleTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      mockChrome.storage.local.get
        .mockResolvedValueOnce({}) // init not called, first get in enable
        .mockResolvedValueOnce({
          domainWhitelistData: ['old.com'],
          domainWhitelistLastFetch: staleTime,
        });

      // Mock fetch to fail gracefully (we're testing the fetch attempt, not ZIP parsing)
      (fetch as any).mockRejectedValueOnce(new Error('network error'));

      await whitelist.enable();

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('disable()', () => {
    it('clears in-memory set', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        domainWhitelistData: ['google.com'],
        domainWhitelistLastFetch: Date.now(),
      });
      await whitelist.init();
      expect(whitelist.getStats().domainCount).toBe(1);

      await whitelist.disable();

      expect(whitelist.enabled).toBe(false);
      expect(whitelist.getStats().domainCount).toBe(0);
    });

    it('persists disabled state', async () => {
      await whitelist.disable();

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ domainWhitelistEnabled: false })
      );
    });

    it('does not clear storage cache (for instant re-enable)', async () => {
      await whitelist.disable();

      // Should NOT have called set with domainWhitelistData = anything
      const setCalls = mockChrome.storage.local.set.mock.calls;
      for (const [arg] of setCalls) {
        expect(arg).not.toHaveProperty('domainWhitelistData');
      }
    });
  });

  describe('isDomainAllowed()', () => {
    beforeEach(async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        domainWhitelistData: ['google.com', 'github.com', 'bbc.co.uk', 'example.org'],
        domainWhitelistLastFetch: Date.now(),
      });
      await whitelist.init();
    });

    it('passes through when disabled', async () => {
      await whitelist.disable();
      expect(whitelist.isDomainAllowed('https://evil.com')).toBe(true);
    });

    it('passes through when Set is empty', async () => {
      const emptyWhitelist = new DomainWhitelist();
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        // no data
      });
      await emptyWhitelist.init();
      expect(emptyWhitelist.isDomainAllowed('https://anything.com')).toBe(true);
    });

    it('allows special schemes', () => {
      expect(whitelist.isDomainAllowed('about:blank')).toBe(true);
      expect(whitelist.isDomainAllowed('chrome://extensions')).toBe(true);
      expect(whitelist.isDomainAllowed('chrome-extension://abc/popup.html')).toBe(true);
      expect(whitelist.isDomainAllowed('data:text/html,hello')).toBe(true);
    });

    it('allows exact domain match', () => {
      expect(whitelist.isDomainAllowed('https://google.com')).toBe(true);
      expect(whitelist.isDomainAllowed('https://github.com/user/repo')).toBe(true);
    });

    it('allows subdomain match', () => {
      expect(whitelist.isDomainAllowed('https://mail.google.com')).toBe(true);
      expect(whitelist.isDomainAllowed('https://api.github.com')).toBe(true);
    });

    it('allows deep subdomain match', () => {
      expect(whitelist.isDomainAllowed('https://docs.api.github.com')).toBe(true);
    });

    it('rejects unknown domains', () => {
      expect(whitelist.isDomainAllowed('https://evilsite.com')).toBe(false);
      expect(whitelist.isDomainAllowed('https://malware.net')).toBe(false);
    });

    it('rejects partial string matches (evil-google.com != google.com)', () => {
      expect(whitelist.isDomainAllowed('https://evil-google.com')).toBe(false);
      expect(whitelist.isDomainAllowed('https://notgoogle.com')).toBe(false);
    });

    it('handles multi-level TLDs (bbc.co.uk)', () => {
      expect(whitelist.isDomainAllowed('https://bbc.co.uk')).toBe(true);
      expect(whitelist.isDomainAllowed('https://www.bbc.co.uk')).toBe(true);
      expect(whitelist.isDomainAllowed('https://news.bbc.co.uk')).toBe(true);
    });

    it('handles malformed URLs gracefully', () => {
      expect(whitelist.isDomainAllowed('not-a-url')).toBe(true);
      expect(whitelist.isDomainAllowed('')).toBe(true);
    });

    it('handles URLs with ports', () => {
      expect(whitelist.isDomainAllowed('https://google.com:8080')).toBe(true);
      expect(whitelist.isDomainAllowed('https://evil.com:443')).toBe(false);
    });
  });

  describe('refreshList()', () => {
    it('handles fetch failure gracefully', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        domainWhitelistData: ['existing.com'],
        domainWhitelistLastFetch: Date.now(),
      });
      await whitelist.init();

      (fetch as any).mockRejectedValueOnce(new Error('network error'));

      await whitelist.refreshList(); // should not throw

      // Existing data should be preserved
      expect(whitelist.getStats().domainCount).toBe(1);
    });
  });

  describe('getStats()', () => {
    it('returns current state', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({
        domainWhitelistEnabled: true,
        domainWhitelistData: ['a.com', 'b.com', 'c.com'],
        domainWhitelistLastFetch: 1700000000000,
      });
      await whitelist.init();

      const stats = whitelist.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.domainCount).toBe(3);
      expect(stats.lastFetch).toBe(1700000000000);
    });
  });
});
