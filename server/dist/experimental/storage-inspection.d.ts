/**
 * Storage Inspection — experimental tool for reading/writing browser storage.
 * Self-contained: schema, handler, and experiment gate.
 */
import type { ToolSchema, ToolContext } from '../tools/types';
export declare const storageInspectionSchema: ToolSchema;
export declare function onBrowserStorage(ctx: ToolContext, args: Record<string, unknown>, options?: {
    rawResult?: boolean;
}): Promise<any>;
//# sourceMappingURL=storage-inspection.d.ts.map