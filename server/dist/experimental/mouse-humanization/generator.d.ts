/**
 * Path generator — cubic Bezier trajectories with overshoot correction.
 * Produces waypoint arrays for the extension to replay via CDP Input.dispatchMouseEvent.
 */
import type { DistributionProfile } from './profile';
import type { MousePersonality } from './personality';
export interface Waypoint {
    x: number;
    y: number;
    /** Delay in ms before dispatching this waypoint */
    delayMs: number;
}
export interface Viewport {
    width: number;
    height: number;
}
/**
 * Generate a human-like mouse path from (fromX, fromY) to (toX, toY).
 */
export declare function generatePath(fromX: number, fromY: number, toX: number, toY: number, profile: DistributionProfile, personality: MousePersonality, viewport: Viewport): Waypoint[];
//# sourceMappingURL=generator.d.ts.map