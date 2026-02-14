"use strict";
/**
 * MousePersonality — per-session behavioral fingerprint.
 * Seeded once per session to maintain consistent characteristics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePersonality = generatePersonality;
/**
 * Generate a random personality within human-plausible ranges.
 * Called once per session init.
 */
function generatePersonality() {
    return {
        speedMultiplier: 0.7 + Math.random() * 0.6, // 0.7–1.3
        overshootTendency: 0.3 + Math.random() * 0.5, // 0.3–0.8
        curvatureBias: 0.3 + Math.random() * 0.4, // 0.3–0.7
        jitterPx: 0.5 + Math.random() * 1.5, // 0.5–2.0
    };
}
//# sourceMappingURL=personality.js.map