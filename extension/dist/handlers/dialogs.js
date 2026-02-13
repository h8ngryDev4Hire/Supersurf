/**
 * Dialog (alert/confirm/prompt) auto-handler
 * Adapted from Blueprint MCP (Apache 2.0)
 */
export class DialogHandler {
    browser;
    logger;
    constructor(browserAPI, logger) {
        this.browser = browserAPI;
        this.logger = logger;
    }
    async setupDialogOverrides(tabId, accept = true, promptText = '') {
        try {
            await this.browser.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: (shouldAccept, text) => {
                    if (!window.__supersurfDialogEvents) {
                        window.__supersurfDialogEvents = [];
                    }
                    window.alert = (msg) => {
                        window.__supersurfDialogEvents.push({
                            type: 'alert',
                            message: msg,
                            response: 'accepted',
                            timestamp: Date.now(),
                        });
                    };
                    window.confirm = (msg) => {
                        window.__supersurfDialogEvents.push({
                            type: 'confirm',
                            message: msg,
                            response: shouldAccept ? 'accepted' : 'dismissed',
                            timestamp: Date.now(),
                        });
                        return shouldAccept;
                    };
                    window.prompt = (msg, defaultValue) => {
                        const value = shouldAccept ? (text || defaultValue || '') : null;
                        window.__supersurfDialogEvents.push({
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
        }
        catch (e) {
            this.logger.log('[DialogHandler] Failed to inject:', e.message);
        }
    }
    async getDialogEvents(tabId) {
        try {
            const results = await this.browser.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => window.__supersurfDialogEvents || [],
            });
            return results?.[0]?.result || [];
        }
        catch {
            return [];
        }
    }
    async clearDialogEvents(tabId) {
        try {
            await this.browser.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => { window.__supersurfDialogEvents = []; },
            });
        }
        catch {
            // Ignore
        }
    }
}
