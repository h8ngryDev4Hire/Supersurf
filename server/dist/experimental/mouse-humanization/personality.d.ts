/**
 * MousePersonality — per-session behavioral fingerprint.
 * Seeded once per session to maintain consistent characteristics.
 */
export interface MousePersonality {
    /** Multiplier on base velocity (0.7 = slower, 1.3 = faster) */
    speedMultiplier: number;
    /** Tendency to overshoot (0 = never, 1 = always when above threshold) */
    overshootTendency: number;
    /** Curvature bias — how much the path bows (0.5 = neutral, 0 = straight, 1 = very curved) */
    curvatureBias: number;
    /** Jitter magnitude in px — micro-tremor on waypoints */
    jitterPx: number;
}
/**
 * Generate a random personality within human-plausible ranges.
 * Called once per session init.
 */
export declare function generatePersonality(): MousePersonality;
//# sourceMappingURL=personality.d.ts.map