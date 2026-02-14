/**
 * Dialog (alert/confirm/prompt) auto-handler
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from '../utils/logger.js';

export class DialogHandler {
  private browser: typeof chrome;
  private logger: Logger;

  constructor(browserAPI: typeof chrome, logger: Logger) {
    this.browser = browserAPI;
    this.logger = logger;
  }

  async setupDialogOverrides(
    tabId: number,
    accept: boolean = true,
    promptText: string = ''
  ): Promise<void> {
    try {
      await this.browser.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as any,
        func: (shouldAccept: boolean, text: string) => {
          if (!(window as any).__supersurfDialogEvents) {
            (window as any).__supersurfDialogEvents = [];
          }

          window.alert = (msg?: string) => {
            (window as any).__supersurfDialogEvents.push({
              type: 'alert',
              message: msg,
              response: 'accepted',
              timestamp: Date.now(),
            });
          };

          window.confirm = (msg?: string): boolean => {
            (window as any).__supersurfDialogEvents.push({
              type: 'confirm',
              message: msg,
              response: shouldAccept ? 'accepted' : 'dismissed',
              timestamp: Date.now(),
            });
            return shouldAccept;
          };

          window.prompt = (msg?: string, defaultValue?: string): string | null => {
            const value = shouldAccept ? (text || defaultValue || '') : null;
            (window as any).__supersurfDialogEvents.push({
              type: 'prompt',
              message: msg,
              response: value,
              timestamp: Date.now(),
            });
            return value;
          };
        },
        args: [accept, promptText],
      });
    } catch (e: any) {
      this.logger.log('[DialogHandler] Failed to inject:', e.message);
    }
  }

  async getDialogEvents(tabId: number): Promise<any[]> {
    try {
      const results = await this.browser.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as any,
        func: () => (window as any).__supersurfDialogEvents || [],
      });
      return results?.[0]?.result || [];
    } catch {
      return [];
    }
  }

  async clearDialogEvents(tabId: number): Promise<void> {
    try {
      await this.browser.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as any,
        func: () => { (window as any).__supersurfDialogEvents = []; },
      });
    } catch {
      // Ignore
    }
  }
}
