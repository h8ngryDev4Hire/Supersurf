/**
 * WebSocket bridge to the Chrome extension.
 * Listens on localhost, speaks JSON-RPC 2.0.
 */

import crypto from 'crypto';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLog } from './logger';

const log = createLog('[WS]');

interface InflightRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class ExtensionServer {
  private port: number;
  private host: string;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private inflight: Map<string, InflightRequest> = new Map();
  private browserType: string = 'chrome';
  private buildTimestamp: string | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  onReconnect: (() => void) | null = null;
  onTabInfoUpdate: ((tabInfo: any) => void) | null = null;

  constructor(port: number = 5555, host: string = '127.0.0.1') {
    this.port = port;
    this.host = host;
  }

  get browser(): string {
    return this.browserType;
  }

  get buildTime(): string | null {
    return this.buildTimestamp;
  }

  get connected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('SuperSurf Extension Server');
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('error', (error) => {
        log('WebSocketServer error:', error);
        reject(error);
      });

      this.wss.on('connection', (ws) => {
        log('Extension connection attempt');

        // Reject if already connected
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          log('Rejecting new connection — browser already connected');
          const errorMsg = {
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Another browser is already connected. Only one browser at a time.',
            },
          };
          ws.send(JSON.stringify(errorMsg));
          setTimeout(() => ws.close(1008, 'Already connected'), 100);
          return;
        }

        log('Extension connected');
        const isReconnection = !!this.socket;

        if (this.socket) {
          log('Closing previous connection — reconnection detected');
          this.socket.close();
        }

        this.socket = ws;

        // Clear old ping interval
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }

        // Keep-alive ping every 10s
        this.pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 10000);

        if (isReconnection && this.onReconnect) {
          this.onReconnect();
        }

        ws.on('message', (data) => this.handleMessage(data));
        ws.on('pong', () => log('Pong received'));
        ws.on('close', () => {
          log('Extension disconnected');
          if (this.socket === ws) {
            this.socket = null;
          }
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
          }
        });
        ws.on('error', (error) => log('WebSocket error:', error));
      });

      this.httpServer.on('error', (error) => {
        log('HTTP Server error:', error);
        reject(error);
      });

      this.httpServer.listen(this.port, this.host, () => {
        log(`Server listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  private handleMessage(data: any): void {
    try {
      const message = JSON.parse(data.toString());
      log('Received from extension:', message.method || 'response');

      // Response (has id, no method)
      if (message.id !== undefined && !message.method) {
        const pending = this.inflight.get(message.id);
        if (pending) {
          this.inflight.delete(message.id);

          const result = message.result;
          if (result && typeof result === 'object' && 'currentTab' in result && this.onTabInfoUpdate) {
            this.onTabInfoUpdate(result.currentTab);
          }

          if (message.error) {
            pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      // Handshake
      if (message.type === 'handshake') {
        log('Handshake received:', message);
        this.browserType = message.browser || 'chrome';
        this.buildTimestamp = message.buildTimestamp || null;
        return;
      }

      // Notification (has method, no id)
      if (message.method && message.id === undefined) {
        log('Notification:', message.method);
        if (
          message.method === 'notifications/tab_info_update' &&
          message.params?.currentTab &&
          this.onTabInfoUpdate
        ) {
          this.onTabInfoUpdate(message.params.currentTab);
        }
        return;
      }
    } catch (error) {
      log('Error handling message:', error);
    }
  }

  async sendCmd(method: string, params: Record<string, unknown> = {}, timeout: number = 30000): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected. Open the extension popup and click "Enable".');
    }

    const id = crypto.randomUUID().slice(0, 8);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.inflight.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeout);

      this.inflight.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      const message = { jsonrpc: '2.0', id, method, params };
      log('Sending to extension:', method);
      this.socket!.send(JSON.stringify(message));
    });
  }

  notifyClientId(clientId: string): void {
    log('Client ID set to:', clientId);
    if (this.connected) {
      const notification = {
        jsonrpc: '2.0',
        method: 'authenticated',
        params: { client_id: clientId },
      };
      this.socket!.send(JSON.stringify(notification));
    }
  }

  async stop(): Promise<void> {
    log('Stopping server');

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          log('Server stopped');
          resolve();
        });
      });
    }
  }
}
