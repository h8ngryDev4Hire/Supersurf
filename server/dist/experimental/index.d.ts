/**
 * ExperimentRegistry — session-scoped feature flag registry for experimental features
 * Part of SuperSurf experimental features
 */
export { diffSnapshots, calculateConfidence, formatDiffSection } from './page-diffing';
export type { PageState, DiffResult } from './page-diffing';
import type { ToolSchema, ToolContext } from '../tools/types';
declare class ExperimentRegistry {
    private _enabled;
    enable(feature: string): void;
    disable(feature: string): void;
    isEnabled(feature: string): boolean;
    reset(): void;
    listAvailable(): string[];
    getStates(): Record<string, boolean>;
    isAvailable(feature: string): boolean;
}
export declare const experimentRegistry: ExperimentRegistry;
/**
 * Check if an infrastructure-level experiment (e.g. "multiplexer") is enabled via env var.
 * Infrastructure experiments are gated at startup, not session-toggleable.
 */
export declare function isInfraExperimentEnabled(feature: string, config: {
    enabledExperiments?: string[];
}): boolean;
/**
 * Pre-enable session features listed in the env var config.
 * Silently skips infra features (like "multiplexer") that aren't in AVAILABLE_EXPERIMENTS.
 */
export declare function applyInitialState(config: {
    enabledExperiments?: string[];
}): void;
/** Collect schemas from all experimental tool modules */
export declare function getExperimentalToolSchemas(): ToolSchema[];
/**
 * Try to dispatch a tool call to an experimental handler.
 * Returns the result if handled, or null if the tool name isn't experimental.
 */
export declare function callExperimentalTool(name: string, ctx: ToolContext, args: Record<string, unknown>, options: {
    rawResult?: boolean;
}): Promise<any | null>;
//# sourceMappingURL=index.d.ts.map