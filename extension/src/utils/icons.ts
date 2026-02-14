/**
 * Icon & badge manager for the extension
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from './logger.js';
import type { SessionContext } from '../session-context.js';

type IconState = 'normal' | 'connecting' | 'connected' | 'attached' | 'attached-stealth';

export class IconManager {
  private browser: typeof chrome;
  private logger: Logger;
  private ctx: SessionContext;
  private actionAPI: typeof chrome.action;

  constructor(browserAPI: typeof chrome, logger: Logger, sessionContext: SessionContext) {
    this.browser = browserAPI;
    this.logger = logger;
    this.ctx = sessionContext;
    this.actionAPI = browserAPI.action || (browserAPI as any).browserAction;
  }

  init(): void {
    this.browser.tabs.onActivated.addListener(() => this.updateBadgeForTab());
    this.browser.tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.ctx.attachedTabId) {
        this.ctx.attachedTabId = null;
        this.updateBadgeForTab();
      }
    });
  }

  setConnected(value: boolean): void {
    this.ctx.connected = value;
  }

  setAttachedTab(tabId: number | null): void {
    this.ctx.attachedTabId = tabId;
    this.updateBadgeForTab();
  }

  setStealthMode(enabled: boolean): void {
    this.ctx.stealthMode = enabled;
    this.updateBadgeForTab();
  }

  async updateBadgeForTab(): Promise<void> {
    try {
      const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (tab.id === this.ctx.attachedTabId) {
        const color = this.ctx.stealthMode ? '#333333' : '#1c75bc';
        await this.updateBadge(tab.id, { text: '\u2713', color, title: 'Automated' });
      } else {
        await this.clearBadge(tab.id);
      }
    } catch {
      // Tab may not exist
    }
  }

  async updateBadge(tabId: number, opts: { text: string; color: string; title: string }): Promise<void> {
    try {
      await this.actionAPI.setBadgeText({ text: opts.text, tabId });
      await this.actionAPI.setBadgeBackgroundColor({ color: opts.color, tabId });
      await this.actionAPI.setTitle({ title: `SuperSurf \u2014 ${opts.title}`, tabId });
    } catch {
      // Tab may not exist
    }
  }

  async clearBadge(tabId: number): Promise<void> {
    try {
      await this.actionAPI.setBadgeText({ text: '', tabId });
      await this.actionAPI.setTitle({ title: 'SuperSurf', tabId });
    } catch {
      // Tab may not exist
    }
  }

  async setGlobalIcon(state: IconState, title: string): Promise<void> {
    this.logger.log(`[IconManager] setGlobalIcon: ${state} \u2014 ${title}`);
    await this.actionAPI.setTitle({ title: `SuperSurf \u2014 ${title}` });
  }

  async updateConnectingBadge(): Promise<void> {
    await this.setGlobalIcon('connecting', 'Connecting...');
  }
}
