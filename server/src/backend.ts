/**
 * ConnectionManager — manages connection lifecycle.
 * States: passive → active → connected
 *
 * Delegates tool schemas to backend/schemas.ts, status formatting to
 * backend/status.ts, and handler logic to backend/handlers.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IExtensionTransport } from './bridge';
import { createLog } from './logger';

// Re-export types so existing imports from './backend' still work
export type { BackendConfig, TabInfo, BackendState, ToolSchema } from './backend/types';
import type { BackendConfig, TabInfo, BackendState, ToolSchema, ConnectionManagerAPI } from './backend/types';

import { buildStatusHeader } from './backend/status';
import { getConnectionToolSchemas, getDebugToolSchema } from './backend/schemas';
import { onEnable, onDisable, onStatus, onExperimentalFeatures, onReloadMCP } from './backend/handlers';

const log = createLog('[Conn]');

// Forward-declare BrowserBridge import (lazy to avoid circular deps)
let BrowserBridge: any = null;

async function getBrowserBridge(): Promise<any> {
  if (!BrowserBridge) {
    const mod = await import('./tools');
    BrowserBridge = mod.BrowserBridge;
  }
  return BrowserBridge;
}

export class ConnectionManager implements ConnectionManagerAPI {
  config: BackendConfig;
  state: BackendState = 'passive';
  bridge: any = null;
  extensionServer: IExtensionTransport | null = null;
  debugMode: boolean;
  clientId: string | null = null;
  connectedBrowserName: string | null = null;
  attachedTab: TabInfo | null = null;
  stealthMode: boolean = false;
  server: Server | null = null;
  clientInfo: Record<string, unknown> = {};

  constructor(config: BackendConfig) {
    log('Constructor — starting in PASSIVE mode');
    this.config = config;
    this.debugMode = config.debug || false;
  }

  async initialize(server: Server | null, clientInfo: Record<string, unknown>): Promise<void> {
    log('Initialize called — staying in passive mode');
    this.server = server;
    this.clientInfo = clientInfo;
  }

  // ─── Status header ─────────────────────────────────────────

  statusHeader(): string {
    return buildStatusHeader({
      config: this.config,
      state: this.state,
      debugMode: this.debugMode,
      connectedBrowserName: this.connectedBrowserName,
      attachedTab: this.attachedTab,
      stealthMode: this.stealthMode,
      extensionServer: this.extensionServer,
    });
  }

  // ─── Tool listing ──────────────────────────────────────────

  async listTools(): Promise<ToolSchema[]> {
    log(`listTools() — state: ${this.state}`);

    const connectionTools = getConnectionToolSchemas();

    // Get browser tools from BrowserBridge (dummy transport, schema only)
    const BB = await getBrowserBridge();
    const dummyBridge = new BB(this.config, null);
    const browserTools = await dummyBridge.listTools();

    const debugTools: ToolSchema[] = [];
    if (this.debugMode) {
      debugTools.push(getDebugToolSchema());
    }

    return [...connectionTools, ...browserTools, ...debugTools];
  }

  // ─── Tool dispatch ─────────────────────────────────────────

  async callTool(
    name: string,
    rawArguments: Record<string, unknown> = {},
    options: { rawResult?: boolean } = {}
  ): Promise<any> {
    log(`callTool(${name}) — state: ${this.state}`);

    switch (name) {
      case 'enable':
        return await onEnable(this, rawArguments, options);
      case 'disable':
        return await onDisable(this, options);
      case 'status':
        return await onStatus(this, options);
      case 'experimental_features':
        return await onExperimentalFeatures(this, rawArguments, options);
      case 'reload_mcp':
        return onReloadMCP(this, options);
    }

    // Forward to active bridge
    if (!this.bridge) {
      if (options.rawResult) {
        return {
          success: false,
          error: 'not_enabled',
          message: 'Browser automation not active. Call enable first.',
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `### ⚠️ Browser Automation Not Active\n\n**Current State:** Passive (disabled)\n\n**You must call \`enable\` first to activate browser automation.**`,
          },
        ],
        isError: true,
      };
    }

    return await this.bridge.callTool(name, rawArguments, options);
  }

  // ─── Notify tools changed ──────────────────────────────────

  async notifyToolsListChanged(): Promise<void> {
    if (this.server) {
      try {
        await (this.server as any).sendToolsListChanged?.();
      } catch {
        // Client may not support this notification
      }
    }
  }

  // ─── Logging notifications ───────────────────────────────

  async sendLogNotification(level: string, message: string, logger?: string): Promise<void> {
    if (this.server) {
      try {
        const hasMethod = typeof (this.server as any).sendLoggingMessage === 'function';
        log(`sendLogNotification: hasMethod=${hasMethod}, level=${level}, logger=${logger || 'supersurf'}`);
        if (hasMethod) {
          await (this.server as any).sendLoggingMessage({
            level,
            logger: logger || 'supersurf',
            data: message,
          });
          log('sendLogNotification: sent successfully');
        } else {
          log('sendLogNotification: method not found on server instance');
        }
      } catch (err: any) {
        log('sendLogNotification error:', err?.message || err);
      }
    } else {
      log('sendLogNotification: no server instance');
    }
  }

  // ─── Public accessors for BrowserBridge to update state ────

  setAttachedTab(tab: TabInfo | null): void {
    this.attachedTab = tab;
  }

  getAttachedTab(): TabInfo | null {
    return this.attachedTab;
  }

  clearAttachedTab(): void {
    this.attachedTab = null;
  }

  setConnectedBrowserName(name: string): void {
    this.connectedBrowserName = name;
  }

  setStealthMode(enabled: boolean): void {
    this.stealthMode = enabled;
  }

  // ─── Shutdown ──────────────────────────────────────────────

  async serverClosed(): Promise<void> {
    log('Server closed');

    if (this.bridge) {
      this.bridge.serverClosed();
      this.bridge = null;
    }

    if (this.extensionServer) {
      await this.extensionServer.stop();
      this.extensionServer = null;
    }

    this.state = 'passive';
  }
}
