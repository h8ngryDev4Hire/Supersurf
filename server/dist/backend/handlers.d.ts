/**
 * Connection-level tool handlers — enable, disable, status, experimental features, reload.
 */
import type { ConnectionManagerAPI } from './types';
export declare function onEnable(mgr: ConnectionManagerAPI, args?: Record<string, unknown>, options?: {
    rawResult?: boolean;
}): Promise<any>;
export declare function onDisable(mgr: ConnectionManagerAPI, options?: {
    rawResult?: boolean;
}): Promise<any>;
export declare function onStatus(mgr: ConnectionManagerAPI, options?: {
    rawResult?: boolean;
}): Promise<any>;
export declare function onExperimentalFeatures(mgr: ConnectionManagerAPI, args?: Record<string, unknown>, options?: {
    rawResult?: boolean;
}): Promise<any>;
export declare function onReloadMCP(mgr: ConnectionManagerAPI, options?: {
    rawResult?: boolean;
}): any;
//# sourceMappingURL=handlers.d.ts.map