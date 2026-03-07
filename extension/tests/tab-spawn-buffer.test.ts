import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the tab spawn buffer and drainSpawnedTabs command handler.
 *
 * Since the buffer and onCreated listener live in background.ts (a top-level
 * IIFE), we test the logic in isolation by reimplementing the buffer mechanics
 * and the drain algorithm — same code, just extracted for testability.
 */

const SPAWNED_TAB_TTL = 10_000;

interface BufferEntry {
  tab: { id?: number; index: number; url?: string; pendingUrl?: string; title?: string; openerTabId?: number };
  timestamp: number;
}

// Mirrors the buffer + onCreated logic from background.ts
function createBuffer() {
  const buffer: BufferEntry[] = [];

  function onCreated(tab: BufferEntry['tab'], now = Date.now()) {
    buffer.push({ tab, timestamp: now });
    const cutoff = now - SPAWNED_TAB_TTL;
    while (buffer.length > 0 && buffer[0].timestamp < cutoff) {
      buffer.shift();
    }
  }

  function drain(since: number, attachedTabId: number | null) {
    const spawned: any[] = [];
    const remaining: BufferEntry[] = [];
    for (const entry of buffer) {
      if (entry.timestamp >= since && entry.tab.id !== attachedTabId) {
        spawned.push({
          id: entry.tab.id,
          index: entry.tab.index,
          url: entry.tab.url || entry.tab.pendingUrl || '',
          title: entry.tab.title || 'New Tab',
          openerTabId: entry.tab.openerTabId ?? null,
        });
      } else if (entry.timestamp >= since) {
        remaining.push(entry);
      }
    }
    buffer.length = 0;
    buffer.push(...remaining);
    return { tabs: spawned };
  }

  return { buffer, onCreated, drain };
}

describe('Tab spawn buffer', () => {
  let buf: ReturnType<typeof createBuffer>;

  beforeEach(() => {
    buf = createBuffer();
  });

  it('buffers tab creation events', () => {
    buf.onCreated({ id: 1, index: 0, url: 'https://example.com', title: 'Example' }, 1000);
    buf.onCreated({ id: 2, index: 1, url: 'https://other.com', title: 'Other' }, 2000);
    expect(buf.buffer).toHaveLength(2);
  });

  it('evicts stale entries on insert', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    buf.onCreated({ id: 2, index: 1 }, 2000);
    // Insert at time 12000 — entry at 1000 is >10s old
    buf.onCreated({ id: 3, index: 2 }, 12000);
    expect(buf.buffer).toHaveLength(2);
    expect(buf.buffer[0].tab.id).toBe(2);
    expect(buf.buffer[1].tab.id).toBe(3);
  });

  it('evicts multiple stale entries', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    buf.onCreated({ id: 2, index: 1 }, 2000);
    buf.onCreated({ id: 3, index: 2 }, 3000);
    // All three are stale at 14000
    buf.onCreated({ id: 4, index: 3 }, 14000);
    expect(buf.buffer).toHaveLength(1);
    expect(buf.buffer[0].tab.id).toBe(4);
  });
});

describe('drainSpawnedTabs', () => {
  let buf: ReturnType<typeof createBuffer>;

  beforeEach(() => {
    buf = createBuffer();
  });

  it('returns tabs created since the given timestamp', () => {
    buf.onCreated({ id: 1, index: 0, url: 'https://old.com' }, 1000);
    buf.onCreated({ id: 2, index: 1, url: 'https://new.com', title: 'New' }, 3000);

    const result = buf.drain(2000, null);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe(2);
    expect(result.tabs[0].url).toBe('https://new.com');
    expect(result.tabs[0].title).toBe('New');
  });

  it('clears drained entries from buffer', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    buf.onCreated({ id: 2, index: 1 }, 2000);

    buf.drain(500, null);
    expect(buf.buffer).toHaveLength(0);
  });

  it('excludes attached tab from results', () => {
    buf.onCreated({ id: 10, index: 0, url: 'https://attached.com' }, 1000);
    buf.onCreated({ id: 20, index: 1, url: 'https://spawned.com' }, 1000);

    const result = buf.drain(500, 10);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe(20);
  });

  it('keeps attached tab entries in buffer after drain', () => {
    buf.onCreated({ id: 10, index: 0 }, 1000);
    buf.onCreated({ id: 20, index: 1 }, 1000);

    buf.drain(500, 10);
    // Attached tab entry stays
    expect(buf.buffer).toHaveLength(1);
    expect(buf.buffer[0].tab.id).toBe(10);
  });

  it('returns empty when no tabs match', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    const result = buf.drain(5000, null);
    expect(result.tabs).toHaveLength(0);
  });

  it('handles multiple spawned tabs', () => {
    buf.onCreated({ id: 1, index: 0, url: 'https://a.com' }, 1000);
    buf.onCreated({ id: 2, index: 1, url: 'https://b.com' }, 1000);
    buf.onCreated({ id: 3, index: 2, url: 'https://c.com' }, 1000);

    const result = buf.drain(500, null);
    expect(result.tabs).toHaveLength(3);
  });

  it('uses pendingUrl as fallback when url is empty', () => {
    buf.onCreated({ id: 1, index: 0, url: '', pendingUrl: 'https://pending.com' }, 1000);
    const result = buf.drain(500, null);
    expect(result.tabs[0].url).toBe('https://pending.com');
  });

  it('defaults title to "New Tab" when missing', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    const result = buf.drain(500, null);
    expect(result.tabs[0].title).toBe('New Tab');
  });

  it('sets openerTabId to null when undefined', () => {
    buf.onCreated({ id: 1, index: 0 }, 1000);
    const result = buf.drain(500, null);
    expect(result.tabs[0].openerTabId).toBeNull();
  });

  it('preserves openerTabId when present', () => {
    buf.onCreated({ id: 1, index: 0, openerTabId: 42 }, 1000);
    const result = buf.drain(500, null);
    expect(result.tabs[0].openerTabId).toBe(42);
  });
});
