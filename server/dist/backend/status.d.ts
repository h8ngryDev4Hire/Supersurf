/**
 * Status header builder — pure function, no side effects.
 */
import type { BackendConfig, BackendState, TabInfo } from './types';
import type { IExtensionTransport } from '../bridge';
interface StatusInput {
    config: BackendConfig;
    state: BackendState;
    debugMode: boolean;
    connectedBrowserName: string | null;
    attachedTab: TabInfo | null;
    stealthMode: boolean;
    extensionServer: IExtensionTransport | null;
}
export declare function buildStatusHeader(input: StatusInput): string;
export {};
//# sourceMappingURL=status.d.ts.map