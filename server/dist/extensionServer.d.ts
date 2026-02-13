/**
 * Extension WebSocket Server
 * Listens on localhost for the browser extension to connect.
 * Adapted from Blueprint MCP (Apache 2.0)
 */
export declare class ExtensionServer {
    private _port;
    private _host;
    private _httpServer;
    private _wss;
    private _extensionWs;
    private _pendingRequests;
    private _browserType;
    private _buildTimestamp;
    private _pingInterval;
    onReconnect: (() => void) | null;
    onTabInfoUpdate: ((tabInfo: any) => void) | null;
    constructor(port?: number, host?: string);
    getBrowserType(): string;
    getBuildTimestamp(): string | null;
    start(): Promise<void>;
    private _handleMessage;
    sendCommand(method: string, params?: Record<string, unknown>, timeout?: number): Promise<unknown>;
    setClientId(clientId: string): void;
    isConnected(): boolean;
    stop(): Promise<void>;
}
//# sourceMappingURL=extensionServer.d.ts.map