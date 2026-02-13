/**
 * Debug logging utility for the extension
 * Adapted from Blueprint MCP (Apache 2.0)
 */
export class Logger {
    prefix;
    debugMode = false;
    browser = null;
    constructor(prefix) {
        this.prefix = prefix;
    }
    async init(browserAPI) {
        this.browser = browserAPI;
        const result = await browserAPI.storage.local.get(['debugMode']);
        this.debugMode = result.debugMode === true;
        browserAPI.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.debugMode) {
                this.debugMode = changes.debugMode.newValue === true;
            }
        });
    }
    timestamp() {
        const d = new Date();
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
    }
    log(...args) {
        if (this.debugMode) {
            console.log(`[${this.prefix}] ${this.timestamp()}`, ...args);
        }
    }
    logAlways(...args) {
        console.log(`[${this.prefix}] ${this.timestamp()}`, ...args);
    }
    error(...args) {
        console.error(`[${this.prefix}] ${this.timestamp()}`, ...args);
    }
    warn(...args) {
        console.warn(`[${this.prefix}] ${this.timestamp()}`, ...args);
    }
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }
}
