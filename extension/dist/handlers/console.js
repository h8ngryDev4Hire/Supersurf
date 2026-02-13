/**
 * Console message capture handler
 * Injects console override into page context (MAIN world)
 * Adapted from Blueprint MCP (Apache 2.0)
 */
const MAX_MESSAGES = 1000;
export class ConsoleHandler {
    browser;
    logger;
    messages = [];
    constructor(browserAPI, logger) {
        this.browser = browserAPI;
        this.logger = logger;
    }
    setupMessageListener() {
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
    async injectConsoleCapture(tabId) {
        try {
            await this.browser.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => {
                    if (window.__supersurfConsoleInjected)
                        return;
                    window.__supersurfConsoleInjected = true;
                    const original = {
                        log: console.log.bind(console),
                        warn: console.warn.bind(console),
                        error: console.error.bind(console),
                        info: console.info.bind(console),
                        debug: console.debug.bind(console),
                    };
                    const levels = ['log', 'warn', 'error', 'info', 'debug'];
                    for (const level of levels) {
                        console[level] = (...args) => {
                            original[level](...args);
                            try {
                                const text = args
                                    .map((a) => {
                                    if (typeof a === 'object') {
                                        try {
                                            return JSON.stringify(a);
                                        }
                                        catch {
                                            return String(a);
                                        }
                                    }
                                    return String(a);
                                })
                                    .join(' ');
                                window.postMessage({ __supersurfConsole: { level, text, timestamp: Date.now() } }, '*');
                            }
                            catch {
                                // Ignore serialization errors
                            }
                        };
                    }
                },
            });
        }
        catch (e) {
            this.logger.log('[ConsoleHandler] Failed to inject:', e.message);
        }
    }
    addMessage(msg) {
        if (this.messages.length >= MAX_MESSAGES) {
            this.messages.shift();
        }
        this.messages.push(msg);
    }
    getMessages(tabId) {
        if (tabId !== undefined) {
            return this.messages.filter((m) => m.tabId === tabId);
        }
        return [...this.messages];
    }
    clearMessages() {
        this.messages = [];
    }
}
