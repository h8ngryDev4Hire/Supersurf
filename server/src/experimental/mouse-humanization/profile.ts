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
export const BALABIT_PROFILE: DistributionProfile = {
  medianVelocity: 180,
  velocitySigma: 0.4,
  overshootThreshold: 200,
  overshootRange: [0.05, 0.15],
  sampleIntervalMs: [15, 50],
  controlPointSpread: 0.3,
  idleDriftPx: [2, 5],
  idleDriftIntervalSec: [10, 30],
};
