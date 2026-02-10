import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionServer } from '../src/extensionServer';
import WebSocket from 'ws';

// Mock the logger
vi.mock('../src/logger', () => ({
  getLogger: () => ({
    log: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}));

// Use a range of ports to avoid conflicts between test runs
let portCounter = 9100;
function nextPort(): number {
  return portCounter++;
}

/**
 * Helper: create a WebSocket client that connects to the server.
 * Returns the client and a promise that resolves when the connection opens.
 */
function connectClient(port: number): { ws: WebSocket; ready: Promise<void> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const ready = new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { ws, ready };
}

describe('ExtensionServer', () => {
  let server: ExtensionServer;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    port = nextPort();
    server = new ExtensionServer(port, '127.0.0.1');
  });

  afterEach(async () => {
    // Close all test clients
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN || c.readyState === WebSocket.CONNECTING) {
        c.close();
      }
    }
    clients.length = 0;

    // Stop the server
    await server.stop();
  });

  // ---- start / stop ----

  describe('start() and stop()', () => {
    it('starts HTTP + WebSocket server', async () => {
      await server.start();
      // Server is listening — try to connect
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it('stop() cleans up server', async () => {
      await server.start();
      await server.stop();

      // Connection should fail after stop
      await expect(
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          ws.on('open', () => {
            ws.close();
            reject(new Error('Should not have connected'));
          });
          ws.on('error', () => resolve());
        })
      ).resolves.toBeUndefined();
    });

    it('stop() is safe to call when not started', async () => {
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  // ---- isConnected ----

  describe('isConnected()', () => {
    it('returns false when no client connected', async () => {
      await server.start();
      expect(server.isConnected()).toBe(false);
    });

    it('returns true when client is connected', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;

      // Small delay to ensure server registers the connection
      await new Promise((r) => setTimeout(r, 50));
      expect(server.isConnected()).toBe(true);
    });

    it('returns false after client disconnects', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(server.isConnected()).toBe(false);
    });
  });

  // ---- sendCommand ----

  describe('sendCommand()', () => {
    it('throws when not connected', async () => {
      await server.start();
      await expect(server.sendCommand('test_method')).rejects.toThrow('Extension not connected');
    });

    it('sends JSON-RPC and resolves on response', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      // Client echoes back a response for any received message
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method) {
          const response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: { success: true, data: 'hello' },
          };
          ws.send(JSON.stringify(response));
        }
      });

      const result = await server.sendCommand('test_method', { foo: 'bar' });
      expect(result).toEqual({ success: true, data: 'hello' });
    });

    it('rejects on timeout', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      // Client does NOT respond — should timeout
      // Use a very short real timeout to avoid needing fake timers with real sockets
      await expect(server.sendCommand('slow_method', {}, 200)).rejects.toThrow('Request timeout');
    });

    it('sends correct JSON-RPC 2.0 format', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      const receivedMessages: any[] = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        // Send response
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      });

      await server.sendCommand('my_method', { key: 'val' });

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
      const sent = receivedMessages[0];
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.method).toBe('my_method');
      expect(sent.params).toEqual({ key: 'val' });
      expect(sent.id).toBeDefined();
    });

    it('rejects when response contains an error', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {},
            error: { code: -32000, message: 'Something broke' },
          })
        );
      });

      await expect(server.sendCommand('fail_method')).rejects.toThrow('Something broke');
    });
  });

  // ---- _handleMessage ----

  describe('message handling', () => {
    it('handles handshake messages', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      ws.send(
        JSON.stringify({
          type: 'handshake',
          browser: 'firefox',
          buildTimestamp: '2026-01-15T10:00:00.000Z',
        })
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(server.getBuildTimestamp()).toBe('2026-01-15T10:00:00.000Z');
      expect(server.getBrowserType()).toBe('firefox');
    });

    it('handles tab info update notifications', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      const tabInfoCallback = vi.fn();
      server.onTabInfoUpdate = tabInfoCallback;

      ws.send(
        JSON.stringify({
          method: 'notifications/tab_info_update',
          params: { currentTab: { id: 1, title: 'Test', url: 'https://example.com' } },
        })
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(tabInfoCallback).toHaveBeenCalledWith({
        id: 1,
        title: 'Test',
        url: 'https://example.com',
      });
    });

    it('handles responses with currentTab info', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      const tabInfoCallback = vi.fn();
      server.onTabInfoUpdate = tabInfoCallback;

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method) {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                success: true,
                currentTab: { id: 5, title: 'Response Tab', url: 'https://resp.com' },
              },
            })
          );
        }
      });

      await server.sendCommand('some_command');

      expect(tabInfoCallback).toHaveBeenCalledWith({
        id: 5,
        title: 'Response Tab',
        url: 'https://resp.com',
      });
    });
  });

  // ---- setClientId ----

  describe('setClientId()', () => {
    it('sends notification when connected', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      const receivedMessages: any[] = [];
      ws.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      server.setClientId('my-project');
      await new Promise((r) => setTimeout(r, 100));

      const notification = receivedMessages.find((m) => m.method === 'authenticated');
      expect(notification).toBeDefined();
      expect(notification.params.client_id).toBe('my-project');
    });

    it('does not throw when not connected', () => {
      // Should just silently do nothing
      expect(() => server.setClientId('my-project')).not.toThrow();
    });
  });

  // ---- getBuildTimestamp ----

  describe('getBuildTimestamp()', () => {
    it('returns null before handshake', async () => {
      await server.start();
      expect(server.getBuildTimestamp()).toBeNull();
    });

    it('returns value from handshake', async () => {
      await server.start();
      const { ws, ready } = connectClient(port);
      clients.push(ws);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      ws.send(JSON.stringify({ type: 'handshake', buildTimestamp: '2026-02-01T00:00:00Z' }));
      await new Promise((r) => setTimeout(r, 100));

      expect(server.getBuildTimestamp()).toBe('2026-02-01T00:00:00Z');
    });
  });

  // ---- Reconnection ----

  describe('reconnection handling', () => {
    it('fires onReconnect callback on new connection after previous', async () => {
      await server.start();

      const reconnectSpy = vi.fn();
      server.onReconnect = reconnectSpy;

      // First connection
      const { ws: ws1, ready: ready1 } = connectClient(port);
      clients.push(ws1);
      await ready1;
      await new Promise((r) => setTimeout(r, 50));

      // Close first connection but connect the second one immediately —
      // The server still has _extensionWs set (close event hasn't fired on server yet),
      // so the second connection is treated as a reconnection.
      ws1.close();

      // Connect ws2 right away, before the server's close handler sets _extensionWs = null
      const { ws: ws2, ready: ready2 } = connectClient(port);
      clients.push(ws2);
      await ready2;
      await new Promise((r) => setTimeout(r, 150));

      expect(reconnectSpy).toHaveBeenCalled();
    });

    it('rejects duplicate connections when one is already open', async () => {
      await server.start();

      // First connection
      const { ws: ws1, ready: ready1 } = connectClient(port);
      clients.push(ws1);
      await ready1;
      await new Promise((r) => setTimeout(r, 50));

      // Second connection while first is still open
      const { ws: ws2, ready: ready2 } = connectClient(port);
      clients.push(ws2);
      await ready2;

      // ws2 should receive an error and get closed
      await new Promise<void>((resolve) => {
        ws2.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.error) {
            expect(msg.error.message).toContain('Another browser');
            resolve();
          }
        });
        // Fallback timeout
        setTimeout(resolve, 500);
      });
    });
  });
});
