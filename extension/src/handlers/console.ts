/**
 * Console message capture handler
 * Injects console override into page context (MAIN world)
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from '../utils/logger.js';

interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: number;
  tabId?: number;
}

const MAX_MESSAGES = 1000;

export class ConsoleHandler {
  private browser: typeof chrome;
  private logger: Logger;
  private messages: ConsoleMessage[] = [];

  constructor(browserAPI: typeof chrome, logger: Logger) {
    this.browser = browserAPI;
    this.logger = logger;
  }

  setupMessageListener(): void {
    this.browser.runtime.onMessage.addListener((message, sender) => {
      if (message.type === 'console') {
        this.addMessage({
          level: message.level,
          text: message.text,
          timestamp: message.timestamp || Date.now(),
          tabId: sender.tab?.id,
        });
      }
    });
  }

  async injectConsoleCapture(tabId: number): Promise<void> {
    try {
      await this.browser.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as any,
        func: () => {
          if ((window as any).__supersurfConsoleInjected) return;
          (window as any).__supersurfConsoleInjected = true;

          const original = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            info: console.info.bind(console),
            debug: console.debug.bind(console),
          };

          const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;

          for (const level of levels) {
            (console as any)[level] = (...args: any[]) => {
              original[level](...args);
              try {
                const text = args
                  .map((a) => {
                    if (typeof a === 'object') {
                      try { return JSON.stringify(a); } catch { return String(a); }
                    }
                    return String(a);
                  })
                  .join(' ');

                window.postMessage(
                  { __supersurfConsole: { level, text, timestamp: Date.now() } },
                  '*'
                );
              } catch {
                // Ignore serialization errors
              }
            };
          }
        },
      });
    } catch (e: any) {
      this.logger.log('[ConsoleHandler] Failed to inject:', e.message);
    }
  }

  addMessage(msg: ConsoleMessage): void {
    if (this.messages.length >= MAX_MESSAGES) {
      this.messages.shift();
    }
    this.messages.push(msg);
  }

  getMessages(tabId?: number): ConsoleMessage[] {
    if (tabId !== undefined) {
      return this.messages.filter((m) => m.tabId === tabId);
    }
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
  }
}
