/**
 * DistributionProfile — statistical parameters for mouse movement generation.
 * Hand-tuned from Balabit Mouse Dynamics dataset characteristics.
 * Designed to be swapped for dataset-driven profiles when BeCAPTCHA access arrives.
 */
export interface DistributionProfile {
    /** Median cursor velocity in px/sec */
    medianVelocity: number;
    /** Velocity log-normal sigma (spread around median) */
    velocitySigma: number;
    /** Distance threshold (px) above which overshoot is applied */
    overshootThreshold: number;
    /** Overshoot range as fraction of target distance [min, max] */
    overshootRange: [number, number];
    /** Time between waypoint samples in ms [min, max] */
    sampleIntervalMs: [number, number];
    /** Bezier control point spread factor — controls curvature */
    controlPointSpread: number;
    /** Idle drift magnitude in px [min, max] */
    idleDriftPx: [number, number];
    /** Idle drift interval in seconds [min, max] */
    idleDriftIntervalSec: [number, number];
}
/**
 * BALABIT_PROFILE — hand-tuned defaults based on Balabit Mouse Dynamics dataset.
 * Represents typical human mouse movement characteristics.
 */
export declare const BALABIT_PROFILE: DistributionProfile;
//# sourceMappingURL=profile.d.ts.map