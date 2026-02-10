/**
 * SuperSurf extension background service worker
 * Connects to MCP server and handles browser automation commands via CDP + scripting API
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from './utils/logger.js';
import { IconManager } from './utils/icons.js';
import { WebSocketConnection } from './connection/websocket.js';
import { TabHandlers } from './handlers/tabs.js';
import { NetworkTracker } from './handlers/network.js';
import { DialogHandler } from './handlers/dialogs.js';
import { ConsoleHandler } from './handlers/console.js';
import { wrapWithUnwrap, shouldUnwrap } from './utils/unwrap.js';
import { secureFill } from './secure-fill.js';
import { ExperimentalFeatures } from './experimental/index.js';

// chrome.debugger is a reserved word — access via bracket notation
const chromeDebugger = (chrome as any)['debugger'] as ChromeDebugger;

// Top-level variables
let tabHandlers: TabHandlers;
let wsConnection: WebSocketConnection;

// Register tabs.onUpdated at TOP LEVEL for MV3 persistence
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tabHandlers) return;

  const attachedTabId = tabHandlers.getAttachedTabId();
  if (tabId === attachedTabId && changeInfo.url && wsConnection) {
    wsConnection.sendNotification('notifications/tab_info_update', {
      currentTab: {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        index: null,
        techStack: null,
      },
    });
  }
});

// ── Main initialization ──
(async () => {
  const logger = new Logger('SuperSurf');
  await logger.init(chrome);
  const manifest = chrome.runtime.getManifest();
  logger.logAlways(`SuperSurf v${manifest.version}`);

  const iconManager = new IconManager(chrome, logger);
  tabHandlers = new TabHandlers(chrome, logger, iconManager);
  const networkTracker = new NetworkTracker(chrome, logger);
  const dialogHandler = new DialogHandler(chrome, logger);
  const consoleHandler = new ConsoleHandler(chrome, logger);

  tabHandlers.setConsoleInjector((tabId) => consoleHandler.injectConsoleCapture(tabId));
  tabHandlers.setDialogInjector((tabId) => dialogHandler.setupDialogOverrides(tabId));

  consoleHandler.setupMessageListener();
  iconManager.init();
  networkTracker.init();

  // State
  let techStackInfo: Record<number, any> = {};
  let debuggerAttached = false;
  let currentDebuggerTabId: number | null = null;
  const cdpNetworkRequests = new Map<string, any>();
  const MAX_CDP_REQUESTS = 500;

  // Keepalive + reconnect alarms
  if (chrome.alarms) {
    // Keepalive fires every minute — always checks connection
    chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepalive') {
        logger.log('[Background] Keepalive tick, connected=' + wsConnection.isConnected);
        if (!wsConnection.isConnected) {
          logger.log('[Background] Not connected, reconnecting...');
          wsConnection.connect();
        }
      } else if (alarm.name === 'ws-reconnect') {
        logger.log('[Background] Reconnect alarm fired');
        wsConnection.handleReconnectAlarm();
      }
    });
  }

  // CDP debugger events for network tracking
  chromeDebugger.onEvent.addListener((source, method, params: any) => {
    if (!method.startsWith('Network.') && !method.startsWith('Runtime.')) return;
    if (!currentDebuggerTabId || source.tabId !== currentDebuggerTabId) return;

    try {
      if (method === 'Network.requestWillBeSent') {
        if (cdpNetworkRequests.size >= MAX_CDP_REQUESTS) {
          const oldest = cdpNetworkRequests.keys().next().value;
          if (oldest) cdpNetworkRequests.delete(oldest);
        }
        cdpNetworkRequests.set(params.requestId, {
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          type: params.type || 'other',
          timestamp: params.wallTime || Date.now() / 1000,
          headers: params.request.headers,
          postData: params.request.postData,
        });
      } else if (method === 'Network.responseReceived') {
        const req = cdpNetworkRequests.get(params.requestId);
        if (req) {
          req.statusCode = params.response.status;
          req.statusText = params.response.statusText;
          req.responseHeaders = params.response.headers;
          req.mimeType = params.response.mimeType;
        }
      } else if (method === 'Network.loadingFinished') {
        const req = cdpNetworkRequests.get(params.requestId);
        if (req) req.completed = true;
      }
    } catch (e) {
      logger.log('[Background] CDP event error:', e);
    }
  });

  chromeDebugger.onDetach.addListener((source) => {
    if (source.tabId === currentDebuggerTabId) {
      debuggerAttached = false;
      currentDebuggerTabId = null;
      logger.log('[Background] Debugger detached');
    }
  });

  // Listen for tech stack info from content script
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'techStack' && sender.tab?.id) {
      techStackInfo[sender.tab.id] = message.data;
      tabHandlers.setTechStackInfo(sender.tab.id, message.data);
    }
  });

  // ── Helper: attach debugger ──
  async function ensureDebugger(tabId: number): Promise<void> {
    if (debuggerAttached && currentDebuggerTabId === tabId) return;

    if (debuggerAttached && currentDebuggerTabId !== tabId) {
      try {
        await chromeDebugger.detach({ tabId: currentDebuggerTabId! });
      } catch { /* ignore */ }
    }

    await chromeDebugger.attach({ tabId }, '1.3');
    debuggerAttached = true;
    currentDebuggerTabId = tabId;
    await chromeDebugger.sendCommand({ tabId }, 'Network.enable', {});
    await chromeDebugger.sendCommand({ tabId }, 'DOM.enable', {});
    await chromeDebugger.sendCommand({ tabId }, 'CSS.enable', {});
    await chromeDebugger.sendCommand({ tabId }, 'Runtime.enable', {});
    await chromeDebugger.sendCommand({ tabId }, 'Page.enable', {});
  }

  // ── Helper: send CDP command with timeout ──
  async function cdp(tabId: number, method: string, params: any = {}, timeout: number = 25000): Promise<any> {
    await ensureDebugger(tabId);
    return await Promise.race([
      chromeDebugger.sendCommand({ tabId }, method, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP timeout: ${method} (${timeout}ms)`)), timeout)
      ),
    ]);
  }

  // ── WebSocket connection ──
  wsConnection = new WebSocketConnection(chrome, logger, iconManager);

  // ── Register command handlers ──

  // getTabs
  wsConnection.registerCommandHandler('getTabs', async () => {
    return await tabHandlers.getTabs();
  });

  // createTab
  wsConnection.registerCommandHandler('createTab', async (params) => {
    return await tabHandlers.createTab(params);
  });

  // selectTab
  wsConnection.registerCommandHandler('selectTab', async (params) => {
    return await tabHandlers.selectTab(params);
  });

  // closeTab
  wsConnection.registerCommandHandler('closeTab', async (params) => {
    return await tabHandlers.closeTab(params?.index);
  });

  // navigate
  wsConnection.registerCommandHandler('navigate', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    const action = params.action || 'url';
    if (action === 'url') {
      await chrome.tabs.update(tabId, { url: params.url });
      return { success: true, url: params.url };
    } else if (action === 'back') {
      await cdp(tabId, 'Page.navigateToHistoryEntry', { entryId: -1 });
      return { success: true, action: 'back' };
    } else if (action === 'forward') {
      await cdp(tabId, 'Page.navigateToHistoryEntry', { entryId: 1 });
      return { success: true, action: 'forward' };
    } else if (action === 'reload') {
      await chrome.tabs.reload(tabId);
      return { success: true, action: 'reload' };
    }
    return { success: false, error: `Unknown action: ${action}` };
  });

  // forwardCDPCommand (generic CDP passthrough)
  wsConnection.registerCommandHandler('forwardCDPCommand', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');
    return await cdp(tabId, params.method, params.params || {});
  });

  // evaluate (JavaScript execution)
  wsConnection.registerCommandHandler('evaluate', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    const code = params.function || params.expression || '';
    const wrapped = shouldUnwrap(code) ? wrapWithUnwrap(code) : code;

    const result = await cdp(tabId, 'Runtime.evaluate', {
      expression: wrapped,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'JavaScript execution error');
    }

    return result.result?.value;
  });

  // snapshot (accessible DOM)
  wsConnection.registerCommandHandler('snapshot', async () => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');
    return await cdp(tabId, 'Accessibility.getFullAXTree', {});
  });

  // screenshot
  wsConnection.registerCommandHandler('screenshot', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    const captureParams: any = {
      format: params.type || 'jpeg',
      quality: params.quality || 70,
      optimizeForSpeed: true,
    };
    if (params.clip_x !== undefined) {
      captureParams.clip = {
        x: params.clip_x, y: params.clip_y,
        width: params.clip_width, height: params.clip_height,
        scale: 1,
      };
    }

    const result = await cdp(tabId, 'Page.captureScreenshot', captureParams, 45000);
    return { data: result.data, mimeType: `image/${params.type || 'jpeg'}` };
  });

  // consoleMessages
  wsConnection.registerCommandHandler('consoleMessages', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    return { messages: consoleHandler.getMessages(tabId || undefined) };
  });

  // networkRequests
  wsConnection.registerCommandHandler('networkRequests', async (params) => {
    return { requests: networkTracker.getRequests() };
  });

  // clearNetwork
  wsConnection.registerCommandHandler('clearNetwork', async () => {
    networkTracker.clearRequests();
    cdpNetworkRequests.clear();
    return { success: true };
  });

  // dialog
  wsConnection.registerCommandHandler('dialog', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    if (params.accept !== undefined) {
      await dialogHandler.setupDialogOverrides(tabId, params.accept, params.text);
      return { success: true };
    }

    return { events: await dialogHandler.getDialogEvents(tabId) };
  });

  // window management
  wsConnection.registerCommandHandler('window', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;

    switch (params.action) {
      case 'resize':
        await chrome.windows.update(windowId, { width: params.width, height: params.height });
        return { success: true };
      case 'minimize':
        await chrome.windows.update(windowId, { state: 'minimized' });
        return { success: true };
      case 'maximize':
        await chrome.windows.update(windowId, { state: 'maximized' });
        return { success: true };
      case 'close':
        await chrome.windows.remove(windowId);
        return { success: true };
      default:
        throw new Error(`Unknown window action: ${params.action}`);
    }
  });

  // extensions
  wsConnection.registerCommandHandler('listExtensions', async () => {
    const extensions = await chrome.management.getAll();
    return { extensions: extensions.map((e) => ({ id: e.id, name: e.name, enabled: e.enabled, type: e.type })) };
  });

  wsConnection.registerCommandHandler('reloadExtension', async (params) => {
    const extensions = await chrome.management.getAll();
    const ext = extensions.find((e) =>
      e.name.toLowerCase().includes((params.extensionName || '').toLowerCase()) &&
      e.installType === 'development'
    );
    if (!ext) throw new Error('Extension not found or not unpacked');
    await chrome.management.setEnabled(ext.id, false);
    await chrome.management.setEnabled(ext.id, true);
    return { success: true, name: ext.name };
  });

  // performance metrics
  wsConnection.registerCommandHandler('performanceMetrics', async () => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');
    const result = await cdp(tabId, 'Performance.getMetrics', {});
    return { metrics: result.metrics };
  });

  // secure_fill
  wsConnection.registerCommandHandler('secure_fill', async (params) => {
    const tabId = tabHandlers.getAttachedTabId();
    if (!tabId) throw new Error('No tab attached');

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as any,
      func: (selector: string, value: string) => {
        // Inline secure fill logic for MAIN world execution
        return new Promise<{ success: boolean; error?: string }>((resolve) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) {
            resolve({ success: false, error: `Element not found: ${selector}` });
            return;
          }

          el.focus();
          el.dispatchEvent(new Event('focus', { bubbles: true }));
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));

          let i = 0;
          const chars = value.split('');
          function typeNext() {
            if (i >= chars.length) {
              el!.dispatchEvent(new Event('change', { bubbles: true }));
              resolve({ success: true });
              return;
            }
            const char = chars[i++];
            el!.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            el!.value += char;
            el!.dispatchEvent(new Event('input', { bubbles: true }));
            el!.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
            setTimeout(typeNext, 40 + Math.random() * 80);
          }
          typeNext();
        });
      },
      args: [params.selector, params.value],
    });

    return results?.[0]?.result || { success: false, error: 'Script execution failed' };
  });

  // ── Experimental feature handlers ──
  ExperimentalFeatures.registerHandlers(wsConnection, tabHandlers, networkTracker);

  // ── Popup message handler ──
  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
    if (message.type === 'getStatus') {
      const attachedTabId = tabHandlers.getAttachedTabId();
      sendResponse({
        connected: wsConnection.isConnected,
        currentTabConnected: attachedTabId !== null,
        stealthMode: null,
        projectName: wsConnection.projectName,
      });
      return true;
    }
    if (message.type === 'enableExtension') {
      chrome.storage.local.set({ extensionEnabled: true });
      if (!wsConnection.isConnected) wsConnection.connect();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'disableExtension') {
      chrome.storage.local.set({ extensionEnabled: false });
      wsConnection.disconnect();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // ── Connect ──
  await wsConnection.connect();

  logger.logAlways('SuperSurf background initialized');
})();
