/**
 * Connection-level tool handlers — enable, disable, status, experimental features, reload.
 */

import type { ConnectionManagerAPI } from './types';
import { ExtensionServer } from '../bridge';
import { createLog } from '../logger';
import { experimentRegistry, isInfraExperimentEnabled, applyInitialState } from '../experimental/index';

const log = createLog('[Conn]');

// Forward-declare BrowserBridge import (lazy to avoid circular deps)
let BrowserBridge: any = null;

async function getBrowserBridge(): Promise<any> {
  if (!BrowserBridge) {
    const mod = await import('../tools');
    BrowserBridge = mod.BrowserBridge;
  }
  return BrowserBridge;
}

// ─── Enable ──────────────────────────────────────────────────

export async function onEnable(
  mgr: ConnectionManagerAPI,
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

  if (mgr.state !== 'passive') {
    if (options.rawResult) {
      return {
        success: true,
        already_enabled: true,
        state: mgr.state,
        browser: mgr.connectedBrowserName,
        client_id: mgr.clientId,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text:
            mgr.statusHeader() +
            `### ✅ Already Enabled\n\n**State:** ${mgr.state}\n**Client ID:** ${mgr.clientId}\n\nTo restart, call \`disable\` first.`,
        },
      ],
    };
  }

  mgr.clientId = (args.client_id as string).trim();
  log('Client ID set to:', mgr.clientId);

  try {
    log('Starting extension server...');

    const port = mgr.config.port || 5555;
    if (isInfraExperimentEnabled('multiplexer', mgr.config)) {
      const { Multiplexer } = await import('../experimental/multiplexer');
      mgr.extensionServer = new Multiplexer(port, '127.0.0.1', mgr.clientId!);
    } else {
      mgr.extensionServer = new ExtensionServer(port, '127.0.0.1');
    }
    await mgr.extensionServer.start();

    if (mgr.clientId) {
      mgr.extensionServer.notifyClientId(mgr.clientId);
    }

    // Handle extension reconnections
    mgr.extensionServer.onReconnect = () => {
      log('Extension reconnected, resetting tab state...');
      mgr.attachedTab = null;
      if (mgr.clientId) {
        mgr.extensionServer!.notifyClientId(mgr.clientId);
      }
    };

    // Monitor tab info updates
    mgr.extensionServer.onTabInfoUpdate = (tabInfo: any) => {
      log('Tab info update:', tabInfo);
      if (tabInfo === null) {
        mgr.attachedTab = null;
        return;
      }
      if (mgr.attachedTab) {
        mgr.attachedTab = {
          ...mgr.attachedTab,
          id: tabInfo.id,
          title: tabInfo.title,
          url: tabInfo.url,
          index: tabInfo.index,
          techStack: tabInfo.techStack || null,
        };
      }
    };

    const BB = await getBrowserBridge();
    mgr.bridge = new BB(mgr.config, mgr.extensionServer);
    await mgr.bridge.initialize(mgr.server, mgr.clientInfo, mgr);

    mgr.state = 'active';
    mgr.connectedBrowserName = 'Local Browser';

    // Pre-enable session features from env var
    applyInitialState(mgr.config);

    // Notify MCP client that tool list changed
    mgr.notifyToolsListChanged().catch((err: any) =>
      log('Error sending notification:', err)
    );

    // One-time tip about env var on first enable
    let tip = '';
    if (!mgr.tipShown) {
      mgr.tipShown = true;
      tip = `\n\n> **IMPORTANT TIP:** You can notify the user that they can set \`SUPERSURF_EXPERIMENTS=multiplexer,page_diffing,smart_waiting\` in their environment to pre-enable experimental features. Let the user know they can set up experimental features this way. Experiments kick in after restarting the MCP server. There may be features of interest to them such as "page_diffing" that provides agents with diffing to reduce token cost when reanalyzing pages post-browser action, or server multiplexing which allows multiple agents (different claude code or coding agent tool) to connect to the same browser and perform tasks in parallel!`;
    }

    if (options.rawResult) {
      return {
        success: true,
        state: mgr.state,
        browser: mgr.connectedBrowserName,
        client_id: mgr.clientId,
        port: mgr.config.port || 5555,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text:
            mgr.statusHeader() +
            `### ✅ Browser Automation Activated!\n\n` +
            `**State:** Active (waiting for extension)\n` +
            `**Port:** ${port}\n\n` +
            `**Next Steps:**\n` +
            `1. Open the SuperSurf extension popup and enable it\n` +
            `2. Call \`browser_tabs action='list'\` to see tabs\n` +
            `3. Call \`browser_tabs action='attach' index=N\` to attach` +
            tip,
        },
      ],
    };
  } catch (error: any) {
    log('Failed to start:', error);
    mgr.bridge = null;
    if (mgr.extensionServer) {
      await mgr.extensionServer.stop().catch(() => {});
      mgr.extensionServer = null;
    }
    mgr.state = 'passive';

    const port = mgr.config.port || 5555;
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

// ─── Disable ─────────────────────────────────────────────────

export async function onDisable(
  mgr: ConnectionManagerAPI,
  options: { rawResult?: boolean } = {}
): Promise<any> {
  if (mgr.state === 'passive') {
    if (options.rawResult) {
      return { success: true, already_disabled: true, state: 'passive' };
    }
    return {
      content: [
        {
          type: 'text',
          text:
            mgr.statusHeader() +
            `### Already Disabled\n\nCall \`enable\` to activate.`,
        },
      ],
    };
  }

  log('Disconnecting...');

  if (mgr.bridge) {
    mgr.bridge.serverClosed();
    mgr.bridge = null;
  }

  if (mgr.extensionServer) {
    await mgr.extensionServer.stop();
    mgr.extensionServer = null;
  }

  mgr.state = 'passive';
  mgr.connectedBrowserName = null;
  mgr.attachedTab = null;
  experimentRegistry.reset();

  mgr.notifyToolsListChanged().catch((err: any) =>
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
          mgr.statusHeader() +
          `### ✅ Disabled\n\nBrowser automation deactivated. Call \`enable\` to reactivate.`,
      },
    ],
  };
}

// ─── Status ──────────────────────────────────────────────────

export async function onStatus(
  mgr: ConnectionManagerAPI,
  options: { rawResult?: boolean } = {}
): Promise<any> {
  const statusData = {
    state: mgr.state,
    browser: mgr.connectedBrowserName,
    client_id: mgr.clientId,
    attached_tab: mgr.attachedTab
      ? {
          index: mgr.attachedTab.index,
          title: mgr.attachedTab.title,
          url: mgr.attachedTab.url,
        }
      : null,
  };

  if (options.rawResult) {
    return statusData;
  }

  if (mgr.state === 'passive') {
    return {
      content: [
        {
          type: 'text',
          text:
            mgr.statusHeader() +
            `### ❌ Disabled\n\nBrowser automation is not active. Call \`enable\` to activate.`,
        },
      ],
    };
  }

  let statusText = `### ✅ Enabled\n\n`;
  if (mgr.connectedBrowserName) {
    statusText += `**Browser:** ${mgr.connectedBrowserName}\n`;
  }

  if (mgr.attachedTab) {
    statusText += `**Tab:** #${mgr.attachedTab.index} — ${mgr.attachedTab.title || 'Untitled'}\n`;
    statusText += `**URL:** ${mgr.attachedTab.url || 'N/A'}\n\n`;
    statusText += `✅ Ready for automation!`;
  } else {
    statusText += `\n⚠️ No tab attached. Use \`browser_tabs action='attach' index=N\`.`;
  }

  return {
    content: [{ type: 'text', text: mgr.statusHeader() + statusText }],
  };
}

// ─── Experimental Features ───────────────────────────────────

export async function onExperimentalFeatures(
  mgr: ConnectionManagerAPI,
  args: Record<string, unknown> = {},
  options: { rawResult?: boolean } = {}
): Promise<any> {
  const keys = Object.keys(args).filter(k => experimentRegistry.listAvailable().includes(k));

  if (keys.length === 0) {
    const states = experimentRegistry.getStates();
    if (options.rawResult) {
      return { success: true, experiments: states, available: experimentRegistry.listAvailable() };
    }
    return {
      content: [{
        type: 'text',
        text: mgr.statusHeader() +
          `### Experimental Features\n\n` +
          Object.entries(states).map(([k, v]) => `- **${k}**: ${v ? 'enabled' : 'disabled'}`).join('\n') +
          `\n\nPass \`{ "feature_name": true/false }\` to toggle.`,
      }],
    };
  }

  for (const key of keys) {
    const value = args[key];
    if (value === true) {
      experimentRegistry.enable(key);
    } else if (value === false) {
      experimentRegistry.disable(key);
    }
  }

  const states = experimentRegistry.getStates();
  if (options.rawResult) {
    return { success: true, experiments: states };
  }

  return {
    content: [{
      type: 'text',
      text: mgr.statusHeader() +
        `### Experimental Features Updated\n\n` +
        Object.entries(states).map(([k, v]) => `- **${k}**: ${v ? 'enabled' : 'disabled'}`).join('\n'),
    }],
  };
}

// ─── Reload (debug) ──────────────────────────────────────────

export function onReloadMCP(
  mgr: ConnectionManagerAPI,
  options: { rawResult?: boolean } = {}
): any {
  if (!mgr.debugMode) {
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
