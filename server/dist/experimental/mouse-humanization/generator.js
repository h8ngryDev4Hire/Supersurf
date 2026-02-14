"use strict";
/**
 * Path generator — cubic Bezier trajectories with overshoot correction.
 * Produces waypoint arrays for the extension to replay via CDP Input.dispatchMouseEvent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePath = generatePath;
/**
 * Generate a human-like mouse path from (fromX, fromY) to (toX, toY).
 */
function generatePath(fromX, fromY, toX, toY, profile, personality, viewport) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Micro-correction: distance < 5px → single waypoint
    if (distance < 5) {
        return [{ x: clampX(toX, viewport), y: clampY(toY, viewport), delayMs: randomInterval(profile) }];
    }
    // Calculate duration from distance and velocity with log-normal noise
    const velocity = profile.medianVelocity * personality.speedMultiplier * logNormalNoise(profile.velocitySigma);
    const durationMs = Math.max(50, (distance / velocity) * 1000);
    // Decide whether to overshoot
    const shouldOvershoot = distance > profile.overshootThreshold &&
        Math.random() < personality.overshootTendency;
    let waypoints;
    if (shouldOvershoot) {
        // Two-segment path: arc past target, then correction arc back
        const overshootFraction = profile.overshootRange[0] +
            Math.random() * (profile.overshootRange[1] - profile.overshootRange[0]);
        // Overshoot point — extend past target along movement vector with perpendicular offset
        const overshootDist = distance * overshootFraction;
        const angle = Math.atan2(dy, dx);
        const perpAngle = angle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const perpOffset = overshootDist * 0.3 * (Math.random() - 0.5);
        const overshootX = toX + Math.cos(angle) * overshootDist + Math.cos(perpAngle) * perpOffset;
        const overshootY = toY + Math.sin(angle) * overshootDist + Math.sin(perpAngle) * perpOffset;
        // First arc: from → overshoot (70% of duration)
        const arc1Duration = durationMs * 0.7;
        const arc1 = sampleBezier(fromX, fromY, overshootX, overshootY, profile, personality, arc1Duration, viewport);
        // Second arc: overshoot → target (30% of duration)
        const arc2Duration = durationMs * 0.3;
        const arc2 = sampleBezier(overshootX, overshootY, toX, toY, profile, personality, arc2Duration, viewport);
        waypoints = [...arc1, ...arc2];
    }
    else {
        // Single cubic Bezier
        waypoints = sampleBezier(fromX, fromY, toX, toY, profile, personality, durationMs, viewport);
    }
    // Ensure the last waypoint is exactly the target
    if (waypoints.length > 0) {
        const last = waypoints[waypoints.length - 1];
        last.x = clampX(toX, viewport);
        last.y = clampY(toY, viewport);
    }
    return waypoints;
}
/**
 * Sample points along a cubic Bezier curve with control points on the same side
 * of the movement vector (natural hand arc).
 */
function sampleBezier(x0, y0, x1, y1, profile, personality, durationMs, viewport) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Control points perpendicular to movement vector, same side
    const perpX = -dy;
    const perpY = dx;
    const spread = profile.controlPointSpread * personality.curvatureBias;
    const side = Math.random() < 0.5 ? 1 : -1;
    const cp1x = x0 + dx * 0.33 + perpX * spread * side * (0.5 + Math.random() * 0.5);
    const cp1y = y0 + dy * 0.33 + perpY * spread * side * (0.5 + Math.random() * 0.5);
    const cp2x = x0 + dx * 0.66 + perpX * spread * side * (0.5 + Math.random() * 0.5);
    const cp2y = y0 + dy * 0.66 + perpY * spread * side * (0.5 + Math.random() * 0.5);
    // Sample at irregular intervals
    const waypoints = [];
    let elapsed = 0;
    while (elapsed < durationMs) {
        const interval = randomInterval(profile);
        elapsed += interval;
        if (elapsed >= durationMs)
            break;
        const t = elapsed / durationMs;
        const point = cubicBezier(t, x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1);
        // Apply jitter
        const jx = (Math.random() - 0.5) * 2 * personality.jitterPx;
        const jy = (Math.random() - 0.5) * 2 * personality.jitterPx;
        waypoints.push({
            x: clampX(point.x + jx, viewport),
            y: clampY(point.y + jy, viewport),
            delayMs: interval,
        });
    }
    // Final point at t=1
    waypoints.push({
        x: clampX(x1, viewport),
        y: clampY(y1, viewport),
        delayMs: Math.max(5, durationMs - elapsed),
    });
    return waypoints;
}
/** Evaluate cubic Bezier at parameter t */
function cubicBezier(t, x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1) {
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x: u3 * x0 + 3 * u2 * t * cp1x + 3 * u * t2 * cp2x + t3 * x1,
        y: u3 * y0 + 3 * u2 * t * cp1y + 3 * u * t2 * cp2y + t3 * y1,
    };
}
/** Random interval from profile's sample range */
function randomInterval(profile) {
    const [min, max] = profile.sampleIntervalMs;
    return min + Math.random() * (max - min);
}
/** Log-normal noise around 1.0 with given sigma */
function logNormalNoise(sigma) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
    return Math.exp(z * sigma);
}
function clampX(x, viewport) {
    return Math.max(0, Math.min(Math.round(x), viewport.width - 1));
}
function clampY(y, viewport) {
    return Math.max(0, Math.min(Math.round(y), viewport.height - 1));
}
//# sourceMappingURL=generator.js.map