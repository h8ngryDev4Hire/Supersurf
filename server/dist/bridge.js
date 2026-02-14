"use strict";
/**
 * WebSocket bridge to the Chrome extension.
 * Listens on localhost, speaks JSON-RPC 2.0.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionServer = void 0;
const crypto_1 = __importDefault(require("crypto"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const logger_1 = require("./logger");
const log = (0, logger_1.createLog)('[WS]');
class ExtensionServer {
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
    onRawConnection = null;
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
    async start() {
        return new Promise((resolve, reject) => {
            this.httpServer = http_1.default.createServer((_req, res) => {
                res.writeHead(200);
                res.end('SuperSurf Extension Server');
            });
            this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
            this.wss.on('error', (error) => {
                log('WebSocketServer error:', error);
                reject(error);
            });
            this.wss.on('connection', (ws, request) => {
                log('Extension connection attempt');
                // Delegate to raw connection handler if set (used by multiplexer)
                if (this.onRawConnection) {
                    const handled = this.onRawConnection(ws, request);
                    if (handled)
                        return;
                }
                // Reject if already connected
                if (this.socket && this.socket.readyState === ws_1.WebSocket.OPEN) {
                    log('Rejecting new connection — browser already connected');
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
                log('Extension connected');
                const isReconnection = !!this.socket;
                if (this.socket) {
                    log('Closing previous connection — reconnection detected');
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
                ws.on('pong', () => log('Pong received'));
                ws.on('close', () => {
                    log('Extension disconnected');
                    if (this.socket === ws) {
                        this.socket = null;
                    }
                    if (this.pingInterval) {
                        clearInterval(this.pingInterval);
                        this.pingInterval = null;
                    }
                });
                ws.on('error', (error) => log('WebSocket error:', error));
            });
            this.httpServer.on('error', (error) => {
                log('HTTP Server error:', error);
                reject(error);
            });
            this.httpServer.listen(this.port, this.host, () => {
                log(`Server listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            // Response (has id, no method)
            if (message.id !== undefined && !message.method) {
                const pending = this.inflight.get(message.id);
                if (pending) {
                    this.inflight.delete(message.id);
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
                log('Handshake received:', message);
                this.browserType = message.browser || 'chrome';
                this.buildTimestamp = message.buildTimestamp || null;
                return;
            }
            // Notification (has method, no id)
            if (message.method && message.id === undefined) {
                log('Notification:', message.method);
                if (message.method === 'notifications/tab_info_update' &&
                    message.params?.currentTab &&
                    this.onTabInfoUpdate) {
                    this.onTabInfoUpdate(message.params.currentTab);
                }
                return;
            }
        }
        catch (error) {
            log('Error handling message:', error);
        }
    }
    async sendCmd(method, params = {}, timeout = 30000) {
        if (!this.socket || this.socket.readyState !== ws_1.WebSocket.OPEN) {
            throw new Error('Extension not connected. Open the extension popup and click "Enable".');
        }
        const id = crypto_1.default.randomUUID().slice(0, 8);
        // Log outgoing command with params
        if (method === 'forwardCDPCommand') {
            log(`→ ${method}:`, params.method, params.params ?? {});
        }
        else {
            log(`→ ${method}`, params);
        }
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.inflight.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);
            this.inflight.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    log(`← ${method}`, result);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    log(`✗ ${method}:`, error.message);
                    reject(error);
                },
            });
            const message = { jsonrpc: '2.0', id, method, params };
            this.socket.send(JSON.stringify(message));
        });
    }
    notifyClientId(clientId) {
        log('Client ID set to:', clientId);
        if (this.connected) {
            const notification = {
                jsonrpc: '2.0',
                method: 'authenticated',
                params: { client_id: clientId },
            };
            this.socket.send(JSON.stringify(notification));
        }
    }
    async stop() {
        log('Stopping server');
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
                    log('Server stopped');
                    resolve();
                });
            });
        }
    }
}
exports.ExtensionServer = ExtensionServer;
//# sourceMappingURL=bridge.js.map