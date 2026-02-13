/**
 * Unit tests for ExtensionServer
 */

const { ExtensionServer } = require('../../src/extensionServer');

describe('ExtensionServer', () => {
  test('initializes with port and host', () => {
    const server = new ExtensionServer(5555, '127.0.0.1');
    expect(server._port).toBe(5555);
    expect(server._host).toBe('127.0.0.1');
  });

  test('starts and stops correctly', async () => {
    const server = new ExtensionServer(5556, '127.0.0.1'); // Use different port to avoid conflicts

    // Start server
    await server.start();
    expect(server._httpServer).toBeTruthy();
    expect(server._wss).toBeTruthy();

    // Stop server
    await server.stop();
    expect(server._extensionWs).toBe(null);
    expect(server._wss).toBe(null);
  }, 10000); // Increase timeout for network operations

  test('isConnected returns false when no extension connected', () => {
    const server = new ExtensionServer(5557, '127.0.0.1');
    // isConnected checks if WebSocket exists and is open
    expect(server.isConnected()).toBeFalsy();
  });
});
