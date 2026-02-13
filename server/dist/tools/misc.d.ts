/**
 * Miscellaneous tool handlers — window, dialog, evaluate, verify, extensions, performance.
 */
import type { ToolContext } from './types';
export declare function onWindow(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onDialog(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onEvaluate(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onVerifyTextVisible(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onVerifyElementVisible(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onListExtensions(ctx: ToolContext, options: any): Promise<any>;
export declare function onReloadExtensions(ctx: ToolContext, args: any, options: any): Promise<any>;
export declare function onPerformanceMetrics(ctx: ToolContext, options: any): Promise<any>;
//# sourceMappingURL=misc.d.ts.map