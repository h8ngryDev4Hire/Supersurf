/**
 * BrowserBridge — orchestrator for browser tool dispatch.
 * Owns CDP/eval helpers and delegates tool execution to modular handlers in tools/.
 */
import type { IExtensionTransport } from './bridge';
import type { ToolSchema } from './tools/types';
export declare class BrowserBridge {
    private config;
    private ext;
    private server;
    private clientInfo;
    private connectionManager;
    constructor(config: any, ext: IExtensionTransport | null);
    initialize(server: any, clientInfo: any, connectionManager?: any): Promise<void>;
    serverClosed(): void;
    /** Build the context object that tool handlers receive */
    private get ctx();
    /** Send a CDP command through the extension's forwardCDPCommand handler */
    private cdp;
    /** Evaluate JS expression in page context, return by value */
    private evalExpr;
    /** Sleep for specified ms */
    private sleep;
    /** Get center coordinates of an element by selector, with "Did you mean?" hints on failure */
    private getElementCenter;
    /** Search for alternative elements when a selector fails */
    private findAlternativeSelectors;
    /** Convert selector string to JS querySelector expression, handling :has-text() */
    private getSelectorExpression;
    listTools(): Promise<ToolSchema[]>;
    callTool(name: string, args?: Record<string, unknown>, options?: {
        rawResult?: boolean;
    }): Promise<any>;
    private formatResult;
    private error;
}
//# sourceMappingURL=tools.d.ts.map