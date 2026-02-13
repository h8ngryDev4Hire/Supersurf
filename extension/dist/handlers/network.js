/**
 * Network request tracker using webRequest API
 * Adapted from Blueprint MCP (Apache 2.0)
 */
const MAX_REQUESTS = 500;
export class NetworkTracker {
    browser;
    logger;
    requests = new Map();
    constructor(browserAPI, logger) {
        this.browser = browserAPI;
        this.logger = logger;
    }
    init() {
        const filter = { urls: ['<all_urls>'] };
        this.browser.webRequest.onBeforeRequest.addListener((details) => this._handleBeforeRequest(details), filter, ['requestBody']);
        this.browser.webRequest.onBeforeSendHeaders.addListener((details) => this._handleBeforeSendHeaders(details), filter, ['requestHeaders']);
        this.browser.webRequest.onCompleted.addListener((details) => this._handleCompleted(details), filter, ['responseHeaders']);
        this.browser.webRequest.onErrorOccurred.addListener((details) => this._handleError(details), filter);
    }
    getRequests() {
        return Array.from(this.requests.values());
    }
    clearRequests() {
        this.requests.clear();
    }
    _handleBeforeRequest(details) {
        // Trim to max
        if (this.requests.size >= MAX_REQUESTS) {
            const oldest = this.requests.keys().next().value;
            if (oldest)
                this.requests.delete(oldest);
        }
        this.requests.set(details.requestId, {
            requestId: details.requestId,
            url: details.url,
            method: details.method,
            type: details.type,
            timestamp: details.timeStamp,
            requestBody: details.requestBody || undefined,
        });
    }
    _handleBeforeSendHeaders(details) {
        const req = this.requests.get(details.requestId);
        if (req && details.requestHeaders) {
            req.requestHeaders = {};
            for (const header of details.requestHeaders) {
                if (header.name && header.value) {
                    req.requestHeaders[header.name] = header.value;
                }
            }
        }
    }
    _handleCompleted(details) {
        const req = this.requests.get(details.requestId);
        if (req) {
            req.statusCode = details.statusCode;
            req.statusLine = details.statusLine;
            if (details.responseHeaders) {
                req.responseHeaders = {};
                for (const header of details.responseHeaders) {
                    if (header.name && header.value) {
                        req.responseHeaders[header.name] = header.value;
                    }
                }
            }
        }
    }
    _handleError(details) {
        const req = this.requests.get(details.requestId);
        if (req) {
            req.error = details.error;
        }
    }
}
