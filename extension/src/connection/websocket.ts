/**
 * WebSocket connection manager — connects to local MCP server
 * Stripped of PRO/relay/OAuth logic (direct mode only)
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from '../utils/logger.js';
import { IconManager } from '../utils/icons.js';

export class WebSocketConnection {
  browser: typeof chrome;
  logger: Logger;
  iconManager: IconManager;
  buildTimestamp: string | null;

  socket: WebSocket | null = null;
  isConnected: boolean = false;
  projectName: string | null = null;
  connectionUrl: string | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number = 5000;

  commandHandlers: Map<string, (params: any, message?: any) => Promise<any>> = new Map();
  notificationHandlers: Map<string, (params: any) => Promise<void>> = new Map();

  constructor(browserAPI: typeof chrome, logger: Logger, iconManager: IconManager, buildTimestamp: string | null = null) {
    this.browser = browserAPI;
    this.logger = logger;
    this.iconManager = iconManager;
    this.buildTimestamp = buildTimestamp;
  }

  registerCommandHandler(method: string, handler: (params: any, message?: any) => Promise<any>): void {
    this.commandHandlers.set(method, handler);
  }

  registerNotificationHandler(method: string, handler: (params: any) => Promise<void>): void {
    this.notificationHandlers.set(method, handler);
  }

  async isExtensionEnabled(): Promise<boolean> {
    const result = await this.browser.storage.local.get(['extensionEnabled']);
    return result.extensionEnabled !== false;
  }

  async getConnectionUrl(): Promise<string> {
    const result = await this.browser.storage.local.get(['mcpPort']);
    const port = result.mcpPort || '5555';
    const url = `ws://127.0.0.1:${port}/extension`;
    this.logger.log(`[WebSocket] Connecting to ${url}`);
    return url;
  }

  async connect(): Promise<void> {
    try {
      // Don't create duplicate connections
      if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
        this.logger.log('[WebSocket] Already connected or connecting, skipping');
        return;
      }

      const isEnabled = await this.isExtensionEnabled();
      if (!isEnabled) {
        this.logger.log('[WebSocket] Extension disabled, skipping auto-connect');
        return;
      }

      if (this.iconManager) {
        await this.iconManager.updateConnectingBadge();
      }

      const url = await this.getConnectionUrl();
      this.connectionUrl = url;

      // Clean up old socket if lingering
      if (this.socket) {
        try { this.socket.close(); } catch {}
        this.socket = null;
      }

      this.socket = new WebSocket(url);
      this.socket.onopen = () => this._handleOpen();
      this.socket.onmessage = (event) => this._handleMessage(event);
      this.socket.onerror = (error) => this._handleError(error);
      this.socket.onclose = (event) => this._handleClose(event);
    } catch (error: any) {
      this.logger.logAlways('[WebSocket] Connection error:', error);
      if (this.iconManager) {
        await this.iconManager.setGlobalIcon('normal', 'Connection failed');
      }
      this._scheduleReconnect();
    }
  }

  disconnect(): void {
    // Cancel any pending reconnect alarm
    try { (this.browser.alarms as any).clear('ws-reconnect'); } catch {}
    this.reconnectTimeout = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    if (this.iconManager) {
      this.iconManager.setConnected(false);
      this.iconManager.setGlobalIcon('normal', 'Disconnected');
    }
    try { this.browser.runtime.sendMessage({ type: 'statusChanged' }); } catch {}
  }

  send(message: any): void {
    if (this.socket && this.isConnected) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.logger.error('[WebSocket] Cannot send: not connected');
    }
  }

  sendNotification(method: string, params: any): void {
    if (!this.socket || !this.isConnected) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  // ── Internal handlers ──

  private _handleOpen(): void {
    this.logger.logAlways(`Connected to ${this.connectionUrl}`);
    this.isConnected = true;

    if (this.iconManager) {
      this.iconManager.setConnected(true);
      this.iconManager.setGlobalIcon('connected', 'Connected to MCP server');
    }

    try { this.browser.runtime.sendMessage({ type: 'statusChanged' }); } catch {}

    // Send handshake (free/direct mode only)
    this.send({
      type: 'handshake',
      browser: this._getBrowserName(),
      version: this.browser.runtime.getManifest().version,
      buildTimestamp: this.buildTimestamp,
    });
  }

  private async _handleMessage(event: MessageEvent): Promise<void> {
    let message: any;
    try {
      message = JSON.parse(event.data);
      this.logger.log('[WebSocket] Received:', message);

      if (message.error) {
        this.logger.logAlways('[WebSocket] Server error:', message.error);
        return;
      }

      // Notification (method, no id)
      if (!message.id && message.method) {
        await this._handleNotification(message);
        return;
      }

      // Command (has id and method)
      const response = await this._routeCommand(message);
      this.send({ jsonrpc: '2.0', id: message.id, result: response });
    } catch (error: any) {
      this.logger.logAlways('[WebSocket] Command error:', error);
      if (message?.id) {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { message: error.message, stack: error.stack },
        });
      }
    }
  }

  private async _handleNotification(message: any): Promise<void> {
    const { method, params } = message;

    if (method === 'authenticated' && params?.client_id) {
      this.projectName = params.client_id;
      this.logger.log('[WebSocket] Project name set:', this.projectName);
    }

    const handler = this.notificationHandlers.get(method);
    if (handler) await handler(params);
  }

  private async _routeCommand(message: any): Promise<any> {
    const { method, params } = message;
    const handler = this.commandHandlers.get(method);
    if (handler) return await handler(params, message);
    throw new Error(`Unknown command: ${method}`);
  }

  private _handleError(_error: Event): void {
    this.logger.logAlways('[WebSocket] WebSocket error');
    this.isConnected = false;
    if (this.iconManager) this.iconManager.setConnected(false);
  }

  private _handleClose(event: CloseEvent): void {
    this.logger.logAlways(`Disconnected — Code: ${event?.code}, Reason: ${event?.reason || 'none'}`);
    this.isConnected = false;

    if (this.iconManager) {
      this.iconManager.setConnected(false);
      this.iconManager.setGlobalIcon('normal', 'Disconnected');
    }

    try { this.browser.runtime.sendMessage({ type: 'statusChanged' }); } catch {}
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.logger.log(`[WebSocket] Scheduling reconnect in ${this.reconnectDelay}ms...`);
    this.reconnectTimeout = -1 as any; // flag to prevent duplicate scheduling
    // Use chrome.alarms — MV3 kills setTimeout when service worker suspends
    try { (this.browser.alarms as any).clear('ws-reconnect'); } catch {}
    this.browser.alarms.create('ws-reconnect', { when: Date.now() + this.reconnectDelay } as any);
  }

  handleReconnectAlarm(): void {
    this.reconnectTimeout = null;
    if (!this.isConnected) {
      this.connect();
    }
  }

  private _getBrowserName(): string {
    const manifest = this.browser.runtime.getManifest();
    const name = manifest.name || '';
    const match = name.match(/SuperSurf(?:\s+for\s+)?(\w+)?/i);
    if (match?.[1]) return match[1];
    return 'Chrome';
  }
}
