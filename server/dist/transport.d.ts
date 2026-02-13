/**
 * Transport Layer — DirectTransport only (no proxy mode)
 */
import type { ExtensionServer } from './bridge';
export declare abstract class Transport {
    abstract sendCommand(method: string, params: Record<string, unknown>, timeout?: number): Promise<any>;
    abstract close(): Promise<void>;
}
export declare class DirectTransport extends Transport {
    private server;
    constructor(extensionServer: ExtensionServer);
    sendCommand(method: string, params: Record<string, unknown>, timeout?: number): Promise<any>;
    close(): Promise<void>;
}
//# sourceMappingURL=transport.d.ts.map