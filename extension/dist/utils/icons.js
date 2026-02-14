/**
 * Icon & badge manager for the extension
 * Adapted from Blueprint MCP (Apache 2.0)
 */
export class IconManager {
    browser;
    logger;
    ctx;
    actionAPI;
    constructor(browserAPI, logger, sessionContext) {
        this.browser = browserAPI;
        this.logger = logger;
        this.ctx = sessionContext;
        this.actionAPI = browserAPI.action || browserAPI.browserAction;
    }
    init() {
        this.browser.tabs.onActivated.addListener(() => this.updateBadgeForTab());
        this.browser.tabs.onRemoved.addListener((tabId) => {
            if (tabId === this.ctx.attachedTabId) {
                this.ctx.attachedTabId = null;
                this.updateBadgeForTab();
            }
        });
    }
    setConnected(value) {
        this.ctx.connected = value;
    }
    setAttachedTab(tabId) {
        this.ctx.attachedTabId = tabId;
        this.updateBadgeForTab();
    }
    setStealthMode(enabled) {
        this.ctx.stealthMode = enabled;
        this.updateBadgeForTab();
    }
    async updateBadgeForTab() {
        try {
            const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id)
                return;
            if (tab.id === this.ctx.attachedTabId) {
                const color = this.ctx.stealthMode ? '#333333' : '#1c75bc';
                await this.updateBadge(tab.id, { text: '\u2713', color, title: 'Automated' });
            }
            else {
                await this.clearBadge(tab.id);
            }
        }
        catch {
            // Tab may not exist
        }
    }
    async updateBadge(tabId, opts) {
        try {
            await this.actionAPI.setBadgeText({ text: opts.text, tabId });
            await this.actionAPI.setBadgeBackgroundColor({ color: opts.color, tabId });
            await this.actionAPI.setTitle({ title: `SuperSurf \u2014 ${opts.title}`, tabId });
        }
        catch {
            // Tab may not exist
        }
    }
    async clearBadge(tabId) {
        try {
            await this.actionAPI.setBadgeText({ text: '', tabId });
            await this.actionAPI.setTitle({ title: 'SuperSurf', tabId });
        }
        catch {
            // Tab may not exist
        }
    }
    async setGlobalIcon(state, title) {
        this.logger.log(`[IconManager] setGlobalIcon: ${state} \u2014 ${title}`);
        await this.actionAPI.setTitle({ title: `SuperSurf \u2014 ${title}` });
    }
    async updateConnectingBadge() {
        await this.setGlobalIcon('connecting', 'Connecting...');
    }
}
