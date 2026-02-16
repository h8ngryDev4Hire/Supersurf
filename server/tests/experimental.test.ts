import { describe, it, expect, beforeEach } from 'vitest';

// Import directly — no mocks needed for pure logic modules
import {
  experimentRegistry,
  isInfraExperimentEnabled,
  applyInitialState,
  diffSnapshots,
  calculateConfidence,
  formatDiffSection,
} from '../src/experimental/index';
import type { PageState, DiffResult } from '../src/experimental/index';

// ── ExperimentRegistry ──────────────────────────────────────────

describe('ExperimentRegistry', () => {
  beforeEach(() => {
    experimentRegistry.reset();
  });

  describe('enable / disable / isEnabled', () => {
    it('starts with all experiments disabled', () => {
      expect(experimentRegistry.isEnabled('page_diffing')).toBe(false);
      expect(experimentRegistry.isEnabled('smart_waiting')).toBe(false);
    });

    it('enables an experiment', () => {
      experimentRegistry.enable('page_diffing');
      expect(experimentRegistry.isEnabled('page_diffing')).toBe(true);
    });

    it('disables an experiment', () => {
      experimentRegistry.enable('page_diffing');
      experimentRegistry.disable('page_diffing');
      expect(experimentRegistry.isEnabled('page_diffing')).toBe(false);
    });

    it('throws on unknown experiment name', () => {
      expect(() => experimentRegistry.enable('bogus')).toThrow('Unknown experiment');
      expect(() => experimentRegistry.disable('bogus')).toThrow('Unknown experiment');
    });
  });

  describe('reset()', () => {
    it('clears all enabled experiments', () => {
      experimentRegistry.enable('page_diffing');
      experimentRegistry.enable('smart_waiting');
      experimentRegistry.reset();
      expect(experimentRegistry.isEnabled('page_diffing')).toBe(false);
      expect(experimentRegistry.isEnabled('smart_waiting')).toBe(false);
    });
  });

  describe('listAvailable()', () => {
    it('returns expected experiment names', () => {
      const available = experimentRegistry.listAvailable();
      expect(available).toContain('page_diffing');
      expect(available).toContain('smart_waiting');
      expect(available).toContain('storage_inspection');
      expect(available).toContain('mouse_humanization');
      expect(available).toContain('secure_eval');
      expect(available.length).toBe(5);
    });
  });

  describe('getStates()', () => {
    it('returns state map for all experiments', () => {
      experimentRegistry.enable('smart_waiting');
      const states = experimentRegistry.getStates();
      expect(states).toEqual({ page_diffing: false, smart_waiting: true, storage_inspection: false, mouse_humanization: false, secure_eval: false });
    });
  });

  describe('isAvailable()', () => {
    it('returns true for known experiments', () => {
      expect(experimentRegistry.isAvailable('page_diffing')).toBe(true);
    });

    it('returns false for unknown experiments', () => {
      expect(experimentRegistry.isAvailable('warp_drive')).toBe(false);
    });
  });
});

// ── isInfraExperimentEnabled ────────────────────────────────────

describe('isInfraExperimentEnabled()', () => {
  it('returns false when no enabledExperiments config', () => {
    expect(isInfraExperimentEnabled('multiplexer', {})).toBe(false);
  });

  it('returns true when feature is in the list', () => {
    expect(isInfraExperimentEnabled('multiplexer', { enabledExperiments: ['multiplexer'] })).toBe(true);
  });

  it('returns false when feature is not in the list', () => {
    expect(isInfraExperimentEnabled('multiplexer', { enabledExperiments: ['other'] })).toBe(false);
  });
});

// ── applyInitialState ───────────────────────────────────────────

describe('applyInitialState()', () => {
  beforeEach(() => {
    experimentRegistry.reset();
  });

  it('pre-enables session experiments from config', () => {
    applyInitialState({ enabledExperiments: ['page_diffing', 'smart_waiting'] });
    expect(experimentRegistry.isEnabled('page_diffing')).toBe(true);
    expect(experimentRegistry.isEnabled('smart_waiting')).toBe(true);
  });

  it('silently skips infra experiments not in AVAILABLE_EXPERIMENTS', () => {
    applyInitialState({ enabledExperiments: ['multiplexer', 'page_diffing'] });
    expect(experimentRegistry.isEnabled('page_diffing')).toBe(true);
    // multiplexer doesn't throw — just skipped
  });

  it('does nothing when no config', () => {
    applyInitialState({});
    expect(experimentRegistry.isEnabled('page_diffing')).toBe(false);
  });
});

// ── Page Diffing ────────────────────────────────────────────────

describe('diffSnapshots()', () => {
  function makeState(overrides: Partial<PageState> = {}): PageState {
    return {
      elementCount: 100,
      textContent: ['Hello', 'World'],
      shadowRootCount: 0,
      iframeCount: 0,
      hiddenElementCount: 0,
      pageElementCount: 1000,
      ...overrides,
    };
  }

  it('detects added text', () => {
    const before = makeState({ textContent: ['Hello'] });
    const after = makeState({ textContent: ['Hello', 'New text'] });
    const diff = diffSnapshots(before, after);
    expect(diff.added).toEqual(['New text']);
    expect(diff.removed).toEqual([]);
  });

  it('detects removed text', () => {
    const before = makeState({ textContent: ['Hello', 'Gone'] });
    const after = makeState({ textContent: ['Hello'] });
    const diff = diffSnapshots(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['Gone']);
  });

  it('calculates element count delta', () => {
    const before = makeState({ elementCount: 100 });
    const after = makeState({ elementCount: 120 });
    const diff = diffSnapshots(before, after);
    expect(diff.countDelta).toBe(20);
  });

  it('returns empty diff when nothing changed', () => {
    const state = makeState();
    const diff = diffSnapshots(state, state);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.countDelta).toBe(0);
  });
});

describe('calculateConfidence()', () => {
  function makeState(overrides: Partial<PageState> = {}): PageState {
    return {
      elementCount: 100,
      textContent: [],
      shadowRootCount: 0,
      iframeCount: 0,
      hiddenElementCount: 0,
      pageElementCount: 1000,
      ...overrides,
    };
  }

  it('returns 1.0 for a simple page', () => {
    expect(calculateConfidence(makeState())).toBe(1.0);
  });

  it('deducts flat -0.05 for any shadow roots', () => {
    expect(calculateConfidence(makeState({ shadowRootCount: 5 }))).toBe(0.95);
  });

  it('deducts flat -0.05 for many shadow roots (same penalty)', () => {
    expect(calculateConfidence(makeState({ shadowRootCount: 15 }))).toBe(0.95);
  });

  it('deducts flat -0.05 for any iframes', () => {
    expect(calculateConfidence(makeState({ iframeCount: 3 }))).toBe(0.95);
  });

  it('deducts flat -0.05 for many iframes (same penalty)', () => {
    expect(calculateConfidence(makeState({ iframeCount: 10 }))).toBe(0.95);
  });

  it('deducts for large page (>5000 elements)', () => {
    expect(calculateConfidence(makeState({ pageElementCount: 8000 }))).toBe(0.95);
  });

  it('no penalty for hidden elements', () => {
    expect(calculateConfidence(makeState({ hiddenElementCount: 5 }))).toBe(1.0);
  });

  it('stacks flat penalties but stays high', () => {
    const worstCase = makeState({
      shadowRootCount: 20,
      iframeCount: 10,
      pageElementCount: 10000,
      hiddenElementCount: 100,
    });
    // -0.05 shadow + -0.05 iframe + -0.05 large = 0.85
    expect(calculateConfidence(worstCase)).toBeCloseTo(0.85);
  });
});

describe('formatDiffSection()', () => {
  it('includes confidence percentage', () => {
    const diff: DiffResult = { added: [], removed: [], countDelta: 0 };
    const output = formatDiffSection(diff, 0.85);
    expect(output).toContain('85%');
  });

  it('shows element count delta', () => {
    const diff: DiffResult = { added: [], removed: [], countDelta: 15 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('+15');
  });

  it('shows negative element count delta', () => {
    const diff: DiffResult = { added: [], removed: [], countDelta: -5 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('-5');
  });

  it('shows added text', () => {
    const diff: DiffResult = { added: ['New content'], removed: [], countDelta: 0 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('Added text');
    expect(output).toContain('New content');
  });

  it('shows removed text', () => {
    const diff: DiffResult = { added: [], removed: ['Old content'], countDelta: 0 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('Removed text');
    expect(output).toContain('Old content');
  });

  it('truncates long text entries', () => {
    const longText = 'A'.repeat(80);
    const diff: DiffResult = { added: [longText], removed: [], countDelta: 0 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('...');
  });

  it('limits shown entries to 5 and shows overflow count', () => {
    const diff: DiffResult = {
      added: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      removed: [],
      countDelta: 0,
    };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('+2 more');
  });

  it('shows "No visible changes" for empty diff', () => {
    const diff: DiffResult = { added: [], removed: [], countDelta: 0 };
    const output = formatDiffSection(diff, 1.0);
    expect(output).toContain('No visible changes');
  });
});
