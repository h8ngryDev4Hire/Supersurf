/**
 * ConnectionManager — manages connection lifecycle.
 * States: passive → active → connected
 *
 * Delegates tool schemas to backend/schemas.ts, status formatting to
 * backend/status.ts, and handler logic to backend/handlers.ts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IExtensionTransport } from './bridge';
export type { BackendConfig, TabInfo, BackendState, ToolSchema } from './backend/types';
import type { BackendConfig, TabInfo, BackendState, ToolSchema, ConnectionManagerAPI } from './backend/types';
export declare class ConnectionManager implements ConnectionManagerAPI {
    config: BackendConfig;
    state: BackendState;
    bridge: any;
    extensionServer: IExtensionTransport | null;
    debugMode: boolean;
    clientId: string | null;
    connectedBrowserName: string | null;
    attachedTab: TabInfo | null;
    stealthMode: boolean;
    server: Server | null;
    clientInfo: Record<string, unknown>;
    constructor(config: BackendConfig);
    initialize(server: Server | null, clientInfo: Record<string, unknown>): Promise<void>;
    statusHeader(): string;
    listTools(): Promise<ToolSchema[]>;
    callTool(name: string, rawArguments?: Record<string, unknown>, options?: {
        rawResult?: boolean;
    }): Promise<any>;
    notifyToolsListChanged(): Promise<void>;
    sendLogNotification(level: string, message: string, logger?: string): Promise<void>;
    setAttachedTab(tab: TabInfo | null): void;
    getAttachedTab(): TabInfo | null;
    clearAttachedTab(): void;
    setConnectedBrowserName(name: string): void;
    setStealthMode(enabled: boolean): void;
    serverClosed(): Promise<void>;
}
//# sourceMappingURL=backend.d.ts.map