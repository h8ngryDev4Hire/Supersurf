/**
 * Icon & badge manager for the extension
 * Adapted from Blueprint MCP (Apache 2.0)
 */
export class IconManager {
    browser;
    logger;
    connected = false;
    attachedTabId = null;
    stealthMode = false;
    actionAPI;
    constructor(browserAPI, logger) {
        this.browser = browserAPI;
        this.logger = logger;
        this.actionAPI = browserAPI.action || browserAPI.browserAction;
    }
    init() {
        this.browser.tabs.onActivated.addListener(() => this.updateBadgeForTab());
        this.browser.tabs.onRemoved.addListener((tabId) => {
            if (tabId === this.attachedTabId) {
                this.attachedTabId = null;
                this.updateBadgeForTab();
            }
        });
    }
    setConnected(value) {
        this.connected = value;
    }
    setAttachedTab(tabId) {
        this.attachedTabId = tabId;
        this.updateBadgeForTab();
    }
    setStealthMode(enabled) {
        this.stealthMode = enabled;
        this.updateBadgeForTab();
    }
    async updateBadgeForTab() {
        try {
            const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id)
                return;
            if (tab.id === this.attachedTabId) {
                const color = this.stealthMode ? '#333333' : '#1c75bc';
                await this.updateBadge(tab.id, { text: '✓', color, title: 'Automated' });
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
            await this.actionAPI.setTitle({ title: `SuperSurf — ${opts.title}`, tabId });
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
        this.logger.log(`[IconManager] setGlobalIcon: ${state} — ${title}`);
        await this.actionAPI.setTitle({ title: `SuperSurf — ${title}` });
    }
    async updateConnectingBadge() {
        await this.setGlobalIcon('connecting', 'Connecting...');
    }
}
