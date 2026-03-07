/**
 * IPC Server — Unix socket server for MCP session connections.
 *
 * Accepts connections from MCP servers over a Unix domain socket.
 * Protocol:
 *   1. MCP server sends: { type: "session_register", sessionId: "..." }\n
 *   2. Daemon responds: { type: "session_ack", browser: "...", buildTimestamp: "..." }\n
 *      or { type: "session_reject", reason: "..." }\n
 *   3. Post-handshake: NDJSON (newline-delimited JSON-RPC 2.0) for tool calls
 *
 * @module ipc
 */

import net from 'net';
import crypto from 'crypto';
import type { FileLogger } from 'shared';
import type { ExtensionBridge } from './extension-bridge';
import type { SessionRegistry } from './session';
import type { RequestScheduler } from './scheduler';
import type { DaemonExperimentRegistry } from './experiments/index';
import { isExperimentMethod } from './experiments/types';

const debugLog = (...args: unknown[]) => {
  const logger = (global as any).DAEMON_LOGGER as FileLogger | undefined;
  if (logger) logger.log('[IPC]', ...args);
  else if ((global as any).DAEMON_DEBUG) console.error('[IPC]', ...args);
};

/** Callback invoked when the number of sessions changes (for idle timeout management). */
export type SessionCountCallback = (count: number) => void;

/** Metadata passed from main to IPCServer for status queries. */
export interface IPCServerMeta {
  port: number;
  version: string;
}

/**
 * Unix domain socket server for MCP session connections.
 * Handles session handshake, NDJSON message routing, and cleanup.
 */
export class IPCServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private bridge: ExtensionBridge;
  private sessions: SessionRegistry;
  private scheduler: RequestScheduler;
  private experiments: DaemonExperimentRegistry;
  private onSessionCountChange: SessionCountCallback | null = null;
  private startedAt: number = Date.now();
  private meta: IPCServerMeta;

  constructor(
    socketPath: string,
    bridge: ExtensionBridge,
    sessions: SessionRegistry,
    scheduler: RequestScheduler,
    experiments: DaemonExperimentRegistry,
    meta: IPCServerMeta = { port: 5555, version: 'unknown' },
  ) {
    this.socketPath = socketPath;
    this.bridge = bridge;
    this.sessions = sessions;
    this.scheduler = scheduler;
    this.experiments = experiments;
    this.meta = meta;
  }

  /** Set a callback for session count changes (used by idle timeout). */
  setSessionCountCallback(cb: SessionCountCallback): void {
    this.onSessionCountChange = cb;
  }

  /** Start listening on the Unix socket. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (error) => {
        debugLog('IPC server error:', error);
        reject(error);
      });

      this.server.listen(this.socketPath, () => {
        debugLog(`IPC listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /** Handle a new connection from an MCP server. */
  private handleConnection(socket: net.Socket): void {
    debugLog('New IPC connection');

    let buffer = '';
    let sessionId: string | null = null;
    let handshakeComplete = false;

    socket.on('data', (data) => {
      buffer += data.toString();

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        try {
          const msg = JSON.parse(line);

          if (!handshakeComplete) {
            // Pre-auth status query — no handshake needed
            if (msg.type === 'daemon_status') {
              this.sendLine(socket, this.buildStatusResponse());
              socket.end();
              return;
            }

            // Expecting session_register handshake
            if (msg.type === 'session_register' && msg.sessionId) {
              sessionId = msg.sessionId;

              if (this.sessions.has(sessionId!)) {
                this.sendLine(socket, {
                  type: 'session_reject',
                  reason: 'Session ID already in use',
                });
                socket.end();
                return;
              }

              // Register the session
              this.sessions.add(sessionId!, socket);
              this.scheduler.addSession(sessionId!);

              this.sendLine(socket, {
                type: 'session_ack',
                browser: this.bridge.browser,
                buildTimestamp: this.bridge.buildTime,
              });

              handshakeComplete = true;
              debugLog(`Session registered: "${sessionId}"`);

              if (this.onSessionCountChange) {
                this.onSessionCountChange(this.sessions.count);
              }
            } else {
              this.sendLine(socket, {
                type: 'session_reject',
                reason: 'Expected session_register handshake',
              });
              socket.end();
            }
          } else {
            // Post-handshake: JSON-RPC 2.0 requests
            this.handleRequest(sessionId!, socket, msg);
          }
        } catch (err: any) {
          debugLog('Parse error:', err.message);
          if (handshakeComplete && sessionId) {
            this.sendLine(socket, {
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: `Parse error: ${err.message}` },
            });
          }
        }
      }
    });

    socket.on('close', () => {
      if (sessionId) {
        debugLog(`Session disconnected: "${sessionId}"`);
        this.scheduler.removeSession(sessionId);
        this.sessions.remove(sessionId);
        this.experiments.deleteSession(sessionId);

        // Notify extension to ungroup the session's tabs
        this.bridge.sendCmd('sessionDisconnect', { sessionId }, 5000).catch(() => {});

        if (this.onSessionCountChange) {
          this.onSessionCountChange(this.sessions.count);
        }
      }
    });

    socket.on('error', (error) => {
      debugLog('Socket error:', error.message);
    });
  }

  /** Route a JSON-RPC 2.0 request — experiment methods are handled directly, everything else goes to the scheduler. */
  private async handleRequest(sessionId: string, socket: net.Socket, msg: any): Promise<void> {
    if (msg.jsonrpc !== '2.0' || !msg.method || msg.id === undefined) {
      this.sendLine(socket, {
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      });
      return;
    }

    // Experiment IPC — handle directly, skip scheduler
    if (isExperimentMethod(msg.method)) {
      try {
        const result = this.handleExperimentRequest(sessionId, msg.method, msg.params || {});
        this.sendLine(socket, { jsonrpc: '2.0', id: msg.id, result });
      } catch (error: any) {
        this.sendLine(socket, {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: error.message || String(error) },
        });
      }
      return;
    }

    try {
      const result = await this.scheduler.enqueue(
        sessionId,
        msg.method,
        msg.params || {},
        msg.timeout || 30000,
      );
      this.sendLine(socket, { jsonrpc: '2.0', id: msg.id, result });
    } catch (error: any) {
      this.sendLine(socket, {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: error.message || String(error) },
      });
    }
  }

  /** Handle an experiment IPC request directly (no scheduler round-trip). */
  private handleExperimentRequest(
    sessionId: string,
    method: string,
    params: Record<string, unknown>,
  ): unknown {
    switch (method) {
      case 'experiments.toggle':
        return {
          success: true,
          experiment: params.experiment,
          enabled: this.experiments.toggle(
            sessionId,
            params.experiment as string,
            params.enabled as boolean,
          ),
        };
      case 'experiments.get':
        return { experiments: this.experiments.getAll(sessionId) };
      case 'experiments.getOne':
        return {
          experiment: params.experiment,
          enabled: this.experiments.isEnabled(sessionId, params.experiment as string),
        };
      default:
        throw new Error(`Unknown experiment method: ${method}`);
    }
  }

  /** Build a status response from live daemon state. */
  private buildStatusResponse(): any {
    const sessions: any[] = [];
    for (const session of this.sessions.values()) {
      sessions.push({
        sessionId: session.sessionId,
        attachedTabId: session.attachedTabId,
        ownedTabCount: session.ownedTabs.size,
      });
    }

    return {
      type: 'daemon_status',
      version: this.meta.version,
      uptimeSeconds: (Date.now() - this.startedAt) / 1000,
      port: this.meta.port,
      extensionConnected: this.bridge.connected,
      extensionBrowser: this.bridge.browser,
      sessions,
      schedulerQueueDepth: this.scheduler.getQueueDepth(),
    };
  }

  /** Write an NDJSON line to a socket. */
  private sendLine(socket: net.Socket, data: any): void {
    if (!socket.writable) return;
    socket.write(JSON.stringify(data) + '\n');
  }

  /** Gracefully shut down the IPC server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Close all session sockets
      for (const session of this.sessions.values()) {
        session.socket.end();
      }

      this.server.close(() => {
        debugLog('IPC server stopped');
        resolve();
      });
    });
  }
}
