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
/**
 * WebSocket server that bridges the daemon to the Chrome extension.
 * Manages a single active connection, with reconnection support.
 */
export declare class ExtensionBridge {
    private port;
    private host;
    private httpServer;
    private wss;
    private socket;
    private inflight;
    private browserType;
    private buildTimestamp;
    private pingInterval;
    onReconnect: (() => void) | null;
    onTabInfoUpdate: ((tabInfo: any) => void) | null;
    constructor(port?: number, host?: string);
    get browser(): string;
    get buildTime(): string | null;
    get connected(): boolean;
    /** Spin up the HTTP + WebSocket server and begin accepting connections. */
    start(): Promise<void>;
    /** Route incoming WebSocket messages: responses, handshakes, or notifications. */
    private handleMessage;
    /**
     * Send a JSON-RPC 2.0 request to the extension and await the response.
     * @param method - Command name
     * @param params - Command parameters
     * @param timeout - Max wait time in ms (default 30s)
     */
    sendCmd(method: string, params?: Record<string, unknown>, timeout?: number): Promise<any>;
    /** Send an `authenticated` notification to the extension with a session's client ID. */
    notifyClientId(clientId: string): void;
    /** Reject all pending requests with a disconnect error. */
    private drainInflight;
    /** Gracefully shut down: clear ping interval, close socket, close servers. */
    stop(): Promise<void>;
}
//# sourceMappingURL=extension-bridge.d.ts.map