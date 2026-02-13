"use strict";
/**
 * Extension WebSocket Server
 * Listens on localhost for the browser extension to connect.
 * Adapted from Blueprint MCP (Apache 2.0)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionServer = void 0;
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const logger_1 = require("./logger");
function debugLog(...args) {
    if (global.DEBUG_MODE) {
        const logger = (0, logger_1.getLogger)();
        logger.log('[ExtensionServer]', ...args);
    }
}
class ExtensionServer {
    _port;
    _host;
    _httpServer = null;
    _wss = null;
    _extensionWs = null;
    _pendingRequests = new Map();
    _browserType = 'chrome';
    _buildTimestamp = null;
    _pingInterval = null;
    onReconnect = null;
    onTabInfoUpdate = null;
    constructor(port = 5555, host = '127.0.0.1') {
        this._port = port;
        this._host = host;
    }
    getBrowserType() {
        return this._browserType;
    }
    getBuildTimestamp() {
        return this._buildTimestamp;
    }
    async start() {
        return new Promise((resolve, reject) => {
            this._httpServer = http_1.default.createServer((_req, res) => {
                res.writeHead(200);
                res.end('SuperSurf Extension Server');
            });
            this._wss = new ws_1.WebSocketServer({ server: this._httpServer });
            this._wss.on('error', (error) => {
                debugLog('WebSocketServer error:', error);
                reject(error);
            });
            this._wss.on('connection', (ws) => {
                debugLog('Extension connection attempt');
                // Reject if already connected
                if (this._extensionWs && this._extensionWs.readyState === ws_1.WebSocket.OPEN) {
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
                const isReconnection = !!this._extensionWs;
                if (this._extensionWs) {
                    debugLog('Closing previous connection — reconnection detected');
                    this._extensionWs.close();
                }
                this._extensionWs = ws;
                // Clear old ping interval
                if (this._pingInterval) {
                    clearInterval(this._pingInterval);
                    this._pingInterval = null;
                }
                // Keep-alive ping every 10s
                this._pingInterval = setInterval(() => {
                    if (ws.readyState === ws_1.WebSocket.OPEN) {
                        ws.ping();
                    }
                }, 10000);
                if (isReconnection && this.onReconnect) {
                    this.onReconnect();
                }
                ws.on('message', (data) => this._handleMessage(data));
                ws.on('pong', () => debugLog('Pong received'));
                ws.on('close', () => {
                    debugLog('Extension disconnected');
                    if (this._extensionWs === ws) {
                        this._extensionWs = null;
                    }
                    if (this._pingInterval) {
                        clearInterval(this._pingInterval);
                        this._pingInterval = null;
                    }
                });
                ws.on('error', (error) => debugLog('WebSocket error:', error));
            });
            this._httpServer.on('error', (error) => {
                debugLog('HTTP Server error:', error);
                reject(error);
            });
            this._httpServer.listen(this._port, this._host, () => {
                debugLog(`Server listening on ${this._host}:${this._port}`);
                resolve();
            });
        });
    }
    _handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            debugLog('Received from extension:', message.method || 'response');
            // Response (has id, no method)
            if (message.id !== undefined && !message.method) {
                const pending = this._pendingRequests.get(message.id);
                if (pending) {
                    this._pendingRequests.delete(message.id);
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
                this._browserType = message.browser || 'chrome';
                this._buildTimestamp = message.buildTimestamp || null;
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
    async sendCommand(method, params = {}, timeout = 30000) {
        if (!this._extensionWs || this._extensionWs.readyState !== ws_1.WebSocket.OPEN) {
            throw new Error('Extension not connected. Open the extension popup and click "Enable".');
        }
        const id = Math.random().toString(36).substring(7);
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);
            this._pendingRequests.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                },
            });
            const message = { jsonrpc: '2.0', id, method, params };
            debugLog('Sending to extension:', method);
            this._extensionWs.send(JSON.stringify(message));
        });
    }
    setClientId(clientId) {
        debugLog('Client ID set to:', clientId);
        if (this.isConnected()) {
            const notification = {
                jsonrpc: '2.0',
                method: 'authenticated',
                params: { client_id: clientId },
            };
            this._extensionWs.send(JSON.stringify(notification));
        }
    }
    isConnected() {
        return !!this._extensionWs && this._extensionWs.readyState === ws_1.WebSocket.OPEN;
    }
    async stop() {
        debugLog('Stopping server');
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._extensionWs) {
            this._extensionWs.close();
            this._extensionWs = null;
        }
        if (this._wss) {
            this._wss.close();
            this._wss = null;
        }
        if (this._httpServer) {
            return new Promise((resolve) => {
                this._httpServer.close(() => {
                    debugLog('Server stopped');
                    resolve();
                });
            });
        }
    }
}
exports.ExtensionServer = ExtensionServer;
//# sourceMappingURL=extensionServer.js.map