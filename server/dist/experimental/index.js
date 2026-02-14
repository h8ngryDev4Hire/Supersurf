"use strict";
/**
 * ExperimentRegistry — session-scoped feature flag registry for experimental features
 * Part of SuperSurf experimental features
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.experimentRegistry = exports.formatDiffSection = exports.calculateConfidence = exports.diffSnapshots = void 0;
exports.isInfraExperimentEnabled = isInfraExperimentEnabled;
exports.applyInitialState = applyInitialState;
exports.getExperimentalToolSchemas = getExperimentalToolSchemas;
exports.callExperimentalTool = callExperimentalTool;
var page_diffing_1 = require("./page-diffing");
Object.defineProperty(exports, "diffSnapshots", { enumerable: true, get: function () { return page_diffing_1.diffSnapshots; } });
Object.defineProperty(exports, "calculateConfidence", { enumerable: true, get: function () { return page_diffing_1.calculateConfidence; } });
Object.defineProperty(exports, "formatDiffSection", { enumerable: true, get: function () { return page_diffing_1.formatDiffSection; } });
const storage_inspection_1 = require("./storage-inspection");
const AVAILABLE_EXPERIMENTS = ['page_diffing', 'smart_waiting', 'storage_inspection', 'mouse_humanization'];
class ExperimentRegistry {
    _enabled = new Map();
    enable(feature) {
        if (!this.isAvailable(feature)) {
            throw new Error(`Unknown experiment: "${feature}". Available: ${AVAILABLE_EXPERIMENTS.join(', ')}`);
        }
        this._enabled.set(feature, true);
    }
    disable(feature) {
        if (!this.isAvailable(feature)) {
            throw new Error(`Unknown experiment: "${feature}". Available: ${AVAILABLE_EXPERIMENTS.join(', ')}`);
        }
        this._enabled.set(feature, false);
    }
    isEnabled(feature) {
        return this._enabled.get(feature) === true;
    }
    reset() {
        this._enabled.clear();
    }
    listAvailable() {
        return [...AVAILABLE_EXPERIMENTS];
    }
    getStates() {
        const states = {};
        for (const exp of AVAILABLE_EXPERIMENTS) {
            states[exp] = this.isEnabled(exp);
        }
        return states;
    }
    isAvailable(feature) {
        return AVAILABLE_EXPERIMENTS.includes(feature);
    }
}
exports.experimentRegistry = new ExperimentRegistry();
/**
 * Check if an infrastructure-level experiment (e.g. "multiplexer") is enabled via env var.
 * Infrastructure experiments are gated at startup, not session-toggleable.
 */
function isInfraExperimentEnabled(feature, config) {
    if (!config.enabledExperiments)
        return false;
    return config.enabledExperiments.includes(feature);
}
/**
 * Pre-enable session features listed in the env var config.
 * Silently skips infra features (like "multiplexer") that aren't in AVAILABLE_EXPERIMENTS.
 */
function applyInitialState(config) {
    if (!config.enabledExperiments)
        return;
    for (const feature of config.enabledExperiments) {
        if (exports.experimentRegistry.isAvailable(feature)) {
            exports.experimentRegistry.enable(feature);
        }
    }
}
// ─── Experimental tool dispatch ───────────────────────────────
/** Collect schemas from all experimental tool modules */
function getExperimentalToolSchemas() {
    return [storage_inspection_1.storageInspectionSchema];
}
/**
 * Try to dispatch a tool call to an experimental handler.
 * Returns the result if handled, or null if the tool name isn't experimental.
 */
async function callExperimentalTool(name, ctx, args, options) {
    switch (name) {
        case 'browser_storage':
            return await (0, storage_inspection_1.onBrowserStorage)(ctx, args, options);
        default:
            return null;
    }
}
//# sourceMappingURL=index.js.map