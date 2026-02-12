import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot, onLookup, onExtractContent } from '../src/tools/content';
import type { ToolContext } from '../src/tools/types';

function createMockCtx(): ToolContext {
  return {
    ext: { sendCmd: vi.fn().mockResolvedValue({}) } as any,
    connectionManager: null,
    cdp: vi.fn().mockResolvedValue({}),
    eval: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    getElementCenter: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    getSelectorExpression: vi.fn((s) => `document.querySelector("${s}")`),
    findAlternativeSelectors: vi.fn().mockResolvedValue([]),
    formatResult: vi.fn((_n, r) => ({ content: [{ type: 'text', text: JSON.stringify(r) }] })),
    error: vi.fn((msg) => ({ content: [{ type: 'text', text: msg }], isError: true })),
  };
}

describe('onSnapshot()', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('returns formatted accessibility tree', async () => {
    (ctx.ext.sendCmd as any).mockResolvedValue({
      nodes: [
        { role: { value: 'button' }, name: { value: 'Submit' }, depth: 0 },
        { role: { value: 'textbox' }, name: { value: 'Email' }, depth: 1 },
      ],
    });

    const result = await onSnapshot(ctx, {});
    expect(result.content[0].text).toContain('[button] Submit');
    expect(result.content[0].text).toContain('[textbox] Email');
  });

  it('skips none/generic roles', async () => {
    (ctx.ext.sendCmd as any).mockResolvedValue({
      nodes: [
        { role: { value: 'none' }, name: { value: 'skip' }, depth: 0 },
        { role: { value: 'generic' }, name: { value: 'skip2' }, depth: 0 },
        { role: { value: 'heading' }, name: { value: 'Title' }, depth: 0 },
      ],
    });

    const result = await onSnapshot(ctx, {});
    expect(result.content[0].text).not.toContain('skip');
    expect(result.content[0].text).toContain('[heading] Title');
  });

  it('handles empty tree', async () => {
    (ctx.ext.sendCmd as any).mockResolvedValue({ nodes: [] });
    const result = await onSnapshot(ctx, {});
    expect(result.content[0].text).toContain('Empty accessibility tree');
  });

  it('returns raw result when rawResult is true', async () => {
    const mockData = { nodes: [{ role: { value: 'button' } }] };
    (ctx.ext.sendCmd as any).mockResolvedValue(mockData);
    const result = await onSnapshot(ctx, { rawResult: true });
    expect(result).toEqual(mockData);
  });
});

describe('onLookup()', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('returns found elements', async () => {
    (ctx.eval as any).mockResolvedValue({
      matches: [
        { selector: 'button#submit', visible: true, text: 'Submit', tag: 'button', x: 100, y: 200 },
      ],
      total: 1,
    });

    const result = await onLookup(ctx, { text: 'Submit' }, {});
    expect(result.content[0].text).toContain('Submit');
    expect(result.content[0].text).toContain('button#submit');
  });

  it('returns message when no elements found', async () => {
    (ctx.eval as any).mockResolvedValue({ matches: [], total: 0 });
    const result = await onLookup(ctx, { text: 'nonexistent' }, {});
    expect(result.content[0].text).toContain('No elements found');
  });

  it('returns raw result when rawResult is true', async () => {
    const mockData = { matches: [{ selector: 'div' }], total: 1 };
    (ctx.eval as any).mockResolvedValue(mockData);
    const result = await onLookup(ctx, { text: 'test' }, { rawResult: true });
    expect(result).toEqual(mockData);
  });
});

describe('onExtractContent()', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('returns extracted markdown lines', async () => {
    (ctx.eval as any).mockResolvedValue({
      lines: ['# Hello', 'Some content', 'More content'],
    });

    const result = await onExtractContent(ctx, { mode: 'auto' }, {});
    expect(result.content[0].text).toContain('# Hello');
    expect(result.content[0].text).toContain('Some content');
  });

  it('respects offset and max_lines', async () => {
    (ctx.eval as any).mockResolvedValue({
      lines: ['line0', 'line1', 'line2', 'line3', 'line4'],
    });

    const result = await onExtractContent(ctx, { mode: 'full', offset: 1, max_lines: 2 }, { rawResult: true });
    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(5);
  });

  it('handles error from content extraction', async () => {
    (ctx.eval as any).mockResolvedValue({ error: 'No content element found' });
    await onExtractContent(ctx, { mode: 'selector', selector: '.missing' }, {});
    expect(ctx.error).toHaveBeenCalledWith('No content element found', expect.anything());
  });

  it('returns raw result when rawResult is true', async () => {
    (ctx.eval as any).mockResolvedValue({ lines: ['hello'] });
    const result = await onExtractContent(ctx, {}, { rawResult: true });
    expect(result.lines).toEqual(['hello']);
    expect(result.total).toBe(1);
  });
});
