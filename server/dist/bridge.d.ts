/**
 * WebSocket bridge to the Chrome extension.
 * Listens on localhost, speaks JSON-RPC 2.0.
 */
import http from 'http';
import { WebSocket } from 'ws';
export interface IExtensionTransport {
    sendCmd(method: string, params?: Record<string, unknown>, timeout?: number): Promise<any>;
    readonly connected: boolean;
    readonly browser: string;
    readonly buildTime: string | null;
    onReconnect: (() => void) | null;
    onTabInfoUpdate: ((tabInfo: any) => void) | null;
    notifyClientId(clientId: string): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export declare class ExtensionServer implements IExtensionTransport {
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
    onRawConnection: ((ws: WebSocket, request: http.IncomingMessage) => boolean) | null;
    constructor(port?: number, host?: string);
    get browser(): string;
    get buildTime(): string | null;
    get connected(): boolean;
    start(): Promise<void>;
    private handleMessage;
    sendCmd(method: string, params?: Record<string, unknown>, timeout?: number): Promise<any>;
    notifyClientId(clientId: string): void;
    stop(): Promise<void>;
}
//# sourceMappingURL=bridge.d.ts.map