"use strict";
/**
 * ConnectionManager — manages connection lifecycle.
 * States: passive → active → connected
 *
 * Delegates tool schemas to backend/schemas.ts, status formatting to
 * backend/status.ts, and handler logic to backend/handlers.ts.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionManager = void 0;
const logger_1 = require("./logger");
const status_1 = require("./backend/status");
const schemas_1 = require("./backend/schemas");
const handlers_1 = require("./backend/handlers");
const log = (0, logger_1.createLog)('[Conn]');
// Forward-declare BrowserBridge import (lazy to avoid circular deps)
let BrowserBridge = null;
async function getBrowserBridge() {
    if (!BrowserBridge) {
        const mod = await Promise.resolve().then(() => __importStar(require('./tools')));
        BrowserBridge = mod.BrowserBridge;
    }
    return BrowserBridge;
}
class ConnectionManager {
    config;
    state = 'passive';
    bridge = null;
    extensionServer = null;
    debugMode;
    clientId = null;
    connectedBrowserName = null;
    attachedTab = null;
    stealthMode = false;
    server = null;
    clientInfo = {};
    constructor(config) {
        log('Constructor — starting in PASSIVE mode');
        this.config = config;
        this.debugMode = config.debug || false;
    }
    async initialize(server, clientInfo) {
        log('Initialize called — staying in passive mode');
        this.server = server;
        this.clientInfo = clientInfo;
    }
    // ─── Status header ─────────────────────────────────────────
    statusHeader() {
        return (0, status_1.buildStatusHeader)({
            config: this.config,
            state: this.state,
            debugMode: this.debugMode,
            connectedBrowserName: this.connectedBrowserName,
            attachedTab: this.attachedTab,
            stealthMode: this.stealthMode,
            extensionServer: this.extensionServer,
        });
    }
    // ─── Tool listing ──────────────────────────────────────────
    async listTools() {
        log(`listTools() — state: ${this.state}`);
        const connectionTools = (0, schemas_1.getConnectionToolSchemas)();
        // Get browser tools from BrowserBridge (dummy transport, schema only)
        const BB = await getBrowserBridge();
        const dummyBridge = new BB(this.config, null);
        const browserTools = await dummyBridge.listTools();
        const debugTools = [];
        if (this.debugMode) {
            debugTools.push((0, schemas_1.getDebugToolSchema)());
        }
        return [...connectionTools, ...browserTools, ...debugTools];
    }
    // ─── Tool dispatch ─────────────────────────────────────────
    async callTool(name, rawArguments = {}, options = {}) {
        log(`callTool(${name}) — state: ${this.state}`);
        switch (name) {
            case 'enable':
                return await (0, handlers_1.onEnable)(this, rawArguments, options);
            case 'disable':
                return await (0, handlers_1.onDisable)(this, options);
            case 'status':
                return await (0, handlers_1.onStatus)(this, options);
            case 'experimental_features':
                return await (0, handlers_1.onExperimentalFeatures)(this, rawArguments, options);
            case 'reload_mcp':
                return (0, handlers_1.onReloadMCP)(this, options);
        }
        // Forward to active bridge
        if (!this.bridge) {
            if (options.rawResult) {
                return {
                    success: false,
                    error: 'not_enabled',
                    message: 'Browser automation not active. Call enable first.',
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `### ⚠️ Browser Automation Not Active\n\n**Current State:** Passive (disabled)\n\n**You must call \`enable\` first to activate browser automation.**`,
                    },
                ],
                isError: true,
            };
        }
        return await this.bridge.callTool(name, rawArguments, options);
    }
    // ─── Notify tools changed ──────────────────────────────────
    async notifyToolsListChanged() {
        if (this.server) {
            try {
                await this.server.sendToolsListChanged?.();
            }
            catch {
                // Client may not support this notification
            }
        }
    }
    // ─── Logging notifications ───────────────────────────────
    async sendLogNotification(level, message, logger) {
        if (this.server) {
            try {
                const hasMethod = typeof this.server.sendLoggingMessage === 'function';
                log(`sendLogNotification: hasMethod=${hasMethod}, level=${level}, logger=${logger || 'supersurf'}`);
                if (hasMethod) {
                    await this.server.sendLoggingMessage({
                        level,
                        logger: logger || 'supersurf',
                        data: message,
                    });
                    log('sendLogNotification: sent successfully');
                }
                else {
                    log('sendLogNotification: method not found on server instance');
                }
            }
            catch (err) {
                log('sendLogNotification error:', err?.message || err);
            }
        }
        else {
            log('sendLogNotification: no server instance');
        }
    }
    // ─── Public accessors for BrowserBridge to update state ────
    setAttachedTab(tab) {
        this.attachedTab = tab;
    }
    getAttachedTab() {
        return this.attachedTab;
    }
    clearAttachedTab() {
        this.attachedTab = null;
    }
    setConnectedBrowserName(name) {
        this.connectedBrowserName = name;
    }
    setStealthMode(enabled) {
        this.stealthMode = enabled;
    }
    // ─── Shutdown ──────────────────────────────────────────────
    async serverClosed() {
        log('Server closed');
        if (this.bridge) {
            this.bridge.serverClosed();
            this.bridge = null;
        }
        if (this.extensionServer) {
            await this.extensionServer.stop();
            this.extensionServer = null;
        }
        this.state = 'passive';
    }
}
exports.ConnectionManager = ConnectionManager;
//# sourceMappingURL=backend.js.map