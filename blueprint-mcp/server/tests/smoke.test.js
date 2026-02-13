/**
 * Smoke tests - Quick sanity checks
 * These verify the most basic functionality works
 */

const { StatefulBackend } = require('../src/statefulBackend');
const { ExtensionServer } = require('../src/extensionServer');

describe('Smoke Tests', () => {
  test('StatefulBackend initializes', () => {
    const backend = new StatefulBackend({ debug: false });
    expect(backend).toBeTruthy();
    expect(backend._state).toBe('passive');
  });

  test('ExtensionServer initializes', () => {
    const server = new ExtensionServer(5555, '127.0.0.1');
    expect(server).toBeTruthy();
    expect(server._port).toBe(5555);
  });

  test('Backend has core methods', () => {
    const backend = new StatefulBackend({ debug: false });
    expect(typeof backend.initialize).toBe('function');
    expect(typeof backend.listTools).toBe('function');
    expect(typeof backend.callTool).toBe('function');
  });
});
