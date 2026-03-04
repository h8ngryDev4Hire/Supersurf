"use strict";
/**
 * WebSocket bridge to the Chrome extension.
 *
 * Runs an HTTP + WebSocket server on localhost (default port 5555).
 * Communication uses JSON-RPC 2.0 with correlation IDs for request/response matching.
 *
 * Stripped-down copy of server/src/bridge.ts for daemon use:
 *   - No onRawConnection hook (daemon handles all routing)
 *   - No logger import (uses console.error for debug)
 *
 * @module extension-bridge
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionBridge = void 0;
const crypto_1 = __importDefault(require("crypto"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const debugLog = (...args) => {
    const logger = global.DAEMON_LOGGER;
    if (logger)
        logger.log('[WS]', ...args);
    else if (global.DAEMON_DEBUG)
        console.error('[WS]', ...args);
};
/**
 * WebSocket server that bridges the daemon to the Chrome extension.
 * Manages a single active connection, with reconnection support.
 */
class ExtensionBridge {
    port;
    host;
    httpServer = null;
    wss = null;
    socket = null;
    inflight = new Map();
    browserType = 'chrome';
    buildTimestamp = null;
    pingInterval = null;
    onReconnect = null;
    onTabInfoUpdate = null;
    constructor(port = 5555, host = '127.0.0.1') {
        this.port = port;
        this.host = host;
    }
    get browser() {
        return this.browserType;
    }
    get buildTime() {
        return this.buildTimestamp;
    }
    get connected() {
        return !!this.socket && this.socket.readyState === ws_1.WebSocket.OPEN;
    }
    /** Spin up the HTTP + WebSocket server and begin accepting connections. */
    async start() {
        return new Promise((resolve, reject) => {
            this.httpServer = http_1.default.createServer((_req, res) => {
                res.writeHead(200);
                res.end('SuperSurf Daemon');
            });
            this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
            this.wss.on('error', (error) => {
                debugLog('WebSocketServer error:', error);
                reject(error);
            });
            this.wss.on('connection', (ws) => {
                debugLog('Extension connection attempt');
                // Reject if already connected
                if (this.socket && this.socket.readyState === ws_1.WebSocket.OPEN) {
                    debugLog('Rejecting new connection — browser already connected');
                    const errorMsg = {
                        jsonrpc: '2.0',
                        error: {
                            code: -32001,
                            message: 'Another browser is already connected. Only one browser at a time.',
                        },
                    };
                    ws.send(JSON.stringify(errorMsg));
                    setTimeout(() => ws.close(1008, 'Already connected'), 100);
                    return;
                }
                debugLog('Extension connected');
                const isReconnection = !!this.socket;
                if (this.socket) {
                    debugLog('Closing previous connection — reconnection detected');
                    this.socket.close();
                }
                this.socket = ws;
                // Clear old ping interval
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                    this.pingInterval = null;
                }
                // Keep-alive ping every 10s
                this.pingInterval = setInterval(() => {
                    if (ws.readyState === ws_1.WebSocket.OPEN) {
                        ws.ping();
                    }
                }, 10000);
                if (isReconnection && this.onReconnect) {
                    this.onReconnect();
                }
                ws.on('message', (data) => this.handleMessage(data));
                ws.on('pong', () => debugLog('Pong received'));
                ws.on('close', () => {
                    debugLog('Extension disconnected');
                    if (this.socket === ws) {
                        this.socket = null;
                    }
                    if (this.pingInterval) {
                        clearInterval(this.pingInterval);
                        this.pingInterval = null;
                    }
                    this.drainInflight();
                });
                ws.on('error', (error) => debugLog('WebSocket error:', error));
            });
            this.httpServer.on('error', (error) => {
                debugLog('HTTP Server error:', error);
                reject(error);
            });
            this.httpServer.listen(this.port, this.host, () => {
                debugLog(`Server listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }
    /** Route incoming WebSocket messages: responses, handshakes, or notifications. */
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            // JSON-RPC response — correlate with inflight request by id
            if (message.id !== undefined && !message.method) {
                const pending = this.inflight.get(message.id);
                if (pending) {
                    this.inflight.delete(message.id);
                    // Piggyback: extract tab info from response if present
                    const result = message.result;
                    if (result && typeof result === 'object' && 'currentTab' in result && this.onTabInfoUpdate) {
                        this.onTabInfoUpdate(result.currentTab);
                    }
                    if (message.error) {
                        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
                    }
                    else {
                        pending.resolve(message.result);
                    }
                }
                return;
            }
            // Handshake
            if (message.type === 'handshake') {
                debugLog('Handshake received:', message);
                this.browserType = message.browser || 'chrome';
                this.buildTimestamp = message.buildTimestamp || null;
                return;
            }
            // Notification (has method, no id)
            if (message.method && message.id === undefined) {
                debugLog('Notification:', message.method);
                if (message.method === 'notifications/tab_info_update' &&
                    message.params?.currentTab &&
                    this.onTabInfoUpdate) {
                    this.onTabInfoUpdate(message.params.currentTab);
                }
                return;
            }
        }
        catch (error) {
            debugLog('Error handling message:', error);
        }
    }
    /**
     * Send a JSON-RPC 2.0 request to the extension and await the response.
     * @param method - Command name
     * @param params - Command parameters
     * @param timeout - Max wait time in ms (default 30s)
     */
    async sendCmd(method, params = {}, timeout = 30000) {
        if (!this.socket || this.socket.readyState !== ws_1.WebSocket.OPEN) {
            throw new Error('Extension not connected');
        }
        const id = crypto_1.default.randomUUID().slice(0, 8);
        debugLog(`-> ${method}`, params);
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.inflight.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);
            this.inflight.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    debugLog(`<- ${method}`, result);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    debugLog(`x ${method}:`, error.message);
                    reject(error);
                },
            });
            const message = { jsonrpc: '2.0', id, method, params };
            this.socket.send(JSON.stringify(message));
        });
    }
    /** Send an `authenticated` notification to the extension with a session's client ID. */
    notifyClientId(clientId) {
        debugLog('Client ID set to:', clientId);
        if (this.connected) {
            const notification = {
                jsonrpc: '2.0',
                method: 'authenticated',
                params: { client_id: clientId },
            };
            this.socket.send(JSON.stringify(notification));
        }
    }
    /** Reject all pending requests with a disconnect error. */
    drainInflight() {
        if (this.inflight.size === 0)
            return;
        debugLog(`Draining ${this.inflight.size} inflight request(s)`);
        for (const [_id, pending] of this.inflight) {
            pending.reject(new Error('Extension disconnected'));
        }
        this.inflight.clear();
    }
    /** Gracefully shut down: clear ping interval, close socket, close servers. */
    async stop() {
        debugLog('Stopping server');
        this.drainInflight();
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.httpServer) {
            return new Promise((resolve) => {
                this.httpServer.close(() => {
                    debugLog('Server stopped');
                    resolve();
                });
            });
        }
    }
}
exports.ExtensionBridge = ExtensionBridge;
//# sourceMappingURL=extension-bridge.js.map