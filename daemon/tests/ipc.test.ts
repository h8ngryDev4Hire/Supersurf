import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IPCServer } from '../src/ipc';
import { SessionRegistry } from '../src/session';
import { RequestScheduler } from '../src/scheduler';
import type { ExtensionBridge } from '../src/extension-bridge';

function mockBridge(): ExtensionBridge {
  return {
    sendCmd: vi.fn().mockResolvedValue({ success: true }),
    connected: true,
    browser: 'chrome',
    buildTime: '2026-01-01T00:00:00Z',
    notifyClientId: vi.fn(),
    onReconnect: null,
    onTabInfoUpdate: null,
    start: vi.fn(),
    stop: vi.fn(),
  } as any;
}

function connectToSocket(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath);
    socket.on('connect', () => resolve(socket));
    socket.on('error', reject);
  });
}

function readLine(socket: net.Socket): Promise<any> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        socket.removeListener('data', onData);
        resolve(JSON.parse(buffer.slice(0, idx)));
      }
    };
    socket.on('data', onData);
  });
}

function writeLine(socket: net.Socket, data: any): void {
  socket.write(JSON.stringify(data) + '\n');
}

describe('IPCServer', () => {
  let bridge: ExtensionBridge;
  let sessions: SessionRegistry;
  let scheduler: RequestScheduler;
  let ipc: IPCServer;
  let sockPath: string;

  beforeEach(() => {
    // Use project-local tmp dir to avoid sandbox restrictions on Unix sockets
    const baseDir = path.join(__dirname, '..', '.tmp-test');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(baseDir, 'ipc-'));
    sockPath = path.join(tmpDir, 'test.sock');

    bridge = mockBridge();
    sessions = new SessionRegistry();
    scheduler = new RequestScheduler(bridge, sessions);
    ipc = new IPCServer(sockPath, bridge, sessions, scheduler);
  });

  afterEach(async () => {
    await ipc.stop();
    try { fs.unlinkSync(sockPath); } catch {}
  });

  it('starts and accepts connections', async () => {
    await ipc.start();
    const client = await connectToSocket(sockPath);

    writeLine(client, { type: 'session_register', sessionId: 'test-session' });
    const response = await readLine(client);

    expect(response.type).toBe('session_ack');
    expect(response.browser).toBe('chrome');
    expect(response.buildTimestamp).toBe('2026-01-01T00:00:00Z');

    client.end();
  });

  it('rejects duplicate session IDs', async () => {
    await ipc.start();

    // First client registers
    const client1 = await connectToSocket(sockPath);
    writeLine(client1, { type: 'session_register', sessionId: 'dup' });
    await readLine(client1);

    // Second client tries same ID
    const client2 = await connectToSocket(sockPath);
    writeLine(client2, { type: 'session_register', sessionId: 'dup' });
    const response = await readLine(client2);

    expect(response.type).toBe('session_reject');
    expect(response.reason).toContain('already in use');

    client1.end();
    client2.end();
  });

  it('rejects non-handshake messages before registration', async () => {
    await ipc.start();
    const client = await connectToSocket(sockPath);

    writeLine(client, { jsonrpc: '2.0', id: '1', method: 'navigate' });
    const response = await readLine(client);

    expect(response.type).toBe('session_reject');

    client.end();
  });

  it('routes JSON-RPC requests post-handshake', async () => {
    await ipc.start();
    const client = await connectToSocket(sockPath);

    // Handshake
    writeLine(client, { type: 'session_register', sessionId: 'my-session' });
    await readLine(client); // ack

    // Send a tool call
    writeLine(client, {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'navigate',
      params: { url: 'https://example.com' },
    });

    const response = await readLine(client);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('req-1');
    expect(response.result).toBeDefined();

    client.end();
  });

  it('cleans up session on socket close', async () => {
    await ipc.start();
    const client = await connectToSocket(sockPath);

    writeLine(client, { type: 'session_register', sessionId: 'cleanup-test' });
    await readLine(client);

    expect(sessions.has('cleanup-test')).toBe(true);

    // Close the client
    client.end();

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 50));

    expect(sessions.has('cleanup-test')).toBe(false);
  });

  it('calls session count callback on connect/disconnect', async () => {
    const countCb = vi.fn();
    ipc.setSessionCountCallback(countCb);

    await ipc.start();
    const client = await connectToSocket(sockPath);

    writeLine(client, { type: 'session_register', sessionId: 'count-test' });
    await readLine(client);

    expect(countCb).toHaveBeenCalledWith(1);

    client.end();
    await new Promise(r => setTimeout(r, 50));

    expect(countCb).toHaveBeenCalledWith(0);
  });

  it('handles concurrent sessions', async () => {
    await ipc.start();

    const client1 = await connectToSocket(sockPath);
    const client2 = await connectToSocket(sockPath);

    writeLine(client1, { type: 'session_register', sessionId: 'session-a' });
    writeLine(client2, { type: 'session_register', sessionId: 'session-b' });

    await readLine(client1);
    await readLine(client2);

    expect(sessions.count).toBe(2);
    expect(sessions.has('session-a')).toBe(true);
    expect(sessions.has('session-b')).toBe(true);

    client1.end();
    client2.end();
  });
});
