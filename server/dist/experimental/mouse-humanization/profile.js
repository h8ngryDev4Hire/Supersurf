"use strict";
/**
 * DistributionProfile — statistical parameters for mouse movement generation.
 * Hand-tuned from Balabit Mouse Dynamics dataset characteristics.
 * Designed to be swapped for dataset-driven profiles when BeCAPTCHA access arrives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BALABIT_PROFILE = void 0;
/**
 * BALABIT_PROFILE — hand-tuned defaults based on Balabit Mouse Dynamics dataset.
 * Represents typical human mouse movement characteristics.
 */
exports.BALABIT_PROFILE = {
    medianVelocity: 180,
    velocitySigma: 0.4,
    overshootThreshold: 200,
    overshootRange: [0.05, 0.15],
    sampleIntervalMs: [15, 50],
    controlPointSpread: 0.3,
    idleDriftPx: [2, 5],
    idleDriftIntervalSec: [10, 30],
};
//# sourceMappingURL=profile.js.map