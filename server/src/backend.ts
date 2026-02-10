/**
 * Stateful Backend — manages connection lifecycle
 * States: passive → active → connected
 *
 * Adapted from Blueprint MCP (Apache 2.0) — stripped of PRO/proxy/OAuth
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ExtensionServer } from './extensionServer';
import { DirectTransport, Transport } from './transport';
import { getLogger } from './logger';
import { experimentRegistry } from './experimental/index';

function debugLog(...args: unknown[]): void {
  if ((global as any).DEBUG_MODE) {
    console.error(...args);
  }
}

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

// Forward-declare UnifiedBackend import (lazy to avoid circular deps)
let UnifiedBackend: any = null;

async function getUnifiedBackend(): Promise<any> {
  if (!UnifiedBackend) {
    const mod = await import('./tools');
    UnifiedBackend = mod.UnifiedBackend;
  }
  return UnifiedBackend;
}

export class StatefulBackend {
  private _config: BackendConfig;
  private _state: BackendState = 'passive';
  private _activeBackend: any = null;
  private _extensionServer: ExtensionServer | null = null;
  private _debugMode: boolean;
  private _clientId: string | null = null;
  private _connectedBrowserName: string | null = null;
  private _attachedTab: TabInfo | null = null;
  private _stealthMode: boolean = false;
  private _server: Server | null = null;
  private _clientInfo: Record<string, unknown> = {};

  constructor(config: BackendConfig) {
    debugLog('[StatefulBackend] Constructor — starting in PASSIVE mode');
    this._config = config;
    this._debugMode = config.debug || false;
  }

  async initialize(server: Server | null, clientInfo: Record<string, unknown>): Promise<void> {
    debugLog('[StatefulBackend] Initialize called — staying in passive mode');
    this._server = server;
    this._clientInfo = clientInfo;
  }

  // --- Status header (1-liner prepended to all responses) ---

  _getStatusHeader(): string {
    const version = this._config.server.version;

    if (this._state === 'passive') {
      return `🔴 v${version} | Disabled\n---\n\n`;
    }

    const parts: string[] = [];

    let buildTime: string | null = null;
    if (this._extensionServer) {
      buildTime = this._extensionServer.getBuildTimestamp();
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
      buildTime && this._debugMode ? `v${version} [${buildTime}]` : `v${version}`;
    parts.push(`✅ ${versionStr}`);

    if (this._connectedBrowserName) {
      parts.push(`🌐 ${this._connectedBrowserName}`);
    }

    if (this._attachedTab) {
      const url = this._attachedTab.url || 'about:blank';
      const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
      parts.push(`📄 Tab ${this._attachedTab.index}: ${shortUrl}`);

      if (this._attachedTab.techStack) {
        const tech = this._attachedTab.techStack;
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

    if (this._stealthMode) {
      parts.push(`🕵️ Stealth`);
    }

    return parts.join(' | ') + '\n---\n\n';
  }

  // --- Tool listing ---

  async listTools(): Promise<ToolSchema[]> {
    debugLog(`[StatefulBackend] listTools() — state: ${this._state}`);

    const connectionTools: ToolSchema[] = [
      {
        name: 'enable',
        description:
          'Enable browser automation. Starts the WebSocket server for the extension to connect. Provide a client_id for connection tracking.',
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
          'Disable browser automation and return to passive mode. Closes browser extension connection.',
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
          'Check current state: passive (not connected) or active/connected (browser automation enabled).',
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
          'Enable or disable experimental features for this session. Available experiments:\n' +
          '- **page_diffing**: After browser_interact actions, returns only DOM changes (added/removed text, element count delta) instead of requiring a full re-read. Includes a confidence score that drops for shadow DOM-heavy or iframe-heavy pages.\n' +
          '- **smart_waiting**: Replaces hardcoded 1500ms navigation delays with adaptive waiting (DOM stability + network idle detection). Typically faster on simple pages, same timeout ceiling on complex ones.',
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

    // Get browser tools from UnifiedBackend (dummy transport, schema only)
    const UB = await getUnifiedBackend();
    const dummyBackend = new UB(this._config, null);
    const browserTools = await dummyBackend.listTools();

    // Debug tools
    const debugTools: ToolSchema[] = [];
    if (this._debugMode) {
      debugTools.push({
        name: 'reload_mcp',
        description:
          'Reload the MCP server without disconnecting. Debug mode only. Server exits with code 42, wrapper restarts it.',
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
    debugLog(`[StatefulBackend] callTool(${name}) — state: ${this._state}`);

    switch (name) {
      case 'enable':
        return await this._handleEnable(rawArguments, options);
      case 'disable':
        return await this._handleDisable(options);
      case 'status':
        return await this._handleStatus(options);
      case 'experimental_features':
        return await this._handleExperimentalFeatures(rawArguments, options);
      case 'reload_mcp':
        return this._handleReloadMCP(options);
    }

    // Forward to active backend
    if (!this._activeBackend) {
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

    return await this._activeBackend.callTool(name, rawArguments, options);
  }

  // --- Enable ---

  private async _handleEnable(
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

    if (this._state !== 'passive') {
      if (options.rawResult) {
        return {
          success: true,
          already_enabled: true,
          state: this._state,
          browser: this._connectedBrowserName,
          client_id: this._clientId,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              this._getStatusHeader() +
              `### ✅ Already Enabled\n\n**State:** ${this._state}\n**Client ID:** ${this._clientId}\n\nTo restart, call \`disable\` first.`,
          },
        ],
      };
    }

    this._clientId = (args.client_id as string).trim();
    debugLog('[StatefulBackend] Client ID set to:', this._clientId);

    try {
      debugLog('[StatefulBackend] Starting extension server...');

      const port = this._config.port || 5555;
      this._extensionServer = new ExtensionServer(port, '127.0.0.1');
      await this._extensionServer.start();

      if (this._clientId) {
        this._extensionServer.setClientId(this._clientId);
      }

      // Handle extension reconnections
      this._extensionServer.onReconnect = () => {
        debugLog('[StatefulBackend] Extension reconnected, resetting tab state...');
        this._attachedTab = null;
        if (this._clientId) {
          this._extensionServer!.setClientId(this._clientId);
        }
      };

      // Monitor tab info updates
      this._extensionServer.onTabInfoUpdate = (tabInfo: any) => {
        debugLog('[StatefulBackend] Tab info update:', tabInfo);
        if (tabInfo === null) {
          this._attachedTab = null;
          return;
        }
        if (this._attachedTab) {
          this._attachedTab = {
            ...this._attachedTab,
            id: tabInfo.id,
            title: tabInfo.title,
            url: tabInfo.url,
            index: tabInfo.index,
            techStack: tabInfo.techStack || null,
          };
        }
      };

      const transport = new DirectTransport(this._extensionServer);

      const UB = await getUnifiedBackend();
      this._activeBackend = new UB(this._config, transport);
      await this._activeBackend.initialize(this._server, this._clientInfo, this);

      this._state = 'active';
      this._connectedBrowserName = 'Local Browser';

      // Notify MCP client that tool list changed
      this._notifyToolsListChanged().catch((err: any) =>
        debugLog('[StatefulBackend] Error sending notification:', err)
      );

      if (options.rawResult) {
        return {
          success: true,
          state: this._state,
          browser: this._connectedBrowserName,
          client_id: this._clientId,
          port: this._config.port || 5555,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              this._getStatusHeader() +
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
      debugLog('[StatefulBackend] Failed to start:', error);
      this._activeBackend = null;
      this._state = 'passive';

      const port = this._config.port || 5555;
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

  private async _handleDisable(options: { rawResult?: boolean } = {}): Promise<any> {
    if (this._state === 'passive') {
      if (options.rawResult) {
        return { success: true, already_disabled: true, state: 'passive' };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              this._getStatusHeader() +
              `### Already Disabled\n\nCall \`enable\` to activate.`,
          },
        ],
      };
    }

    debugLog('[StatefulBackend] Disconnecting...');

    if (this._activeBackend) {
      this._activeBackend.serverClosed();
      this._activeBackend = null;
    }

    if (this._extensionServer) {
      await this._extensionServer.stop();
      this._extensionServer = null;
    }

    this._state = 'passive';
    this._connectedBrowserName = null;
    this._attachedTab = null;
    experimentRegistry.reset();

    this._notifyToolsListChanged().catch((err: any) =>
      debugLog('[StatefulBackend] Error sending notification:', err)
    );

    if (options.rawResult) {
      return { success: true, state: 'passive' };
    }

    return {
      content: [
        {
          type: 'text',
          text:
            this._getStatusHeader() +
            `### ✅ Disabled\n\nBrowser automation deactivated. Call \`enable\` to reactivate.`,
        },
      ],
    };
  }

  // --- Status ---

  private async _handleStatus(options: { rawResult?: boolean } = {}): Promise<any> {
    const statusData = {
      state: this._state,
      browser: this._connectedBrowserName,
      client_id: this._clientId,
      attached_tab: this._attachedTab
        ? {
            index: this._attachedTab.index,
            title: this._attachedTab.title,
            url: this._attachedTab.url,
          }
        : null,
    };

    if (options.rawResult) {
      return statusData;
    }

    if (this._state === 'passive') {
      return {
        content: [
          {
            type: 'text',
            text:
              this._getStatusHeader() +
              `### ❌ Disabled\n\nBrowser automation is not active. Call \`enable\` to activate.`,
          },
        ],
      };
    }

    let statusText = `### ✅ Enabled\n\n`;
    if (this._connectedBrowserName) {
      statusText += `**Browser:** ${this._connectedBrowserName}\n`;
    }

    if (this._attachedTab) {
      statusText += `**Tab:** #${this._attachedTab.index} — ${this._attachedTab.title || 'Untitled'}\n`;
      statusText += `**URL:** ${this._attachedTab.url || 'N/A'}\n\n`;
      statusText += `✅ Ready for automation!`;
    } else {
      statusText += `\n⚠️ No tab attached. Use \`browser_tabs action='attach' index=N\`.`;
    }

    return {
      content: [{ type: 'text', text: this._getStatusHeader() + statusText }],
    };
  }

  // --- Experimental Features ---

  private async _handleExperimentalFeatures(
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
          text: this._getStatusHeader() +
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
        text: this._getStatusHeader() +
          `### Experimental Features Updated\n\n` +
          Object.entries(states).map(([k, v]) => `- **${k}**: ${v ? 'enabled' : 'disabled'}`).join('\n'),
      }],
    };
  }

  // --- Reload (debug) ---

  private _handleReloadMCP(options: { rawResult?: boolean } = {}): any {
    if (!this._debugMode) {
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

  private async _notifyToolsListChanged(): Promise<void> {
    if (this._server) {
      try {
        await (this._server as any).sendToolsListChanged?.();
      } catch {
        // Client may not support this notification
      }
    }
  }

  // --- Public accessors for UnifiedBackend to update state ---

  setAttachedTab(tab: TabInfo | null): void {
    this._attachedTab = tab;
  }

  getAttachedTab(): TabInfo | null {
    return this._attachedTab;
  }

  setConnectedBrowserName(name: string): void {
    this._connectedBrowserName = name;
  }

  setStealthMode(enabled: boolean): void {
    this._stealthMode = enabled;
  }

  // --- Shutdown ---

  async serverClosed(): Promise<void> {
    debugLog('[StatefulBackend] Server closed');

    if (this._activeBackend) {
      this._activeBackend.serverClosed();
      this._activeBackend = null;
    }

    if (this._extensionServer) {
      await this._extensionServer.stop();
      this._extensionServer = null;
    }

    this._state = 'passive';
  }
}
