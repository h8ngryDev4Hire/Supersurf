import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatefulBackend, BackendConfig } from '../src/backend';

// ---- Mocks ----

// Mock the logger module
vi.mock('../src/logger', () => ({
  getLogger: () => ({
    log: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}));

// Mock ExtensionServer
const mockExtensionServerInstance = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  setClientId: vi.fn(),
  isConnected: vi.fn().mockReturnValue(false),
  getBuildTimestamp: vi.fn().mockReturnValue(null),
  getBrowserType: vi.fn().mockReturnValue('chrome'),
  onReconnect: null as (() => void) | null,
  onTabInfoUpdate: null as ((tabInfo: any) => void) | null,
};

vi.mock('../src/extensionServer', () => ({
  ExtensionServer: vi.fn(function () {
    return mockExtensionServerInstance;
  }),
}));

// Mock DirectTransport
vi.mock('../src/transport', () => ({
  Transport: class {},
  DirectTransport: vi.fn(function () {
    return {
      sendCommand: vi.fn(),
      close: vi.fn(),
    };
  }),
}));

// Mock the tools module (lazy import)
const mockActiveBackendInstance = {
  initialize: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue([
    { name: 'browser_tabs', description: 'Tab management', inputSchema: { type: 'object' } },
  ]),
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  serverClosed: vi.fn(),
};

vi.mock('../src/tools', () => {
  // Must use a function (not arrow) so it can be called with `new`
  const MockUnifiedBackend = vi.fn(function (this: any) {
    Object.assign(this, mockActiveBackendInstance);
  });
  return { UnifiedBackend: MockUnifiedBackend };
});

// ---- Helpers ----

function makeConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    debug: false,
    port: 5555,
    server: { name: 'supersurf', version: '0.1.0' },
    ...overrides,
  };
}

function makeMockServer() {
  return {
    sendToolsListChanged: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ---- Tests ----

describe('StatefulBackend', () => {
  let backend: StatefulBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state for ExtensionServer instance
    mockExtensionServerInstance.start.mockResolvedValue(undefined);
    mockExtensionServerInstance.stop.mockResolvedValue(undefined);
    mockExtensionServerInstance.getBuildTimestamp.mockReturnValue(null);
    mockExtensionServerInstance.onReconnect = null;
    mockExtensionServerInstance.onTabInfoUpdate = null;

    backend = new StatefulBackend(makeConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Constructor ----

  describe('constructor', () => {
    it('starts in passive state', async () => {
      const result = await backend.callTool('status', {}, { rawResult: true });
      expect(result.state).toBe('passive');
    });

    it('stores config correctly', async () => {
      // Verify through status header that version is used
      const header = backend._getStatusHeader();
      expect(header).toContain('v0.1.0');
    });
  });

  // ---- initialize ----

  describe('initialize()', () => {
    it('stores server and clientInfo', async () => {
      const server = makeMockServer();
      const clientInfo = { name: 'test-client', version: '1.0' };
      await backend.initialize(server, clientInfo);

      // Verify server is stored by enabling then disabling — it should call sendToolsListChanged
      await backend.callTool('enable', { client_id: 'test' });
      expect(server.sendToolsListChanged).toHaveBeenCalled();
    });
  });

  // ---- callTool('enable') ----

  describe('callTool("enable")', () => {
    beforeEach(async () => {
      await backend.initialize(makeMockServer(), {});
    });

    it('transitions to active state', async () => {
      const result = await backend.callTool('enable', { client_id: 'my-project' }, { rawResult: true });

      expect(result.success).toBe(true);
      expect(result.state).toBe('active');
      expect(result.client_id).toBe('my-project');
      expect(result.port).toBe(5555);
    });

    it('starts ExtensionServer', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      expect(mockExtensionServerInstance.start).toHaveBeenCalled();
    });

    it('sets client ID on ExtensionServer', async () => {
      await backend.callTool('enable', { client_id: 'my-project' });
      expect(mockExtensionServerInstance.setClientId).toHaveBeenCalledWith('my-project');
    });

    it('returns error without client_id', async () => {
      const result = await backend.callTool('enable', {}, { rawResult: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_client_id');
    });

    it('returns error with empty client_id', async () => {
      const result = await backend.callTool('enable', { client_id: '   ' }, { rawResult: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_client_id');
    });

    it('returns MCP-formatted error without client_id when rawResult is false', async () => {
      const result = await backend.callTool('enable', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('client_id');
    });

    it('returns "already enabled" when already active', async () => {
      await backend.callTool('enable', { client_id: 'test' });

      const result = await backend.callTool('enable', { client_id: 'test' }, { rawResult: true });
      expect(result.already_enabled).toBe(true);
      expect(result.state).toBe('active');
    });

    it('returns MCP-formatted "already enabled" when rawResult is false', async () => {
      await backend.callTool('enable', { client_id: 'test' });

      const result = await backend.callTool('enable', { client_id: 'other' });
      expect(result.content[0].text).toContain('Already Enabled');
    });

    it('initializes UnifiedBackend with correct args', async () => {
      const { UnifiedBackend } = await import('../src/tools');
      await backend.callTool('enable', { client_id: 'test' });
      expect(UnifiedBackend).toHaveBeenCalled();
      expect(mockActiveBackendInstance.initialize).toHaveBeenCalled();
    });

    it('handles start failure gracefully', async () => {
      mockExtensionServerInstance.start.mockRejectedValueOnce(new Error('EADDRINUSE'));

      const result = await backend.callTool('enable', { client_id: 'test' }, { rawResult: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('port_in_use');
    });

    it('handles non-port start failure', async () => {
      mockExtensionServerInstance.start.mockRejectedValueOnce(new Error('Something else'));

      const result = await backend.callTool('enable', { client_id: 'test' }, { rawResult: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('connection_failed');
    });

    it('trims whitespace from client_id', async () => {
      const result = await backend.callTool('enable', { client_id: '  trimmed  ' }, { rawResult: true });
      expect(result.client_id).toBe('trimmed');
    });
  });

  // ---- callTool('disable') ----

  describe('callTool("disable")', () => {
    beforeEach(async () => {
      await backend.initialize(makeMockServer(), {});
    });

    it('transitions back to passive from active', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      const result = await backend.callTool('disable', {}, { rawResult: true });

      expect(result.success).toBe(true);
      expect(result.state).toBe('passive');
    });

    it('stops ExtensionServer on disable', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      await backend.callTool('disable');
      expect(mockExtensionServerInstance.stop).toHaveBeenCalled();
    });

    it('calls serverClosed on activeBackend', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      await backend.callTool('disable');
      expect(mockActiveBackendInstance.serverClosed).toHaveBeenCalled();
    });

    it('returns "already disabled" when passive', async () => {
      const result = await backend.callTool('disable', {}, { rawResult: true });
      expect(result.already_disabled).toBe(true);
      expect(result.state).toBe('passive');
    });

    it('returns MCP-formatted "already disabled" when rawResult is false', async () => {
      const result = await backend.callTool('disable');
      expect(result.content[0].text).toContain('Already Disabled');
    });

    it('clears attached tab and browser name', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({ id: 1, index: 0, title: 'Test', url: 'http://test.com' });
      backend.setConnectedBrowserName('Chrome');

      await backend.callTool('disable');

      const status = await backend.callTool('status', {}, { rawResult: true });
      expect(status.attached_tab).toBeNull();
      expect(status.browser).toBeNull();
    });
  });

  // ---- callTool('status') ----

  describe('callTool("status")', () => {
    beforeEach(async () => {
      await backend.initialize(makeMockServer(), {});
    });

    it('returns correct state info for passive', async () => {
      const result = await backend.callTool('status', {}, { rawResult: true });
      expect(result.state).toBe('passive');
      expect(result.browser).toBeNull();
      expect(result.client_id).toBeNull();
      expect(result.attached_tab).toBeNull();
    });

    it('returns MCP-formatted passive status', async () => {
      const result = await backend.callTool('status');
      expect(result.content[0].text).toContain('Disabled');
    });

    it('returns correct state info for active', async () => {
      await backend.callTool('enable', { client_id: 'my-project' });

      const result = await backend.callTool('status', {}, { rawResult: true });
      expect(result.state).toBe('active');
      expect(result.browser).toBe('Local Browser');
      expect(result.client_id).toBe('my-project');
    });

    it('includes attached tab info when available', async () => {
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({ id: 1, index: 3, title: 'Google', url: 'https://google.com' });

      const result = await backend.callTool('status', {}, { rawResult: true });
      expect(result.attached_tab).toEqual({
        index: 3,
        title: 'Google',
        url: 'https://google.com',
      });
    });

    it('shows "No tab attached" in MCP format when no tab', async () => {
      await backend.callTool('enable', { client_id: 'test' });

      const result = await backend.callTool('status');
      expect(result.content[0].text).toContain('No tab attached');
    });
  });

  // ---- callTool with unknown tool when not active ----

  describe('callTool with unknown tool when not active', () => {
    it('returns error (rawResult)', async () => {
      const result = await backend.callTool('browser_tabs', { action: 'list' }, { rawResult: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe('not_enabled');
    });

    it('returns MCP-formatted error', async () => {
      const result = await backend.callTool('browser_tabs', { action: 'list' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not Active');
    });
  });

  // ---- callTool with unknown tool when active ----

  describe('callTool with browser tool when active', () => {
    beforeEach(async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
    });

    it('forwards to active backend', async () => {
      await backend.callTool('browser_tabs', { action: 'list' });
      expect(mockActiveBackendInstance.callTool).toHaveBeenCalledWith(
        'browser_tabs',
        { action: 'list' },
        {}
      );
    });
  });

  // ---- callTool('reload_mcp') ----

  describe('callTool("reload_mcp")', () => {
    it('returns error when not in debug mode', () => {
      const result = (backend as any).callTool('reload_mcp');
      // This is synchronous internally, but callTool is async
      return result.then((r: any) => {
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toContain('debug mode');
      });
    });

    it('triggers reload in debug mode', async () => {
      const debugBackend = new StatefulBackend(makeConfig({ debug: true }));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      vi.useFakeTimers();

      const result = await debugBackend.callTool('reload_mcp', {}, { rawResult: true });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Reloading...');

      vi.advanceTimersByTime(200);
      expect(exitSpy).toHaveBeenCalledWith(42);

      vi.useRealTimers();
      exitSpy.mockRestore();
    });

    it('returns MCP-formatted reload message in debug mode', async () => {
      const debugBackend = new StatefulBackend(makeConfig({ debug: true }));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      vi.useFakeTimers();

      const result = await debugBackend.callTool('reload_mcp');
      expect(result.content[0].text).toContain('Reloading');

      vi.advanceTimersByTime(200);
      vi.useRealTimers();
      exitSpy.mockRestore();
    });
  });

  // ---- _getStatusHeader ----

  describe('_getStatusHeader()', () => {
    it('returns correct format for passive state', () => {
      const header = backend._getStatusHeader();
      expect(header).toContain('v0.1.0');
      expect(header).toContain('Disabled');
      expect(header).toContain('---');
    });

    it('returns correct format for active state without tab', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });

      const header = backend._getStatusHeader();
      expect(header).toContain('v0.1.0');
      expect(header).toContain('No tab attached');
      expect(header).toContain('Local Browser');
    });

    it('includes tab info when attached', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({
        id: 1,
        index: 2,
        title: 'Test Page',
        url: 'https://example.com/page',
      });

      const header = backend._getStatusHeader();
      expect(header).toContain('Tab 2');
      expect(header).toContain('https://example.com/page');
    });

    it('truncates long URLs', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({
        id: 1,
        index: 0,
        url: 'https://example.com/very/long/path/that/exceeds/fifty/characters/for/sure',
      });

      const header = backend._getStatusHeader();
      expect(header).toContain('...');
    });

    it('includes tech stack info when present', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({
        id: 1,
        index: 0,
        url: 'https://example.com',
        techStack: {
          frameworks: ['React'],
          libraries: ['jQuery'],
          css: ['Tailwind'],
        },
      });

      const header = backend._getStatusHeader();
      expect(header).toContain('React');
      expect(header).toContain('jQuery');
      expect(header).toContain('Tailwind');
    });

    it('includes obfuscated CSS warning', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setAttachedTab({
        id: 1,
        index: 0,
        url: 'https://example.com',
        techStack: { obfuscatedCSS: true },
      });

      const header = backend._getStatusHeader();
      expect(header).toContain('Obfuscated CSS');
    });

    it('includes stealth indicator when stealth mode is on', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setStealthMode(true);

      const header = backend._getStatusHeader();
      expect(header).toContain('Stealth');
    });

    it('includes build timestamp in debug mode', async () => {
      const debugBackend = new StatefulBackend(makeConfig({ debug: true }));
      await debugBackend.initialize(makeMockServer(), {});

      mockExtensionServerInstance.getBuildTimestamp.mockReturnValue('2026-01-15T10:30:00.000Z');
      await debugBackend.callTool('enable', { client_id: 'test' });

      const header = debugBackend._getStatusHeader();
      // Should contain the formatted time
      expect(header).toContain('[');
      expect(header).toContain(']');
    });
  });

  // ---- setAttachedTab / getAttachedTab ----

  describe('setAttachedTab / getAttachedTab', () => {
    it('returns null initially', () => {
      expect(backend.getAttachedTab()).toBeNull();
    });

    it('stores and retrieves tab info', () => {
      const tab = { id: 5, index: 2, title: 'My Tab', url: 'https://foo.com' };
      backend.setAttachedTab(tab);
      expect(backend.getAttachedTab()).toEqual(tab);
    });

    it('can clear tab by setting null', () => {
      backend.setAttachedTab({ id: 1, index: 0 });
      backend.setAttachedTab(null);
      expect(backend.getAttachedTab()).toBeNull();
    });
  });

  // ---- setConnectedBrowserName / setStealthMode ----

  describe('setConnectedBrowserName', () => {
    it('updates the browser name shown in status', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });
      backend.setConnectedBrowserName('Firefox');

      const header = backend._getStatusHeader();
      expect(header).toContain('Firefox');
    });
  });

  describe('setStealthMode', () => {
    it('toggles stealth indicator in header', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });

      backend.setStealthMode(true);
      expect(backend._getStatusHeader()).toContain('Stealth');

      backend.setStealthMode(false);
      expect(backend._getStatusHeader()).not.toContain('Stealth');
    });
  });

  // ---- serverClosed ----

  describe('serverClosed()', () => {
    it('cleans up and returns to passive', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });

      await backend.serverClosed();

      const status = await backend.callTool('status', {}, { rawResult: true });
      expect(status.state).toBe('passive');
    });

    it('calls serverClosed on active backend', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });

      await backend.serverClosed();
      expect(mockActiveBackendInstance.serverClosed).toHaveBeenCalled();
    });

    it('stops ExtensionServer', async () => {
      await backend.initialize(makeMockServer(), {});
      await backend.callTool('enable', { client_id: 'test' });

      await backend.serverClosed();
      expect(mockExtensionServerInstance.stop).toHaveBeenCalled();
    });

    it('is safe to call when already passive', async () => {
      await backend.serverClosed();
      const status = await backend.callTool('status', {}, { rawResult: true });
      expect(status.state).toBe('passive');
    });
  });

  // ---- listTools ----

  describe('listTools()', () => {
    it('includes connection tools (enable, disable, status)', async () => {
      const tools = await backend.listTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('enable');
      expect(names).toContain('disable');
      expect(names).toContain('status');
    });

    it('includes browser tools from UnifiedBackend', async () => {
      const tools = await backend.listTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('browser_tabs');
    });

    it('does not include reload_mcp when not in debug mode', async () => {
      const tools = await backend.listTools();
      const names = tools.map((t: any) => t.name);
      expect(names).not.toContain('reload_mcp');
    });

    it('includes reload_mcp in debug mode', async () => {
      const debugBackend = new StatefulBackend(makeConfig({ debug: true }));
      const tools = await debugBackend.listTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('reload_mcp');
    });
  });
});
