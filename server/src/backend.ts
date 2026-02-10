/**
 * ConnectionManager — manages connection lifecycle.
 * States: passive → active → connected
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ExtensionServer } from './bridge';
import { createLog } from './logger';
import { experimentRegistry } from './experimental/index';

const log = createLog('[Conn]');

export interface BackendConfig {
  debug: boolean;
  port: number;
  server: { name: string; version: string };
}

interface TabInfo {
  id?: number;
  index?: number;
  title?: string;
  url?: string;
  techStack?: any;
}

type BackendState = 'passive' | 'active' | 'connected';

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

// Forward-declare BrowserBridge import (lazy to avoid circular deps)
let BrowserBridge: any = null;

async function getBrowserBridge(): Promise<any> {
  if (!BrowserBridge) {
    const mod = await import('./tools');
    BrowserBridge = mod.BrowserBridge;
  }
  return BrowserBridge;
}

export class ConnectionManager {
  private config: BackendConfig;
  private state: BackendState = 'passive';
  private bridge: any = null;
  private extensionServer: ExtensionServer | null = null;
  private debugMode: boolean;
  private clientId: string | null = null;
  private connectedBrowserName: string | null = null;
  attachedTab: TabInfo | null = null;
  private stealthMode: boolean = false;
  private server: Server | null = null;
  private clientInfo: Record<string, unknown> = {};

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

  // --- Status header (1-liner prepended to all responses) ---

  statusHeader(): string {
    const version = this.config.server.version;

    if (this.state === 'passive') {
      return `🔴 v${version} | Disabled\n---\n\n`;
    }

    const parts: string[] = [];

    let buildTime: string | null = null;
    if (this.extensionServer) {
      buildTime = this.extensionServer.buildTime;
      if (buildTime) {
        try {
          const date = new Date(buildTime);
          buildTime = date.toLocaleTimeString('en-US', { hour12: false });
        } catch {
          // keep original
        }
      }
    }

    const versionStr =
      buildTime && this.debugMode ? `v${version} [${buildTime}]` : `v${version}`;
    parts.push(`✅ ${versionStr}`);

    if (this.connectedBrowserName) {
      parts.push(`🌐 ${this.connectedBrowserName}`);
    }

    if (this.attachedTab) {
      const url = this.attachedTab.url || 'about:blank';
      const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
      parts.push(`📄 Tab ${this.attachedTab.index}: ${shortUrl}`);

      if (this.attachedTab.techStack) {
        const tech = this.attachedTab.techStack;
        const techParts: string[] = [];
        if (tech.frameworks?.length) techParts.push(tech.frameworks.join(', '));
        if (tech.libraries?.length) techParts.push(tech.libraries.join(', '));
        if (tech.css?.length) techParts.push(tech.css.join(', '));
        if (techParts.length) parts.push(`🔧 ${techParts.join(' + ')}`);
        if (tech.obfuscatedCSS) parts.push(`⚠️ Obfuscated CSS`);
      }
    } else {
      parts.push(`⚠️ No tab attached`);
    }

    if (this.stealthMode) {
      parts.push(`🕵️ Stealth`);
    }

    return parts.join(' | ') + '\n---\n\n';
  }

  // --- Tool listing ---

  async listTools(): Promise<ToolSchema[]> {
    log(`listTools() — state: ${this.state}`);

    const connectionTools: ToolSchema[] = [
      {
        name: 'enable',
        description:
          'Start browser automation. Spins up the WebSocket server and waits for the extension to connect. Pass a client_id to identify this session.',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description:
                'Human-readable identifier for this MCP client (e.g., "my-project").',
            },
          },
          required: ['client_id'],
        },
        annotations: {
          title: 'Enable browser automation',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'disable',
        description:
          'Stop browser automation. Tears down the WebSocket connection and returns to passive mode.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        annotations: {
          title: 'Disable browser automation',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'status',
        description:
          'Show current connection state: passive (idle), active (server up), or connected (extension linked).',
        inputSchema: { type: 'object', properties: {}, required: [] },
        annotations: {
          title: 'Connection status',
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'experimental_features',
        description:
          'Toggle experimental features for this session. Available experiments:\n' +
          '- **page_diffing**: After browser_interact, returns only DOM changes instead of requiring a full re-read. Includes a confidence score.\n' +
          '- **smart_waiting**: Replaces fixed navigation delays with adaptive DOM stability + network idle detection.',
        inputSchema: {
          type: 'object',
          properties: {
            page_diffing: { type: 'boolean', description: 'Enable/disable page diffing experiment' },
            smart_waiting: { type: 'boolean', description: 'Enable/disable smart waiting experiment' },
          },
        },
        annotations: {
          title: 'Experimental features',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
    ];

    // Get browser tools from BrowserBridge (dummy transport, schema only)
    const BB = await getBrowserBridge();
    const dummyBridge = new BB(this.config, null);
    const browserTools = await dummyBridge.listTools();

    // Debug tools
    const debugTools: ToolSchema[] = [];
    if (this.debugMode) {
      debugTools.push({
        name: 'reload_mcp',
        description:
          'Hot-reload the MCP server. Debug mode only. Server exits with code 42 and the wrapper restarts it.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        annotations: {
          title: 'Reload MCP server',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      });
    }

    return [...connectionTools, ...browserTools, ...debugTools];
  }

  // --- Tool dispatch ---

  async callTool(
    name: string,
    rawArguments: Record<string, unknown> = {},
    options: { rawResult?: boolean } = {}
  ): Promise<any> {
    log(`callTool(${name}) — state: ${this.state}`);

    switch (name) {
      case 'enable':
        return await this.onEnable(rawArguments, options);
      case 'disable':
        return await this.onDisable(options);
      case 'status':
        return await this.onStatus(options);
      case 'experimental_features':
        return await this.onExperimentalFeatures(rawArguments, options);
      case 'reload_mcp':
        return this.onReloadMCP(options);
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

  // --- Enable ---

  private async onEnable(
    args: Record<string, unknown> = {},
    options: { rawResult?: boolean } = {}
  ): Promise<any> {
    if (
      !args.client_id ||
      typeof args.client_id !== 'string' ||
      (args.client_id as string).trim().length === 0
    ) {
      if (options.rawResult) {
        return { success: false, error: 'missing_client_id', message: 'client_id is required' };
      }
      return {
        content: [
          {
            type: 'text',
            text: `### ⚠️ Missing Required Parameter\n\n\`client_id\` is required.\n\n**Example:**\n\`\`\`\nenable client_id='my-project'\n\`\`\``,
          },
        ],
        isError: true,
      };
    }

    if (this.state !== 'passive') {
      if (options.rawResult) {
        return {
          success: true,
          already_enabled: true,
          state: this.state,
          browser: this.connectedBrowserName,
          client_id: this.clientId,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              this.statusHeader() +
              `### ✅ Already Enabled\n\n**State:** ${this.state}\n**Client ID:** ${this.clientId}\n\nTo restart, call \`disable\` first.`,
          },
        ],
      };
    }

    this.clientId = (args.client_id as string).trim();
    log('Client ID set to:', this.clientId);

    try {
      log('Starting extension server...');

      const port = this.config.port || 5555;
      this.extensionServer = new ExtensionServer(port, '127.0.0.1');
      await this.extensionServer.start();

      if (this.clientId) {
        this.extensionServer.notifyClientId(this.clientId);
      }

      // Handle extension reconnections
      this.extensionServer.onReconnect = () => {
        log('Extension reconnected, resetting tab state...');
        this.attachedTab = null;
        if (this.clientId) {
          this.extensionServer!.notifyClientId(this.clientId);
        }
      };

      // Monitor tab info updates
      this.extensionServer.onTabInfoUpdate = (tabInfo: any) => {
        log('Tab info update:', tabInfo);
        if (tabInfo === null) {
          this.attachedTab = null;
          return;
        }
        if (this.attachedTab) {
          this.attachedTab = {
            ...this.attachedTab,
            id: tabInfo.id,
            title: tabInfo.title,
            url: tabInfo.url,
            index: tabInfo.index,
            techStack: tabInfo.techStack || null,
          };
        }
      };

      const BB = await getBrowserBridge();
      this.bridge = new BB(this.config, this.extensionServer);
      await this.bridge.initialize(this.server, this.clientInfo, this);

      this.state = 'active';
      this.connectedBrowserName = 'Local Browser';

      // Notify MCP client that tool list changed
      this.notifyToolsListChanged().catch((err: any) =>
        log('Error sending notification:', err)
      );

      if (options.rawResult) {
        return {
          success: true,
          state: this.state,
          browser: this.connectedBrowserName,
          client_id: this.clientId,
          port: this.config.port || 5555,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              this.statusHeader() +
              `### ✅ Browser Automation Activated!\n\n` +
              `**State:** Active (waiting for extension)\n` +
              `**Port:** ${port}\n\n` +
              `**Next Steps:**\n` +
              `1. Open the SuperSurf extension popup and enable it\n` +
              `2. Call \`browser_tabs action='list'\` to see tabs\n` +
              `3. Call \`browser_tabs action='attach' index=N\` to attach`,
          },
        ],
      };
    } catch (error: any) {
      log('Failed to start:', error);
      this.bridge = null;
      this.state = 'passive';

      const port = this.config.port || 5555;
      const isPortError =
        error.message &&
        (error.message.includes('EADDRINUSE') || error.message.includes('address already in use'));

      if (options.rawResult) {
        return {
          success: false,
          error: isPortError ? 'port_in_use' : 'connection_failed',
          message: error.message,
          port,
        };
      }

      const errorMsg = isPortError
        ? `Port ${port} already in use. Disable MCP in other project or use --port <number>.`
        : `### Connection Failed\n\n${error.message}`;

      return { content: [{ type: 'text', text: errorMsg }], isError: true };
    }
  }

  // --- Disable ---

  private async onDisable(options: { rawResult?: boolean } = {}): Promise<any> {
    if (this.state === 'passive') {
      if (options.rawResult) {
        return { success: true, already_disabled: true, state: 'passive' };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              this.statusHeader() +
              `### Already Disabled\n\nCall \`enable\` to activate.`,
          },
        ],
      };
    }

    log('Disconnecting...');

    if (this.bridge) {
      this.bridge.serverClosed();
      this.bridge = null;
    }

    if (this.extensionServer) {
      await this.extensionServer.stop();
      this.extensionServer = null;
    }

    this.state = 'passive';
    this.connectedBrowserName = null;
    this.attachedTab = null;
    experimentRegistry.reset();

    this.notifyToolsListChanged().catch((err: any) =>
      log('Error sending notification:', err)
    );

    if (options.rawResult) {
      return { success: true, state: 'passive' };
    }

    return {
      content: [
        {
          type: 'text',
          text:
            this.statusHeader() +
            `### ✅ Disabled\n\nBrowser automation deactivated. Call \`enable\` to reactivate.`,
        },
      ],
    };
  }

  // --- Status ---

  private async onStatus(options: { rawResult?: boolean } = {}): Promise<any> {
    const statusData = {
      state: this.state,
      browser: this.connectedBrowserName,
      client_id: this.clientId,
      attached_tab: this.attachedTab
        ? {
            index: this.attachedTab.index,
            title: this.attachedTab.title,
            url: this.attachedTab.url,
          }
        : null,
    };

    if (options.rawResult) {
      return statusData;
    }

    if (this.state === 'passive') {
      return {
        content: [
          {
            type: 'text',
            text:
              this.statusHeader() +
              `### ❌ Disabled\n\nBrowser automation is not active. Call \`enable\` to activate.`,
          },
        ],
      };
    }

    let statusText = `### ✅ Enabled\n\n`;
    if (this.connectedBrowserName) {
      statusText += `**Browser:** ${this.connectedBrowserName}\n`;
    }

    if (this.attachedTab) {
      statusText += `**Tab:** #${this.attachedTab.index} — ${this.attachedTab.title || 'Untitled'}\n`;
      statusText += `**URL:** ${this.attachedTab.url || 'N/A'}\n\n`;
      statusText += `✅ Ready for automation!`;
    } else {
      statusText += `\n⚠️ No tab attached. Use \`browser_tabs action='attach' index=N\`.`;
    }

    return {
      content: [{ type: 'text', text: this.statusHeader() + statusText }],
    };
  }

  // --- Experimental Features ---

  private async onExperimentalFeatures(
    args: Record<string, unknown> = {},
    options: { rawResult?: boolean } = {}
  ): Promise<any> {
    const keys = Object.keys(args).filter(k => experimentRegistry.listAvailable().includes(k));

    if (keys.length === 0) {
      // No args — return current state
      const states = experimentRegistry.getStates();
      if (options.rawResult) {
        return { success: true, experiments: states, available: experimentRegistry.listAvailable() };
      }
      return {
        content: [{
          type: 'text',
          text: this.statusHeader() +
            `### Experimental Features\n\n` +
            Object.entries(states).map(([k, v]) => `- **${k}**: ${v ? 'enabled' : 'disabled'}`).join('\n') +
            `\n\nPass \`{ "feature_name": true/false }\` to toggle.`,
        }],
      };
    }

    // Apply changes
    for (const key of keys) {
      const value = args[key];
      if (value === true) experimentRegistry.enable(key);
      else if (value === false) experimentRegistry.disable(key);
    }

    const states = experimentRegistry.getStates();
    if (options.rawResult) {
      return { success: true, experiments: states };
    }

    return {
      content: [{
        type: 'text',
        text: this.statusHeader() +
          `### Experimental Features Updated\n\n` +
          Object.entries(states).map(([k, v]) => `- **${k}**: ${v ? 'enabled' : 'disabled'}`).join('\n'),
      }],
    };
  }

  // --- Reload (debug) ---

  private onReloadMCP(options: { rawResult?: boolean } = {}): any {
    if (!this.debugMode) {
      return {
        content: [{ type: 'text', text: 'reload_mcp only available in debug mode.' }],
        isError: true,
      };
    }

    if (options.rawResult) {
      setTimeout(() => process.exit(42), 100);
      return { success: true, message: 'Reloading...' };
    }

    setTimeout(() => process.exit(42), 100);
    return {
      content: [{ type: 'text', text: '🔄 Reloading MCP server...' }],
    };
  }

  // --- Notify tools changed ---

  private async notifyToolsListChanged(): Promise<void> {
    if (this.server) {
      try {
        await (this.server as any).sendToolsListChanged?.();
      } catch {
        // Client may not support this notification
      }
    }
  }

  // --- Public accessors for BrowserBridge to update state ---

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

  // --- Shutdown ---

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
