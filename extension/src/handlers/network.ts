/**
 * Network request tracker using webRequest API
 * Adapted from Blueprint MCP (Apache 2.0)
 */

import { Logger } from '../utils/logger.js';

interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  type: string;
  timestamp: number;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: any;
  error?: string;
}

const MAX_REQUESTS = 500;

export class NetworkTracker {
  private browser: typeof chrome;
  private logger: Logger;
  private requests: Map<string, NetworkRequest> = new Map();

  constructor(browserAPI: typeof chrome, logger: Logger) {
    this.browser = browserAPI;
    this.logger = logger;
  }

  init(): void {
    const filter = { urls: ['<all_urls>'] };

    this.browser.webRequest.onBeforeRequest.addListener(
      (details) => this._handleBeforeRequest(details),
      filter,
      ['requestBody']
    );

    this.browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => this._handleBeforeSendHeaders(details),
      filter,
      ['requestHeaders']
    );

    this.browser.webRequest.onCompleted.addListener(
      (details) => this._handleCompleted(details),
      filter,
      ['responseHeaders']
    );

    this.browser.webRequest.onErrorOccurred.addListener(
      (details) => this._handleError(details),
      filter
    );
  }

  getRequests(): NetworkRequest[] {
    return Array.from(this.requests.values());
  }

  clearRequests(): void {
    this.requests.clear();
  }

  private _handleBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
    // Trim to max
    if (this.requests.size >= MAX_REQUESTS) {
      const oldest = this.requests.keys().next().value;
      if (oldest) this.requests.delete(oldest);
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

  private _handleBeforeSendHeaders(details: chrome.webRequest.WebRequestHeadersDetails): void {
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

  private _handleCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
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

  private _handleError(details: chrome.webRequest.WebResponseErrorDetails): void {
    const req = this.requests.get(details.requestId);
    if (req) {
      req.error = details.error;
    }
  }
}
