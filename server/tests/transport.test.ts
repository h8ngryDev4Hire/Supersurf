import { describe, it, expect, vi } from 'vitest';
import { DirectTransport } from '../src/transport';

// Mock the logger (imported transitively)
vi.mock('../src/logger', () => ({
  getLogger: () => ({
    log: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}));

describe('DirectTransport', () => {
  function makeMockExtensionServer() {
    return {
      sendCommand: vi.fn().mockResolvedValue({ success: true }),
      start: vi.fn(),
      stop: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    } as any;
  }

  it('forwards sendCommand to ExtensionServer', async () => {
    const mockServer = makeMockExtensionServer();
    mockServer.sendCommand.mockResolvedValue({ tabs: [{ id: 1 }] });

    const transport = new DirectTransport(mockServer);
    const result = await transport.sendCommand('browser_tabs', { action: 'list' });

    expect(mockServer.sendCommand).toHaveBeenCalledWith('browser_tabs', { action: 'list' }, undefined);
    expect(result).toEqual({ tabs: [{ id: 1 }] });
  });

  it('forwards timeout parameter to ExtensionServer', async () => {
    const mockServer = makeMockExtensionServer();
    const transport = new DirectTransport(mockServer);

    await transport.sendCommand('slow_method', { data: 'test' }, 60000);

    expect(mockServer.sendCommand).toHaveBeenCalledWith('slow_method', { data: 'test' }, 60000);
  });

  it('propagates errors from ExtensionServer', async () => {
    const mockServer = makeMockExtensionServer();
    mockServer.sendCommand.mockRejectedValue(new Error('Extension not connected'));

    const transport = new DirectTransport(mockServer);

    await expect(transport.sendCommand('test', {})).rejects.toThrow('Extension not connected');
  });

  it('close() resolves without error (no-op)', async () => {
    const mockServer = makeMockExtensionServer();
    const transport = new DirectTransport(mockServer);

    await expect(transport.close()).resolves.toBeUndefined();
  });

  it('close() does not call stop on ExtensionServer', async () => {
    const mockServer = makeMockExtensionServer();
    const transport = new DirectTransport(mockServer);

    await transport.close();
    expect(mockServer.stop).not.toHaveBeenCalled();
  });
});
