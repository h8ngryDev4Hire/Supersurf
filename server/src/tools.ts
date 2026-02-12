/**
 * BrowserBridge — orchestrator for browser tool dispatch.
 * Owns CDP/eval helpers and delegates tool execution to modular handlers in tools/.
 */

import type { IExtensionTransport } from './bridge';
import type { ToolSchema, ToolContext } from './tools/types';
import { createLog } from './logger';

// Tool modules
import { getToolSchemas } from './tools/schemas';
import { onInteract } from './tools/interaction';
import { onSnapshot, onLookup, onExtractContent } from './tools/content';
import { onGetElementStyles } from './tools/styles';
import { onScreenshot, onPdfSave } from './tools/screenshot';
import { onNetworkRequests, onConsoleMessages } from './tools/network';
import { onBrowserTabs, onNavigate } from './tools/navigation';
import { onFillForm, onDrag, onSecureFill } from './tools/forms';
import {
  onWindow, onDialog, onEvaluate,
  onVerifyTextVisible, onVerifyElementVisible,
  onListExtensions, onReloadExtensions,
  onPerformanceMetrics,
} from './tools/misc';

const log = createLog('[Bridge]');

export class BrowserBridge {
  private config: any;
  private ext: IExtensionTransport | null;
  private server: any = null;
  private clientInfo: any = {};
  private connectionManager: any = null;

  constructor(config: any, ext: IExtensionTransport | null) {
    this.config = config;
    this.ext = ext;
  }

  async initialize(server: any, clientInfo: any, connectionManager?: any): Promise<void> {
    this.server = server;
    this.clientInfo = clientInfo;
    this.connectionManager = connectionManager;
  }

  serverClosed(): void {
    log('Server closed');
  }

  // ─── ToolContext factory ──────────────────────────────────────

  /** Build the context object that tool handlers receive */
  private get ctx(): ToolContext {
    return {
      ext: this.ext!,
      connectionManager: this.connectionManager,
      cdp: this.cdp.bind(this),
      eval: this.evalExpr.bind(this),
      sleep: this.sleep.bind(this),
      getElementCenter: this.getElementCenter.bind(this),
      getSelectorExpression: this.getSelectorExpression.bind(this),
      findAlternativeSelectors: this.findAlternativeSelectors.bind(this),
      formatResult: this.formatResult.bind(this),
      error: this.error.bind(this),
    };
  }

  // ─── CDP + Eval Helpers ─────────────────────────────────────

  /** Send a CDP command through the extension's forwardCDPCommand handler */
  private async cdp(method: string, params: any = {}): Promise<any> {
    return await this.ext!.sendCmd('forwardCDPCommand', { method, params });
  }

  /** Evaluate JS expression in page context, return by value */
  private async evalExpr(expression: string, awaitPromise = true): Promise<any> {
    const result = await this.cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'JavaScript execution error');
    }
    return result.result?.value;
  }

  /** Sleep for specified ms */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Get center coordinates of an element by selector, with "Did you mean?" hints on failure */
  private async getElementCenter(selector: string): Promise<{ x: number; y: number }> {
    const expr = this.getSelectorExpression(selector);
    const result = await this.evalExpr(`
      (() => {
        const el = ${expr};
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      })()
    `);
    if (!result) {
      const hints = await this.findAlternativeSelectors(selector);
      let msg = `Element not found: \`${selector}\``;
      if (hints && hints.length > 0) {
        msg += '\n\nDid you mean?';
        hints.forEach((alt: any, i: number) => {
          const vis = alt.visible ? '' : ' (hidden)';
          msg += `\n  ${i + 1}. \`${alt.selector}\`${vis}`;
          if (alt.text) msg += `\n     Text: "${alt.text}"`;
        });
      }
      throw new Error(msg);
    }
    return result;
  }

  /** Search for alternative elements when a selector fails */
  private async findAlternativeSelectors(selector: string): Promise<any[]> {
    const m = selector.match(/:has-text\(["'](.+?)["']\)/);
    if (!m) return [];
    const searchText = m[1];

    try {
      const result = await this.evalExpr(`
        (() => {
          const searchText = ${JSON.stringify(searchText)};
          const searchLower = searchText.trim().toLowerCase();
          const alts = [];

          for (const el of document.querySelectorAll('*')) {
            let directText = '';
            for (const n of el.childNodes) {
              if (n.nodeType === Node.TEXT_NODE) directText += n.textContent;
            }
            directText = directText.trim();
            if (!directText.toLowerCase().includes(searchLower)) continue;

            let sel = el.tagName.toLowerCase();
            if (el.id) {
              sel += '#' + el.id;
            } else if (el.className && typeof el.className === 'string') {
              const cls = el.className.trim().split(/\\\\s+/).filter(Boolean);
              if (cls.length > 0) sel += '.' + cls.slice(0, 2).join('.');
            } else if (el.getAttribute('role')) {
              sel += '[role="' + el.getAttribute('role') + '"]';
            }

            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                            style.opacity !== '0' && rect.width > 0 && rect.height > 0;

            alts.push({
              selector: sel,
              visible,
              text: directText.length > 50 ? directText.substring(0, 50) + '...' : directText,
            });
          }

          const vis = alts.filter(a => a.visible);
          const hid = alts.filter(a => !a.visible);
          return [...vis.slice(0, 3), ...hid.slice(0, 2)];
        })()
      `);
      return result || [];
    } catch {
      return [];
    }
  }

  /** Convert selector string to JS querySelector expression, handling :has-text() */
  private getSelectorExpression(selector: string): string {
    if (!selector) throw new Error('Selector is required for this action');
    const m = selector.match(/^(.+?):has-text\(["'](.+?)["']\)(.*)$/);
    if (m) {
      const [, base, text] = m;
      return `(() => {
        for (const el of document.querySelectorAll(${JSON.stringify(base)})) {
          if (el.textContent && el.textContent.includes(${JSON.stringify(text)})) return el;
        }
        return null;
      })()`;
    }
    return `document.querySelector(${JSON.stringify(selector)})`;
  }

  // ─── Tool Schemas ────────────────────────────────────────────

  async listTools(): Promise<ToolSchema[]> {
    return getToolSchemas();
  }

  // ─── Tool Dispatch ───────────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: { rawResult?: boolean } = {}
  ): Promise<any> {
    log(`callTool(${name})`);

    if (!this.ext) {
      return this.error(
        'Extension not connected.\n\n' +
        '**Troubleshooting:**\n' +
        '1. Ensure the SuperSurf extension is loaded in Chrome (`chrome://extensions`)\n' +
        '2. Call the `enable` tool to start the WebSocket server\n' +
        '3. Open the extension popup and verify it shows "Connected"',
        options
      );
    }

    const ctx = this.ctx;

    try {
      switch (name) {
        case 'browser_tabs':            return await onBrowserTabs(ctx, args, options);
        case 'browser_navigate':        return await onNavigate(ctx, args, options);
        case 'browser_interact':        return await onInteract(ctx, args, options);
        case 'browser_snapshot':        return await onSnapshot(ctx, options);
        case 'browser_lookup':          return await onLookup(ctx, args, options);
        case 'browser_extract_content': return await onExtractContent(ctx, args, options);
        case 'browser_get_element_styles': return await onGetElementStyles(ctx, args, options);
        case 'browser_take_screenshot': return await onScreenshot(ctx, args, options);
        case 'browser_evaluate':        return await onEvaluate(ctx, args, options);
        case 'browser_console_messages': return await onConsoleMessages(ctx, args, options);
        case 'browser_fill_form':       return await onFillForm(ctx, args, options);
        case 'browser_drag':            return await onDrag(ctx, args, options);
        case 'browser_window':          return await onWindow(ctx, args, options);
        case 'browser_verify_text_visible':   return await onVerifyTextVisible(ctx, args, options);
        case 'browser_verify_element_visible': return await onVerifyElementVisible(ctx, args, options);
        case 'browser_network_requests': return await onNetworkRequests(ctx, args, options);
        case 'browser_pdf_save':        return await onPdfSave(ctx, args, options);
        case 'browser_handle_dialog':   return await onDialog(ctx, args, options);
        case 'browser_list_extensions': return await onListExtensions(ctx, options);
        case 'browser_reload_extensions': return await onReloadExtensions(ctx, args, options);
        case 'browser_performance_metrics': return await onPerformanceMetrics(ctx, options);
        case 'secure_fill':            return await onSecureFill(ctx, args, options);
        default:                        return this.error(`Unknown tool: ${name}`, options);
      }
    } catch (error: any) {
      log(`Tool error (${name}):`, error.message);
      const msg = error.message || String(error);

      // Detect CDP/debugger attachment failures that indicate extension conflicts
      if (/debugger|attach|detach|target closed|session/i.test(msg) &&
          /another|conflict|denied|cannot|failed/i.test(msg)) {
        return this.error(
          msg + '\n\n' +
          '**Possible extension conflict.** Another extension may be using the Chrome debugger.\n\n' +
          '**Common culprits:** iCloud Passwords, password managers, or other DevTools extensions.\n' +
          'Try disabling other extensions at `chrome://extensions` and retry.',
          options
        );
      }

      return this.error(msg, options);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private formatResult(name: string, result: any, options: { rawResult?: boolean }): any {
    if (options.rawResult) return result;

    // Update connection manager's tab info if result contains it
    if (result && this.connectionManager) {
      if (result.attachedTab) this.connectionManager.setAttachedTab(result.attachedTab);
      if (result.browserName) this.connectionManager.setConnectedBrowserName(result.browserName);
      if (result.stealthMode !== undefined) this.connectionManager.setStealthMode(result.stealthMode);
    }

    const statusHeader = this.connectionManager?.statusHeader() || '';

    // Screenshot image data
    if (result?.data && name === 'browser_take_screenshot') {
      return {
        content: [
          { type: 'text', text: statusHeader + (result.message || 'Screenshot captured') },
          { type: 'image', data: result.data, mimeType: result.mimeType || 'image/jpeg' },
        ],
      };
    }

    const text = typeof result === 'string'
      ? result
      : result?.text || result?.message || JSON.stringify(result, null, 2);

    return { content: [{ type: 'text', text: statusHeader + text }] };
  }

  private error(message: string, options: { rawResult?: boolean }): any {
    if (options.rawResult) return { success: false, error: message };
    return {
      content: [{ type: 'text', text: `### Error\n\n${message}` }],
      isError: true,
    };
  }
}
