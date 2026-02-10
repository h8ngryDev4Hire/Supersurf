/**
 * Tab management handler
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from '../utils/logger.js';
import { IconManager } from '../utils/icons.js';

interface TabInfo {
  id: number;
  index: number;
  title: string;
  url: string;
  automatable: boolean;
  attached?: boolean;
  stealthMode?: boolean | null;
  techStack?: any;
}

export class TabHandlers {
  private browser: typeof chrome;
  private logger: Logger;
  private iconManager: IconManager;
  private attachedTabId: number | null = null;
  private stealthMode: boolean = false;
  private stealthTabs: Map<number, boolean> = new Map();
  private techStackInfo: Map<number, any> = new Map();

  private consoleInjector: ((tabId: number) => Promise<void>) | null = null;
  private dialogInjector: ((tabId: number) => Promise<void>) | null = null;

  constructor(browserAPI: typeof chrome, logger: Logger, iconManager: IconManager) {
    this.browser = browserAPI;
    this.logger = logger;
    this.iconManager = iconManager;

    // Listen for tab close
    this.browser.tabs.onRemoved.addListener((tabId) => this.handleTabClosed(tabId));
  }

  setConsoleInjector(fn: (tabId: number) => Promise<void>): void {
    this.consoleInjector = fn;
  }

  setDialogInjector(fn: (tabId: number) => Promise<void>): void {
    this.dialogInjector = fn;
  }

  getAttachedTabId(): number | null {
    return this.attachedTabId;
  }

  setTechStackInfo(tabId: number, techStack: any): void {
    this.techStackInfo.set(tabId, techStack);
  }

  async getTabs(): Promise<{ tabs: TabInfo[]; attachedTabId: number | null }> {
    const allTabs = await this.browser.tabs.query({});
    const tabs: TabInfo[] = allTabs.map((tab, idx) => {
      const url = tab.url || '';
      const automatable = !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('about:');

      return {
        id: tab.id!,
        index: idx,
        title: tab.title || 'Untitled',
        url,
        automatable,
        attached: tab.id === this.attachedTabId,
        stealthMode: this.stealthTabs.get(tab.id!) ?? null,
        techStack: this.techStackInfo.get(tab.id!) || null,
      };
    });

    return { tabs, attachedTabId: this.attachedTabId };
  }

  async createTab(params: { url?: string; activate?: boolean; stealth?: boolean }): Promise<any> {
    const url = params.url || 'about:blank';
    const activate = params.activate !== false;
    const stealth = params.stealth || false;

    const tab = await this.browser.tabs.create({ url, active: activate });

    this.attachedTabId = tab.id!;
    this.stealthMode = stealth;
    this.stealthTabs.set(tab.id!, stealth);

    this.iconManager.setAttachedTab(tab.id!);
    this.iconManager.setStealthMode(stealth);

    // Inject console/dialog handlers
    if (this.consoleInjector) await this.consoleInjector(tab.id!).catch(() => {});
    if (this.dialogInjector) await this.dialogInjector(tab.id!).catch(() => {});

    return {
      attachedTab: {
        id: tab.id,
        index: tab.index,
        title: tab.title || 'Untitled',
        url: tab.url || url,
      },
      stealthMode: stealth,
    };
  }

  async selectTab(params: { index: number; activate?: boolean; stealth?: boolean }): Promise<any> {
    const allTabs = await this.browser.tabs.query({});
    if (params.index < 0 || params.index >= allTabs.length) {
      throw new Error(`Tab index ${params.index} out of range (0-${allTabs.length - 1})`);
    }

    const tab = allTabs[params.index];
    const url = tab.url || '';

    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      throw new Error(`Cannot automate ${url} — Chrome internal pages are not accessible.`);
    }

    const stealth = params.stealth ?? this.stealthTabs.get(tab.id!) ?? false;

    this.attachedTabId = tab.id!;
    this.stealthMode = stealth;
    this.stealthTabs.set(tab.id!, stealth);

    this.iconManager.setAttachedTab(tab.id!);
    this.iconManager.setStealthMode(stealth);

    if (params.activate) {
      await this.browser.tabs.update(tab.id!, { active: true });
    }

    // Inject handlers
    if (this.consoleInjector) await this.consoleInjector(tab.id!).catch(() => {});
    if (this.dialogInjector) await this.dialogInjector(tab.id!).catch(() => {});

    return {
      attachedTab: {
        id: tab.id,
        index: params.index,
        title: tab.title || 'Untitled',
        url,
        techStack: this.techStackInfo.get(tab.id!) || null,
      },
      stealthMode: stealth,
    };
  }

  async closeTab(index?: number): Promise<{ success: boolean; message: string }> {
    let tabId: number;

    if (index !== undefined) {
      const allTabs = await this.browser.tabs.query({});
      if (index < 0 || index >= allTabs.length) {
        throw new Error(`Tab index ${index} out of range`);
      }
      tabId = allTabs[index].id!;
    } else if (this.attachedTabId) {
      tabId = this.attachedTabId;
    } else {
      throw new Error('No tab specified and no tab attached');
    }

    await this.browser.tabs.remove(tabId);
    this.handleTabClosed(tabId);

    return { success: true, message: `Tab closed` };
  }

  handleTabClosed(tabId: number): void {
    if (tabId === this.attachedTabId) {
      this.attachedTabId = null;
      this.iconManager.setAttachedTab(null);
    }
    this.stealthTabs.delete(tabId);
    this.techStackInfo.delete(tabId);
  }
}
