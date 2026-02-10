/**
 * BrowserBridge — all browser tool schemas and implementations.
 * Forwards commands to the extension via Transport.
 */

import type { ExtensionServer } from './bridge';
import { createLog } from './logger';
import { experimentRegistry, diffSnapshots, calculateConfidence, formatDiffSection } from './experimental/index';
import fs from 'fs';
import sharp from 'sharp';
import sizeOf from 'image-size';

const log = createLog('[Bridge]');

/** Max pixel dimension for screenshots returned as base64 to the agent.
 *  Images exceeding this in either axis get downscaled via sharp.
 *  Set to 0 to disable auto-downscaling. */
const SCREENSHOT_MAX_DIMENSION = 2000;

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

// Key code mapping for press_key action
const KEY_MAP: Record<string, { key: string; code: string; keyCode: number; text: string }> = {
  Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
  Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9,  text: '\t' },
  Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27, text: '' },
  Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '' },
  Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46, text: '' },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38, text: '' },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40, text: '' },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37, text: '' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, text: '' },
  Space:      { key: ' ',          code: 'Space',      keyCode: 32, text: ' ' },
  Home:       { key: 'Home',       code: 'Home',       keyCode: 36, text: '' },
  End:        { key: 'End',        code: 'End',        keyCode: 35, text: '' },
  PageUp:     { key: 'PageUp',     code: 'PageUp',     keyCode: 33, text: '' },
  PageDown:   { key: 'PageDown',   code: 'PageDown',   keyCode: 34, text: '' },
};

export class BrowserBridge {
  private config: any;
  private ext: ExtensionServer | null;
  private server: any = null;
  private clientInfo: any = {};
  private connectionManager: any = null;

  constructor(config: any, ext: ExtensionServer | null) {
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

  // ─── CDP + Eval Helpers ─────────────────────────────────────

  /** Send a CDP command through the extension's forwardCDPCommand handler */
  private async cdp(method: string, params: any = {}): Promise<any> {
    return await this.ext!.sendCmd('forwardCDPCommand', { method, params });
  }

  /** Evaluate JS expression in page context, return by value */
  private async eval(expression: string, awaitPromise = true): Promise<any> {
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
    const result = await this.eval(`
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

  /** Search for alternative elements when a selector fails.
   *  Extracts text from :has-text() selectors and searches all elements for matches. */
  private async findAlternativeSelectors(selector: string): Promise<any[]> {
    // Extract search text from :has-text() selectors
    const m = selector.match(/:has-text\(["'](.+?)["']\)/);
    if (!m) return [];
    const searchText = m[1];

    try {
      const result = await this.eval(`
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
              const cls = el.className.trim().split(/\\s+/).filter(Boolean);
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
    return [
      // ── Tab Management ──
      {
        name: 'browser_tabs',
        description:
          'List, create, attach, or close browser tabs. Attach to a tab before using other browser tools.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'new', 'attach', 'close'],
              description: 'Action to perform',
            },
            url: { type: 'string', description: 'URL to navigate to (for new action)' },
            index: { type: 'number', description: 'Tab index (for attach/close actions)' },
            activate: {
              type: 'boolean',
              description: 'Bring tab to foreground (default: true for new, false for attach)',
            },
            stealth: { type: 'boolean', description: 'Enable stealth mode to avoid bot detection' },
          },
          required: ['action'],
        },
        annotations: { title: 'Manage tabs', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },

      // ── Navigation ──
      {
        name: 'browser_navigate',
        description: 'Go to a URL, navigate back/forward, or reload the current page.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['url', 'back', 'forward', 'reload', 'test_page'],
              description: 'Navigation action',
            },
            url: { type: 'string', description: 'URL to navigate to (required when action=url)' },
          },
          required: ['action'],
        },
        annotations: { title: 'Navigate', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },

      // ── Interaction ──
      {
        name: 'browser_interact',
        description:
          'Run a sequence of page interactions: click, type, press keys, hover, scroll, wait, select, upload files, or force pseudo-states.',
        inputSchema: {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              description: 'Array of actions to perform in sequence',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'click', 'type', 'clear', 'press_key', 'hover', 'wait',
                      'mouse_move', 'mouse_click', 'scroll_to', 'scroll_by',
                      'scroll_into_view', 'select_option', 'file_upload', 'force_pseudo_state',
                    ],
                    description: 'Type of interaction',
                  },
                  selector: { type: 'string', description: 'CSS selector for the target element' },
                  text: { type: 'string', description: 'Text to type (for type action)' },
                  key: { type: 'string', description: 'Key to press (for press_key action)' },
                  value: { type: 'string', description: 'Option value or text (for select_option)' },
                  pseudoStates: {
                    type: 'array',
                    items: { type: 'string', enum: ['hover', 'active', 'focus', 'visited', 'focus-within'] },
                    description: 'Pseudo-states to force',
                  },
                  files: { type: 'array', items: { type: 'string' }, description: 'File paths (for file_upload)' },
                  x: { type: 'number', description: 'X coordinate in viewport pixels' },
                  y: { type: 'number', description: 'Y coordinate in viewport pixels' },
                  button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
                  clickCount: { type: 'number', description: 'Number of clicks (default: 1)' },
                  timeout: { type: 'number', description: 'Timeout in ms (for wait action)' },
                },
                required: ['type'],
              },
            },
            onError: {
              type: 'string',
              enum: ['stop', 'ignore'],
              description: 'What to do on error: stop or ignore (default: stop)',
            },
          },
          required: ['actions'],
        },
        annotations: { title: 'Interact with page', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Content: Snapshot ──
      {
        name: 'browser_snapshot',
        description: 'Return the page\'s accessibility tree as a structured DOM snapshot.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { title: 'DOM snapshot', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Content: Lookup ──
      {
        name: 'browser_lookup',
        description:
          'Find elements by visible text and return their selectors. Use this to locate the right target before clicking.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to search for in elements' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['text'],
        },
        annotations: { title: 'Lookup elements', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Content: Extract ──
      {
        name: 'browser_extract_content',
        description:
          'Pull page content as clean markdown. Auto-detects the main article, or target a specific selector. Supports pagination via offset.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['auto', 'full', 'selector'],
              description: 'Extraction mode (default: auto)',
            },
            selector: { type: 'string', description: 'CSS selector (mode=selector only)' },
            max_lines: { type: 'number', description: 'Max lines (default: 500)' },
            offset: { type: 'number', description: 'Line offset for pagination (default: 0)' },
          },
        },
        annotations: { title: 'Extract content', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── CSS Styles ──
      {
        name: 'browser_get_element_styles',
        description:
          'Inspect computed and matched CSS rules for an element, like the DevTools Styles panel. Supports pseudo-state forcing.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the element' },
            property: { type: 'string', description: 'Optional: filter to specific CSS property' },
            pseudoState: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['hover', 'active', 'focus', 'visited', 'focus-within', 'focus-visible', 'target'],
              },
              description: 'Optional: force pseudo-states on element',
            },
          },
          required: ['selector'],
        },
        annotations: { title: 'Get element styles', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Screenshot ──
      {
        name: 'browser_take_screenshot',
        description:
          'Capture a screenshot. Defaults to JPEG quality 80, viewport-only. Options: full page, element crop, coordinate clip, clickable highlights.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: jpeg)' },
            fullPage: { type: 'boolean', description: 'Full page (default: false)' },
            quality: { type: 'number', description: 'JPEG quality 0-100 (default: 80)' },
            path: { type: 'string', description: 'File path to save (returns data if omitted)' },
            highlightClickables: { type: 'boolean', description: 'Highlight clickable elements (default: false)' },
            deviceScale: { type: 'number', description: 'Scale factor: 1=CSS pixels, 0=native resolution' },
            selector: { type: 'string', description: 'CSS selector for partial screenshot' },
            padding: { type: 'number', description: 'Padding around selector (default: 0)' },
            clip_x: { type: 'number', description: 'Clip X coordinate' },
            clip_y: { type: 'number', description: 'Clip Y coordinate' },
            clip_width: { type: 'number', description: 'Clip width' },
            clip_height: { type: 'number', description: 'Clip height' },
            clip_coordinateSystem: {
              type: 'string',
              enum: ['viewport', 'page'],
              description: 'Coordinate system for clip (default: viewport)',
            },
          },
        },
        annotations: { title: 'Take screenshot', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── JavaScript ──
      {
        name: 'browser_evaluate',
        description: 'Run JavaScript in the page context and return the result.',
        inputSchema: {
          type: 'object',
          properties: {
            function: { type: 'string', description: 'JavaScript function to execute' },
            expression: { type: 'string', description: 'JavaScript expression to evaluate' },
          },
        },
        annotations: { title: 'Evaluate JS', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Console ──
      {
        name: 'browser_console_messages',
        description: 'Read console output from the page. Filter by level, text, or source URL.',
        inputSchema: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'debug'], description: 'Filter by level' },
            text: { type: 'string', description: 'Filter by text (case-insensitive)' },
            url: { type: 'string', description: 'Filter by source URL' },
            limit: { type: 'number', description: 'Max messages (default: 50)' },
            offset: { type: 'number', description: 'Skip messages (default: 0)' },
          },
        },
        annotations: { title: 'Console messages', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Forms ──
      {
        name: 'browser_fill_form',
        description: 'Set values on multiple form fields at once.',
        inputSchema: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
          },
          required: ['fields'],
        },
        annotations: { title: 'Fill form', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Drag ──
      {
        name: 'browser_drag',
        description: 'Drag one element to another using simulated mouse events.',
        inputSchema: {
          type: 'object',
          properties: {
            fromSelector: { type: 'string', description: 'Source element' },
            toSelector: { type: 'string', description: 'Target element' },
          },
          required: ['fromSelector', 'toSelector'],
        },
        annotations: { title: 'Drag element', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Window ──
      {
        name: 'browser_window',
        description: 'Resize, close, minimize, or maximize the browser window.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['resize', 'close', 'minimize', 'maximize'], description: 'Window action' },
            width: { type: 'number', description: 'Width (for resize)' },
            height: { type: 'number', description: 'Height (for resize)' },
          },
          required: ['action'],
        },
        annotations: { title: 'Manage window', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Verification ──
      {
        name: 'browser_verify_text_visible',
        description: 'Assert that specific text is visible on the page.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to find' } },
          required: ['text'],
        },
        annotations: { title: 'Verify text visible', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'browser_verify_element_visible',
        description: 'Assert that an element matching the selector is visible on the page.',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
        annotations: { title: 'Verify element visible', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Network ──
      {
        name: 'browser_network_requests',
        description:
          'Monitor network traffic: list captured requests, inspect details, replay a request, or clear the log. Filter by URL, method, status, or resource type.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'details', 'replay', 'clear'],
              description: 'Action (default: list)',
            },
            urlPattern: { type: 'string', description: 'Filter by URL substring' },
            method: { type: 'string', description: 'Filter by HTTP method' },
            status: { type: 'number', description: 'Filter by status code' },
            resourceType: { type: 'string', description: 'Filter by resource type' },
            limit: { type: 'number', description: 'Max results (default: 20)' },
            offset: { type: 'number', description: 'Skip for pagination (default: 0)' },
            requestId: { type: 'string', description: 'Request ID (for details/replay)' },
            jsonPath: { type: 'string', description: 'JSONPath query for JSON responses' },
          },
        },
        annotations: { title: 'Network requests', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── PDF ──
      {
        name: 'browser_pdf_save',
        description: 'Export the current page as a PDF file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path for PDF output' } },
        },
        annotations: { title: 'Save as PDF', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Dialog ──
      {
        name: 'browser_handle_dialog',
        description: 'Accept or dismiss a browser dialog (alert, confirm, prompt).',
        inputSchema: {
          type: 'object',
          properties: {
            accept: { type: 'boolean', description: 'Accept or dismiss' },
            text: { type: 'string', description: 'Text for prompt dialog' },
          },
        },
        annotations: { title: 'Handle dialog', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Extensions ──
      {
        name: 'browser_list_extensions',
        description: 'List all installed Chrome extensions.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { title: 'List extensions', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'browser_reload_extensions',
        description: 'Reload an unpacked (developer) extension by name.',
        inputSchema: {
          type: 'object',
          properties: {
            extensionName: { type: 'string', description: 'Extension name to reload (must be unpacked)' },
          },
        },
        annotations: { title: 'Reload extensions', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },

      // ── Performance ──
      {
        name: 'browser_performance_metrics',
        description: 'Collect Web Vitals and CDP performance metrics: FCP, LCP, CLS, TTFB, and more.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { title: 'Performance metrics', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },

      // ── Secure Fill ──
      {
        name: 'secure_fill',
        description:
          'Fill a form field with a server-side credential from an environment variable. The value never reaches the agent. Types char-by-char with randomized delays.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the input field' },
            credential_env: {
              type: 'string',
              description: 'Name of the environment variable holding the credential (e.g., "MY_PASSWORD")',
            },
          },
          required: ['selector', 'credential_env'],
        },
        annotations: { title: 'Secure credential fill', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
    ];
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

    try {
      switch (name) {
        case 'browser_tabs':
          return await this.onBrowserTabs(args, options);
        case 'browser_navigate':
          return await this.onNavigate(args, options);
        case 'browser_interact':
          return await this.onInteract(args, options);
        case 'browser_snapshot':
          return await this.onSnapshot(options);
        case 'browser_lookup':
          return await this.onLookup(args, options);
        case 'browser_extract_content':
          return await this.onExtractContent(args, options);
        case 'browser_get_element_styles':
          return await this.onGetElementStyles(args, options);
        case 'browser_take_screenshot':
          return await this.onScreenshot(args, options);
        case 'browser_evaluate':
          return await this.onEvaluate(args, options);
        case 'browser_console_messages':
          return await this.onConsoleMessages(args, options);
        case 'browser_fill_form':
          return await this.onFillForm(args, options);
        case 'browser_drag':
          return await this.onDrag(args, options);
        case 'browser_window':
          return await this.onWindow(args, options);
        case 'browser_verify_text_visible':
          return await this.onVerifyTextVisible(args, options);
        case 'browser_verify_element_visible':
          return await this.onVerifyElementVisible(args, options);
        case 'browser_network_requests':
          return await this.onNetworkRequests(args, options);
        case 'browser_pdf_save':
          return await this.onPdfSave(args, options);
        case 'browser_handle_dialog':
          return await this.onDialog(args, options);
        case 'browser_list_extensions':
          return await this.onListExtensions(options);
        case 'browser_reload_extensions':
          return await this.onReloadExtensions(args, options);
        case 'browser_performance_metrics':
          return await this.onPerformanceMetrics(options);
        case 'secure_fill':
          return await this.onSecureFill(args, options);
        default:
          return this.error(`Unknown tool: ${name}`, options);
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

  // ─── Tab Management ─────────────────────────────────────────

  private async onBrowserTabs(args: any, options: any): Promise<any> {
    const action = args.action as string;
    let result: any;

    switch (action) {
      case 'list':
        result = await this.ext!.sendCmd('getTabs', {});
        break;
      case 'new':
        result = await this.ext!.sendCmd('createTab', {
          url: args.url,
          activate: args.activate !== false,
        });
        break;
      case 'attach':
        result = await this.ext!.sendCmd('selectTab', {
          index: args.index,
          stealth: args.stealth,
        });
        break;
      case 'close':
        result = await this.ext!.sendCmd('closeTab', args.index);
        break;
      default:
        return this.error(`Unknown tab action: ${action}`, options);
    }

    if (result && this.connectionManager) {
      if (action === 'new' || action === 'attach') {
        this.connectionManager.setAttachedTab(result);
        if (args.stealth) this.connectionManager.setStealthMode(true);
      } else if (action === 'close') {
        this.connectionManager.clearAttachedTab();
      }
    }

    return this.formatResult('browser_tabs', result, options);
  }

  // ─── Navigation ─────────────────────────────────────────────

  private async onNavigate(args: any, options: any): Promise<any> {
    const action = args.action as string;
    let result: any;

    switch (action) {
      case 'url':
        result = await this.ext!.sendCmd('navigate', { action: 'url', url: args.url });
        if (this.connectionManager?.attachedTab) {
          this.connectionManager.attachedTab.url = args.url;
        }
        // === EXPERIMENTAL: smart waiting ===
        if (experimentRegistry.isEnabled('smart_waiting')) {
          try { await this.ext!.sendCmd('waitForReady', { timeout: 10000 }); }
          catch { /* fall through — page may already be ready */ }
        }
        break;
      case 'back':
        await this.eval('window.history.back()');
        // === EXPERIMENTAL: smart waiting ===
        if (experimentRegistry.isEnabled('smart_waiting')) {
          try { await this.ext!.sendCmd('waitForReady', { timeout: 10000 }); }
          catch { await this.sleep(1500); }
        } else {
          await this.sleep(1500);
        }
        result = { success: true, action: 'back', url: await this.eval('window.location.href') };
        break;
      case 'forward':
        await this.eval('window.history.forward()');
        // === EXPERIMENTAL: smart waiting ===
        if (experimentRegistry.isEnabled('smart_waiting')) {
          try { await this.ext!.sendCmd('waitForReady', { timeout: 10000 }); }
          catch { await this.sleep(1500); }
        } else {
          await this.sleep(1500);
        }
        result = { success: true, action: 'forward', url: await this.eval('window.location.href') };
        break;
      case 'reload':
        result = await this.ext!.sendCmd('navigate', { action: 'reload' });
        // === EXPERIMENTAL: smart waiting ===
        if (experimentRegistry.isEnabled('smart_waiting')) {
          try { await this.ext!.sendCmd('waitForReady', { timeout: 10000 }); }
          catch { /* fall through */ }
        }
        break;
      default:
        return this.error(`Unknown navigate action: ${action}`, options);
    }

    return this.formatResult('browser_navigate', result, options);
  }

  // ─── Interact ───────────────────────────────────────────────

  private async onInteract(args: any, options: any): Promise<any> {
    const actions = args.actions as any[];
    const onError = (args.onError as string) || 'stop';
    const results: string[] = [];

    // === EXPERIMENTAL: page diffing — capture before state ===
    let beforeState: any = null;
    if (experimentRegistry.isEnabled('page_diffing')) {
      try { beforeState = await this.ext!.sendCmd('capturePageState', {}); }
      catch { /* silently skip — extension may not support it yet */ }
    }

    for (const action of actions) {
      try {
        const msg = await this.executeAction(action);
        results.push(`✓ ${action.type}: ${msg}`);
      } catch (error: any) {
        results.push(`✗ ${action.type}: ${error.message}`);
        if (onError === 'stop') break;
      }
    }

    // === EXPERIMENTAL: page diffing — capture after state and diff ===
    let diffSection = '';
    if (beforeState) {
      try {
        const afterState = await this.ext!.sendCmd('capturePageState', {});
        const confidence = calculateConfidence(afterState);
        if (confidence >= 0.7) {
          diffSection = formatDiffSection(diffSnapshots(beforeState, afterState), confidence);
        } else {
          diffSection = `\n\n---\n**Page diff:** confidence below threshold (${Math.round(confidence * 100)}%) — full re-read recommended`;
        }
      } catch { /* silently skip */ }
    }

    if (options.rawResult) {
      return { success: !results.some(r => r.startsWith('✗')), actions: results };
    }

    return {
      content: [{ type: 'text', text: results.join('\n') + diffSection }],
      isError: results.some(r => r.startsWith('✗')),
    };
  }

  private async executeAction(action: any): Promise<string> {
    switch (action.type) {
      case 'click': {
        const { x, y } = await this.getElementCenter(action.selector);
        const button = action.button || 'left';
        const clickCount = action.clickCount || 1;

        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await this.cdp('Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button, clickCount, buttons: 1,
        });
        await this.cdp('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button, clickCount,
        });

        return `Clicked ${action.selector} at (${x}, ${y})`;
      }

      case 'type': {
        const expr = this.getSelectorExpression(action.selector);
        await this.eval(`(() => { const el = ${expr}; if (el) el.focus(); })()`);

        for (const char of action.text) {
          await this.cdp('Input.dispatchKeyEvent', { type: 'char', text: char });
        }

        const finalValue = await this.eval(`(() => { const el = ${expr}; return el?.value; })()`);
        return `Typed "${action.text}" into ${action.selector} (value: "${finalValue ?? 'N/A'}")`;
      }

      case 'clear': {
        const expr = this.getSelectorExpression(action.selector);
        await this.eval(`
          (() => {
            const el = ${expr};
            if (!el) throw new Error('Element not found');
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `);
        return `Cleared ${action.selector}`;
      }

      case 'press_key': {
        const key = action.key;
        const mapped = KEY_MAP[key];
        const keyCode = mapped?.keyCode || 0;
        const text = mapped?.text || (key.length === 1 ? key : '');

        const params = {
          key, code: mapped?.code || key,
          windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
          text, unmodifiedText: text,
        };

        await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
        return `Pressed ${key}`;
      }

      case 'hover': {
        const { x, y } = await this.getElementCenter(action.selector);
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        return `Hovered ${action.selector} at (${x}, ${y})`;
      }

      case 'wait': {
        const timeout = action.timeout || 30000;
        if (action.selector) {
          await this.eval(`
            new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Timeout waiting for element')), ${timeout});
              const check = () => {
                if (document.querySelector(${JSON.stringify(action.selector)})) {
                  clearTimeout(timeout);
                  resolve(true);
                } else {
                  setTimeout(check, 100);
                }
              };
              check();
            })
          `);
          return `Element appeared: ${action.selector}`;
        } else {
          await this.sleep(timeout);
          return `Waited ${timeout}ms`;
        }
      }

      case 'mouse_move': {
        await this.cdp('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: action.x, y: action.y,
        });
        return `Moved to (${action.x}, ${action.y})`;
      }

      case 'mouse_click': {
        const button = action.button || 'left';
        const clickCount = action.clickCount || 1;
        await this.cdp('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: action.x, y: action.y, button, clickCount, buttons: 1,
        });
        await this.cdp('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: action.x, y: action.y, button, clickCount,
        });
        return `Clicked at (${action.x}, ${action.y})`;
      }

      case 'scroll_to': {
        if (action.selector) {
          const expr = this.getSelectorExpression(action.selector);
          await this.eval(`(() => { const el = ${expr}; if (el) el.scrollTo(${action.x || 0}, ${action.y || 0}); })()`);
          return `Scrolled ${action.selector} to (${action.x || 0}, ${action.y || 0})`;
        }
        await this.eval(`window.scrollTo(${action.x || 0}, ${action.y || 0})`);
        return `Scrolled window to (${action.x || 0}, ${action.y || 0})`;
      }

      case 'scroll_by': {
        if (action.selector) {
          const expr = this.getSelectorExpression(action.selector);
          await this.eval(`(() => { const el = ${expr}; if (el) el.scrollBy(${action.x || 0}, ${action.y || 0}); })()`);
          return `Scrolled ${action.selector} by (${action.x || 0}, ${action.y || 0})`;
        }
        await this.eval(`window.scrollBy(${action.x || 0}, ${action.y || 0})`);
        return `Scrolled window by (${action.x || 0}, ${action.y || 0})`;
      }

      case 'scroll_into_view': {
        const expr = this.getSelectorExpression(action.selector);
        await this.eval(`
          (() => {
            const el = ${expr};
            if (!el) throw new Error('Element not found');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          })()
        `);
        return `Scrolled ${action.selector} into view`;
      }

      case 'select_option': {
        const expr = this.getSelectorExpression(action.selector);
        const result = await this.eval(`
          (() => {
            const el = ${expr};
            if (!el || el.tagName !== 'SELECT') throw new Error('Not a <select> element');
            const options = Array.from(el.options);
            const target = ${JSON.stringify(action.value)};

            // Match by value first, then by text
            let opt = options.find(o => o.value === target);
            if (!opt) opt = options.find(o => o.textContent?.trim().toLowerCase() === target.toLowerCase());
            if (!opt) throw new Error('Option not found: ' + target);

            // Use native setter to bypass frameworks
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, opt.value);
            else el.value = opt.value;

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return opt.textContent?.trim() || opt.value;
          })()
        `);
        return `Selected "${result}" in ${action.selector}`;
      }

      case 'file_upload': {
        // Get the element's backendNodeId
        const evalResult = await this.cdp('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(action.selector)})`,
          returnByValue: false,
        });
        if (!evalResult.result?.objectId) throw new Error(`Element not found: ${action.selector}`);

        const nodeResult = await this.cdp('DOM.describeNode', { objectId: evalResult.result.objectId });
        await this.cdp('DOM.setFileInputFiles', {
          files: action.files,
          backendNodeId: nodeResult.node.backendNodeId,
        });
        return `Uploaded ${action.files.length} file(s) to ${action.selector}`;
      }

      case 'force_pseudo_state': {
        const pseudoStates = action.pseudoStates || [];
        const doc = await this.cdp('DOM.getDocument', {});
        const nodeResult = await this.cdp('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: action.selector,
        });
        if (!nodeResult.nodeId) throw new Error(`Element not found: ${action.selector}`);

        await this.cdp('CSS.forcePseudoState', {
          nodeId: nodeResult.nodeId,
          forcedPseudoClasses: pseudoStates,
        });
        return `Forced pseudo-states [${pseudoStates.join(', ')}] on ${action.selector}`;
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  // ─── Snapshot ───────────────────────────────────────────────

  private async onSnapshot(options: any): Promise<any> {
    const result = await this.ext!.sendCmd('snapshot', {});

    if (options.rawResult) return result;

    // Format accessibility tree nodes
    const nodes = result?.nodes || [];
    if (nodes.length === 0) {
      return { content: [{ type: 'text', text: 'Empty accessibility tree' }] };
    }

    let output = '';
    for (const node of nodes) {
      const role = node.role?.value || '';
      const name = node.name?.value || '';
      if (!role || role === 'none' || role === 'generic') continue;
      const indent = '  '.repeat(node.depth || 0);
      output += `${indent}[${role}] ${name}\n`;
    }

    return { content: [{ type: 'text', text: output || 'No meaningful accessibility nodes' }] };
  }

  // ─── Lookup ─────────────────────────────────────────────────

  private async onLookup(args: any, options: any): Promise<any> {
    const searchText = args.text as string;
    const limit = (args.limit as number) || 10;

    const data = await this.eval(`
      (() => {
        const searchText = ${JSON.stringify(searchText)};
        const searchLower = searchText.trim().toLowerCase();
        const matches = [];

        for (const el of document.querySelectorAll('*')) {
          let directText = '';
          for (const n of el.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) directText += n.textContent;
          }
          directText = directText.trim();
          if (!directText.toLowerCase().includes(searchLower)) continue;

          let sel = el.tagName.toLowerCase();
          if (el.id) sel += '#' + el.id;
          else if (el.className && typeof el.className === 'string') {
            const cls = el.className.trim().split(/\\s+/).filter(c => c).slice(0, 2);
            if (cls.length) sel += '.' + cls.join('.');
          }

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                          style.opacity !== '0' && rect.width > 0 && rect.height > 0;

          matches.push({
            selector: sel, visible,
            text: directText.length > 100 ? directText.substring(0, 100) + '...' : directText,
            tag: el.tagName.toLowerCase(),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          });
        }

        const visible = matches.filter(m => m.visible);
        const hidden = matches.filter(m => !m.visible);
        return { matches: [...visible, ...hidden].slice(0, ${limit}), total: matches.length };
      })()
    `);

    if (options.rawResult) return data;

    const matches = data?.matches || [];
    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No elements found with text: "${searchText}"` }] };
    }

    let output = `### Found ${data.total} element(s) with text: "${searchText}"\n\n`;
    matches.forEach((m: any, i: number) => {
      const vis = m.visible ? '✓' : '✗ hidden';
      output += `${i + 1}. **${m.selector}** [${m.tag}] ${vis}\n`;
      output += `   Text: "${m.text}"\n   Position: (${m.x}, ${m.y})\n\n`;
    });

    return { content: [{ type: 'text', text: output }] };
  }

  // ─── Extract Content ────────────────────────────────────────

  private async onExtractContent(args: any, options: any): Promise<any> {
    const mode = (args.mode as string) || 'auto';
    const maxLines = (args.max_lines as number) || 500;
    const offset = (args.offset as number) || 0;
    const selector = args.selector as string | undefined;

    const content = await this.eval(`
      (() => {
        function getRoot() {
          ${mode === 'selector' && selector
            ? `return document.querySelector(${JSON.stringify(selector)});`
            : mode === 'full'
            ? `return document.body;`
            : `// Auto-detect main content
               const candidates = ['article', 'main', '[role="main"]', '.content', '.post', '#content'];
               for (const s of candidates) {
                 const el = document.querySelector(s);
                 if (el && el.textContent.trim().length > 100) return el;
               }
               return document.body;`
          }
        }

        function toMarkdown(el) {
          if (!el) return '';
          const lines = [];

          function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent.trim();
              if (text) lines.push(text);
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();

            if (['script', 'style', 'noscript', 'svg'].includes(tag)) return;
            if (window.getComputedStyle(node).display === 'none') return;

            if (/^h[1-6]$/.test(tag)) {
              const level = parseInt(tag[1]);
              lines.push('#'.repeat(level) + ' ' + node.textContent.trim());
              return;
            }
            if (tag === 'p') { lines.push(node.textContent.trim()); lines.push(''); return; }
            if (tag === 'br') { lines.push(''); return; }
            if (tag === 'a') {
              lines.push('[' + node.textContent.trim() + '](' + (node.href || '') + ')');
              return;
            }
            if (tag === 'img') {
              lines.push('![' + (node.alt || '') + '](' + (node.src || '') + ')');
              return;
            }
            if (tag === 'li') { lines.push('- ' + node.textContent.trim()); return; }
            if (tag === 'code' && node.parentElement?.tagName !== 'PRE') {
              lines.push('\\u0060' + node.textContent + '\\u0060');
              return;
            }
            if (tag === 'pre') {
              lines.push('\\u0060\\u0060\\u0060');
              lines.push(node.textContent);
              lines.push('\\u0060\\u0060\\u0060');
              return;
            }

            for (const child of node.childNodes) walk(child);
          }

          walk(el);
          return lines;
        }

        const root = getRoot();
        if (!root) return { error: 'No content element found' };
        return { lines: toMarkdown(root) };
      })()
    `);

    if (content?.error) return this.error(content.error, options);

    const allLines = content?.lines || [];
    const slice = allLines.slice(offset, offset + maxLines);
    const truncated = allLines.length > offset + maxLines;

    if (options.rawResult) {
      return { lines: slice, total: allLines.length, offset, truncated };
    }

    let text = slice.join('\n');
    if (truncated) {
      text += `\n\n_...truncated (showing ${slice.length} of ${allLines.length} lines, offset=${offset})_`;
    }

    return { content: [{ type: 'text', text }] };
  }

  // ─── Element Styles ─────────────────────────────────────────

  /** Strip content hashes from CSS filenames: `frontend-abc123.css` → `frontend.css` */
  private cleanCSSFilename(href: string): string {
    const parts = href.split('/');
    let filename = parts[parts.length - 1].split('?')[0];
    filename = filename.replace(/-[a-f0-9]{6,16}\./, '.');
    return filename;
  }

  private async onGetElementStyles(args: any, options: any): Promise<any> {
    const selector = args.selector as string;
    const propertyFilter = args.property ? (args.property as string).toLowerCase() : null;
    let pseudoState = args.pseudoState || [];
    if (typeof pseudoState === 'string') {
      try { pseudoState = JSON.parse(pseudoState); } catch { pseudoState = [pseudoState]; }
    }

    // Resolve nodeId from selector
    const doc = await this.cdp('DOM.getDocument', {});
    const queryResult = await this.cdp('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });
    if (!queryResult.nodeId) throw new Error(`Element not found: ${selector}`);

    // Force pseudo states if requested
    if (pseudoState.length > 0) {
      await this.cdp('CSS.forcePseudoState', {
        nodeId: queryResult.nodeId,
        forcedPseudoClasses: pseudoState,
      });
    }

    // Get matched styles
    const styles = await this.cdp('CSS.getMatchedStylesForNode', { nodeId: queryResult.nodeId });

    // Collect external CSS file list for source heuristic
    const externalCSSFiles: string[] = await this.eval(`
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => l.href).filter(Boolean)
    `) || [];

    const matchedRules = styles.matchedCSSRules || [];
    const inlineStyle = styles.inlineStyle;

    // Collect properties with source tracking
    const propMap = new Map<string, any[]>();

    for (const ruleMatch of matchedRules) {
      const rule = ruleMatch.rule;
      if (!rule?.style) continue;

      const origin = rule.origin || 'regular';
      const selectorText = rule.selectorList?.selectors?.map((s: any) => s.text).join(', ') || '';

      // Resolve source with file + line number
      let source: string;
      if (origin === 'user-agent') {
        source = 'browser default';
      } else if (rule.styleSheetId) {
        const lineNum = rule.style.range ? rule.style.range.startLine + 1 : '?';
        let filename: string | null = null;
        if (externalCSSFiles.length >= 1) {
          filename = this.cleanCSSFilename(externalCSSFiles[0]);
        }
        source = filename ? `${filename}:${lineNum}` : `stylesheet:${lineNum}`;
      } else {
        source = origin || 'stylesheet';
      }

      for (const prop of rule.style.cssProperties || []) {
        const name = prop.name?.toLowerCase();
        if (!name || !prop.value?.trim()) continue;
        if (propertyFilter && name !== propertyFilter) continue;

        if (!propMap.has(name)) propMap.set(name, []);
        propMap.get(name)!.push({
          value: prop.value,
          source,
          selector: selectorText,
          important: prop.important || false,
          disabled: prop.disabled || false,
        });
      }
    }

    if (inlineStyle?.cssProperties) {
      for (const prop of inlineStyle.cssProperties) {
        const name = prop.name?.toLowerCase();
        if (!name || !prop.value?.trim()) continue;
        if (propertyFilter && name !== propertyFilter) continue;

        if (!propMap.has(name)) propMap.set(name, []);
        propMap.get(name)!.push({
          value: prop.value,
          source: 'inline',
          selector: 'element.style',
          important: prop.important || false,
          disabled: prop.disabled || false,
        });
      }
    }

    // Mark computed duplicates: CDP reports both source and computed values from the same rule
    propMap.forEach((values) => {
      const sourceGroups = new Map<string, number[]>();
      values.forEach((decl: any, idx: number) => {
        const key = `${decl.source}|${decl.selector}|${decl.important}`;
        if (!sourceGroups.has(key)) sourceGroups.set(key, []);
        sourceGroups.get(key)!.push(idx);
      });
      sourceGroups.forEach((indices) => {
        if (indices.length > 1) {
          // Last entry from the same source is the computed value
          const srcVal = values[indices[0]].value;
          const compVal = values[indices[indices.length - 1]].value;
          if (srcVal !== compVal) {
            values[indices[indices.length - 1]].computed = true;
          }
        }
      });
    });

    // Clean up pseudo states
    if (pseudoState.length > 0) {
      await this.cdp('CSS.forcePseudoState', {
        nodeId: queryResult.nodeId,
        forcedPseudoClasses: [],
      }).catch(() => {});
    }

    if (options.rawResult) {
      const properties: Record<string, any[]> = {};
      propMap.forEach((v, k) => { properties[k] = v; });
      return { success: true, selector, propertyCount: propMap.size, properties };
    }

    let output = `### Element Styles: \`${selector}\`\n\n`;

    if (pseudoState.length > 0) {
      output += `**Forced pseudo-state:** \`${pseudoState.map((s: string) => `:${s}`).join(', ')}\`\n\n`;
    }

    if (propMap.size === 0) {
      output += propertyFilter
        ? `No CSS property \`${propertyFilter}\` found for this element.\n`
        : 'No CSS styles found.\n';
      return { content: [{ type: 'text', text: output }] };
    }

    output += `Found ${propMap.size} CSS ${propMap.size === 1 ? 'property' : 'properties'}:\n\n`;
    const sorted = Array.from(propMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, values] of sorted) {
      output += `\n${name}:\n`;

      // Determine which value is actually applied (last non-computed wins)
      let appliedIndex = values.length - 1;
      for (let i = values.length - 1; i >= 0; i--) {
        if (!values[i].computed) { appliedIndex = i; break; }
      }

      values.forEach((decl: any, idx: number) => {
        const imp = decl.important ? ' !important' : '';
        const disabled = decl.disabled ? ' [disabled]' : '';
        const markers: string[] = [];

        if (decl.computed) markers.push('[computed]');
        const isApplied = idx === appliedIndex;
        if (isApplied && !decl.important) markers.push('[applied]');
        if (!decl.important && !isApplied && !decl.computed) markers.push('[overridden]');

        const markerStr = markers.length > 0 ? ' ' + markers.join(' ') : '';
        output += `  ${decl.value}${imp}${disabled}${markerStr}\n`;
        output += `    ${decl.source}`;
        if (decl.selector && decl.selector !== 'element.style') output += ` — ${decl.selector}`;
        output += '\n';
      });
    }

    return { content: [{ type: 'text', text: output }] };
  }

  // ─── Screenshot ─────────────────────────────────────────────

  private async onScreenshot(args: any, options: any): Promise<any> {
    const filePath = args.path as string | undefined;

    // Build capture params
    const captureParams: any = { format: args.type || 'jpeg' };
    if (args.quality) captureParams.quality = args.quality;
    if (args.clip_x !== undefined) {
      captureParams.clip = {
        x: args.clip_x, y: args.clip_y,
        width: args.clip_width, height: args.clip_height,
        scale: 1,
      };
    }

    // Highlight clickable elements if requested
    if (args.highlightClickables) {
      await this.eval(`
        (() => {
          const clickables = document.querySelectorAll('a, button, input, select, textarea, [onclick], [role="button"]');
          clickables.forEach(el => {
            el.style.outline = '2px solid #00ff00';
            el.style.outlineOffset = '1px';
          });
        })()
      `);
      await this.sleep(100);
    }

    const result = await this.ext!.sendCmd('screenshot', captureParams, 60000);

    // Remove highlights
    if (args.highlightClickables) {
      await this.eval(`
        (() => {
          const clickables = document.querySelectorAll('a, button, input, select, textarea, [onclick], [role="button"]');
          clickables.forEach(el => {
            el.style.outline = '';
            el.style.outlineOffset = '';
          });
        })()
      `).catch(() => {});
    }

    if (!result?.data) {
      return this.formatResult('browser_take_screenshot', result, options);
    }

    let buffer = Buffer.from(result.data, 'base64');
    const format = (args.type as string) || 'jpeg';

    // Save to file (no downscaling — file saves keep original resolution)
    if (filePath) {
      fs.writeFileSync(filePath, buffer);
      if (options.rawResult) return { success: true, path: filePath, size: buffer.length };
      return {
        content: [{ type: 'text', text: `Screenshot saved to ${filePath} (${buffer.length} bytes)` }],
      };
    }

    // Auto-downscale for base64 returns to prevent API token blowup
    if (SCREENSHOT_MAX_DIMENSION > 0) {
      try {
        const dims = sizeOf(buffer);
        if (dims.width && dims.height &&
            (dims.width > SCREENSHOT_MAX_DIMENSION || dims.height > SCREENSHOT_MAX_DIMENSION)) {
          const scale = Math.min(
            SCREENSHOT_MAX_DIMENSION / dims.width,
            SCREENSHOT_MAX_DIMENSION / dims.height
          );
          const targetW = Math.round(dims.width * scale);
          const targetH = Math.round(dims.height * scale);

          buffer = Buffer.from(await sharp(buffer)
            .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
            .toFormat(format === 'png' ? 'png' : 'jpeg', {
              quality: format === 'jpeg' ? ((args.quality as number) || 80) : undefined,
            })
            .toBuffer());

          log(`Screenshot downscaled from ${dims.width}x${dims.height} to ${targetW}x${targetH}`);
        }
      } catch (e: any) {
        log('Screenshot downscale failed, returning original:', e.message);
      }
    }

    const b64 = buffer.toString('base64');
    if (options.rawResult) return { data: b64, mimeType: result.mimeType || `image/${format}` };
    return {
      content: [
        { type: 'text', text: 'Screenshot captured' },
        { type: 'image', data: b64, mimeType: result.mimeType || `image/${format}` },
      ],
    };
  }

  // ─── Evaluate ───────────────────────────────────────────────

  private async onEvaluate(args: any, options: any): Promise<any> {
    const code = (args.function || args.expression || '') as string;
    const result = await this.ext!.sendCmd('evaluate', {
      function: args.function,
      expression: args.expression,
    });

    if (options.rawResult) return result;
    const text = result === undefined ? 'undefined'
      : result === null ? 'null'
      : typeof result === 'string' ? result
      : JSON.stringify(result, null, 2);
    return {
      content: [{ type: 'text', text }],
    };
  }

  // ─── Console Messages ──────────────────────────────────────

  private async onConsoleMessages(args: any, options: any): Promise<any> {
    const result = await this.ext!.sendCmd('consoleMessages', {});
    let messages = result?.messages || [];

    // Apply filters
    if (args.level) messages = messages.filter((m: any) => m.level === args.level);
    if (args.text) {
      const textLower = (args.text as string).toLowerCase();
      messages = messages.filter((m: any) => m.text?.toLowerCase().includes(textLower));
    }
    if (args.url) {
      messages = messages.filter((m: any) => m.url?.includes(args.url));
    }

    // Paginate
    const limit = (args.limit as number) || 50;
    const offset = (args.offset as number) || 0;
    messages = messages.slice(offset, offset + limit);

    if (options.rawResult) return { messages, total: result?.messages?.length || 0 };

    if (messages.length === 0) {
      return { content: [{ type: 'text', text: 'No console messages' }] };
    }

    const text = messages.map((m: any) =>
      `[${m.level || 'log'}] ${m.text || ''}`
    ).join('\n');

    return { content: [{ type: 'text', text }] };
  }

  // ─── Fill Form ──────────────────────────────────────────────

  private async onFillForm(args: any, options: any): Promise<any> {
    const fields = args.fields as any[];
    const results: string[] = [];

    for (const field of fields) {
      const expr = this.getSelectorExpression(field.selector);
      await this.eval(`
        (() => {
          const el = ${expr};
          if (!el) throw new Error('Element not found: ${field.selector}');
          const tag = el.tagName;
          const type = el.type;

          if (type === 'checkbox' || type === 'radio') {
            el.checked = ${JSON.stringify(field.value)} === 'true' || ${JSON.stringify(field.value)} === true;
          } else if (tag === 'SELECT') {
            const options = Array.from(el.options);
            const target = ${JSON.stringify(field.value)};
            if (el.multiple) {
              // Multi-select: value can be comma-separated
              const targets = target.split(',').map(t => t.trim());
              for (const opt of options) {
                opt.selected = targets.includes(opt.value) || targets.includes(opt.textContent?.trim());
              }
            } else {
              let opt = options.find(o => o.value === target);
              if (!opt) opt = options.find(o => o.textContent?.trim().toLowerCase() === target.toLowerCase());
              if (!opt) throw new Error('Option not found: ' + target);
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (setter) setter.call(el, opt.value);
              else el.value = opt.value;
            }
          } else if (tag === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(el, ${JSON.stringify(field.value)});
            else el.value = ${JSON.stringify(field.value)};
          } else {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(el, ${JSON.stringify(field.value)});
            else el.value = ${JSON.stringify(field.value)};
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      results.push(`✓ ${field.selector} = "${field.value}"`);
    }

    if (options.rawResult) return { success: true, fields: results };
    return { content: [{ type: 'text', text: results.join('\n') }] };
  }

  // ─── Drag ───────────────────────────────────────────────────

  private async onDrag(args: any, options: any): Promise<any> {
    const from = await this.getElementCenter(args.fromSelector);
    const to = await this.getElementCenter(args.toSelector);

    // Press at source
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: from.x, y: from.y,
    });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1,
    });

    // Move to target in steps
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + (to.x - from.x) * (i / steps));
      const y = Math.round(from.y + (to.y - from.y) * (i / steps));
      await this.cdp('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, buttons: 1,
      });
    }

    // Release at target
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left',
    });

    if (options.rawResult) return { success: true, from, to };
    return {
      content: [{
        type: 'text',
        text: `Dragged ${args.fromSelector} → ${args.toSelector}`,
      }],
    };
  }

  // ─── Window ─────────────────────────────────────────────────

  private async onWindow(args: any, options: any): Promise<any> {
    const result = await this.ext!.sendCmd('window', {
      action: args.action,
      width: args.width,
      height: args.height,
    });
    return this.formatResult('browser_window', result, options);
  }

  // ─── Verification ───────────────────────────────────────────

  private async onVerifyTextVisible(args: any, options: any): Promise<any> {
    const text = args.text as string;
    const found = await this.eval(`document.body.innerText.includes(${JSON.stringify(text)})`);

    if (options.rawResult) return { visible: found, text };
    return {
      content: [{
        type: 'text',
        text: found ? `✓ Text visible: "${text}"` : `✗ Text not found: "${text}"`,
      }],
      isError: !found,
    };
  }

  private async onVerifyElementVisible(args: any, options: any): Promise<any> {
    const selector = args.selector as string;
    const result = await this.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { exists: false, visible: false };
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                        rect.width > 0 && rect.height > 0;
        return { exists: true, visible };
      })()
    `);

    if (options.rawResult) return result;
    const visible = result?.visible;
    return {
      content: [{
        type: 'text',
        text: visible ? `✓ Element visible: ${selector}` : `✗ Element not visible: ${selector}`,
      }],
      isError: !visible,
    };
  }

  // ─── Network Requests ──────────────────────────────────────

  private async onNetworkRequests(args: any, options: any): Promise<any> {
    const action = (args.action as string) || 'list';

    if (action === 'clear') {
      await this.ext!.sendCmd('clearNetwork', {});
      if (options.rawResult) return { success: true };
      return { content: [{ type: 'text', text: 'Network requests cleared' }] };
    }

    const result = await this.ext!.sendCmd('networkRequests', {});
    let requests = result?.requests || [];

    // Apply filters
    if (args.urlPattern) {
      requests = requests.filter((r: any) => r.url?.includes(args.urlPattern));
    }
    if (args.method) {
      requests = requests.filter((r: any) => r.method === args.method);
    }
    if (args.status) {
      requests = requests.filter((r: any) => r.statusCode === args.status);
    }
    if (args.resourceType) {
      requests = requests.filter((r: any) => r.type === args.resourceType);
    }

    if (action === 'details' && args.requestId) {
      const req = requests.find((r: any) => r.requestId === args.requestId);
      if (!req) return this.error(`Request not found: \`${args.requestId}\`\n\nUse \`action='list'\` to see available request IDs.`, options);
      if (options.rawResult) return req;
      return { content: [{ type: 'text', text: JSON.stringify(req, null, 2) }] };
    }

    if (action === 'replay' && args.requestId) {
      const req = requests.find((r: any) => r.requestId === args.requestId);
      if (!req) return this.error(`Request not found: \`${args.requestId}\`\n\nUse \`action='list'\` to see available request IDs.`, options);

      const replayResult = await this.eval(`
        fetch(${JSON.stringify(req.url)}, {
          method: ${JSON.stringify(req.method || 'GET')},
          ${req.postData ? `body: ${JSON.stringify(req.postData)},` : ''}
        }).then(r => r.text().then(body => ({ status: r.status, statusText: r.statusText, body })))
      `);

      if (options.rawResult) return replayResult;
      return { content: [{ type: 'text', text: `Replay: ${replayResult?.status} ${replayResult?.statusText}\n\n${replayResult?.body?.substring(0, 2000) || ''}` }] };
    }

    // List (default)
    const limit = (args.limit as number) || 20;
    const offset = (args.offset as number) || 0;
    const total = requests.length;
    requests = requests.slice(offset, offset + limit);

    if (options.rawResult) return { requests, total, offset, limit };

    if (requests.length === 0) {
      return { content: [{ type: 'text', text: 'No network requests captured' }] };
    }

    let text = `### Network Requests (${total} total)\n\n`;
    requests.forEach((r: any, i: number) => {
      const status = r.statusCode || '...';
      text += `${offset + i + 1}. [${status}] ${r.method || 'GET'} ${r.url}\n`;
    });

    return { content: [{ type: 'text', text }] };
  }

  // ─── PDF Save ───────────────────────────────────────────────

  private async onPdfSave(args: any, options: any): Promise<any> {
    const filePath = args.path as string;
    const result: any = await this.cdp('Page.printToPDF', {});

    if (result?.data) {
      const buffer = Buffer.from(result.data, 'base64');
      if (filePath) fs.writeFileSync(filePath, buffer);

      if (options.rawResult) return { success: true, path: filePath, size: buffer.length };
      return {
        content: [{ type: 'text', text: `PDF saved to ${filePath} (${buffer.length} bytes)` }],
      };
    }

    return this.error(
      'PDF generation failed.\n\n' +
      '**Troubleshooting:**\n' +
      '- Ensure a tab is attached via `browser_tabs action=\'attach\'`\n' +
      '- The page must be fully loaded before generating a PDF',
      options
    );
  }

  // ─── Dialog ─────────────────────────────────────────────────

  private async onDialog(args: any, options: any): Promise<any> {
    if (args.accept !== undefined) {
      const result = await this.ext!.sendCmd('dialog', {
        accept: args.accept,
        text: args.text,
      });
      return this.formatResult('browser_handle_dialog', result, options);
    }

    // Get dialog events
    const result = await this.ext!.sendCmd('dialog', {});
    return this.formatResult('browser_handle_dialog', result, options);
  }

  // ─── Extensions ─────────────────────────────────────────────

  private async onListExtensions(options: any): Promise<any> {
    const result = await this.ext!.sendCmd('listExtensions', {});
    return this.formatResult('browser_list_extensions', result, options);
  }

  private async onReloadExtensions(args: any, options: any): Promise<any> {
    const result = await this.ext!.sendCmd('reloadExtension', {
      extensionName: args.extensionName,
    });
    return this.formatResult('browser_reload_extensions', result, options);
  }

  // ─── Performance Metrics ────────────────────────────────────

  private async onPerformanceMetrics(options: any): Promise<any> {
    // Get CDP metrics
    const cdpResult = await this.ext!.sendCmd('performanceMetrics', {});
    const metrics = cdpResult?.metrics || [];

    // Get Web Vitals from page
    const vitals = await this.eval(`
      (() => {
        const perf = performance.getEntriesByType('navigation')[0] || {};
        const paint = performance.getEntriesByType('paint') || [];
        const fcp = paint.find(e => e.name === 'first-contentful-paint');

        return {
          ttfb: perf.responseStart ? Math.round(perf.responseStart) : null,
          fcp: fcp ? Math.round(fcp.startTime) : null,
          domContentLoaded: perf.domContentLoadedEventEnd ? Math.round(perf.domContentLoadedEventEnd) : null,
          load: perf.loadEventEnd ? Math.round(perf.loadEventEnd) : null,
        };
      })()
    `).catch(() => null);

    if (options.rawResult) return { metrics, vitals };

    let text = '### Performance Metrics\n\n';

    if (vitals) {
      if (vitals.ttfb != null) text += `TTFB: ${vitals.ttfb}ms\n`;
      if (vitals.fcp != null) text += `FCP: ${vitals.fcp}ms\n`;
      if (vitals.domContentLoaded != null) text += `DOM Content Loaded: ${vitals.domContentLoaded}ms\n`;
      if (vitals.load != null) text += `Load: ${vitals.load}ms\n`;
    }

    if (metrics.length > 0) {
      text += '\n**CDP Metrics:**\n';
      for (const m of metrics) {
        text += `${m.name}: ${m.value}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  }

  // ─── Secure Fill ────────────────────────────────────────────

  private async onSecureFill(args: any, options: any): Promise<any> {
    const selector = args.selector as string;
    const envName = args.credential_env as string;

    if (!selector || !envName) {
      return this.error('Both selector and credential_env are required.', options);
    }

    const value = process.env[envName];
    if (value === undefined) {
      return this.error(
        `Environment variable "${envName}" is not set. Set it before starting the server.`,
        options
      );
    }

    await this.ext!.sendCmd('secure_fill', { selector, value });

    if (options.rawResult) {
      return { success: true, selector, credential_env: envName };
    }

    return {
      content: [{
        type: 'text',
        text: `Securely filled \`${selector}\` with credential from \`${envName}\``,
      }],
    };
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
