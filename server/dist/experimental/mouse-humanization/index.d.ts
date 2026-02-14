/**
 * Mouse humanization session orchestrator.
 * Manages per-session personality and cursor position, delegates path generation.
 */
import { type DistributionProfile } from './profile';
import { type MousePersonality } from './personality';
import { type Waypoint, type Viewport } from './generator';
export type { DistributionProfile } from './profile';
export type { MousePersonality } from './personality';
export type { Waypoint, Viewport } from './generator';
export { BALABIT_PROFILE } from './profile';
export { generatePersonality } from './personality';
export { generatePath } from './generator';
interface HumanizationSession {
    personality: MousePersonality;
    cursorX: number;
    cursorY: number;
    profile: DistributionProfile;
}
/** Initialize a new humanization session with a random personality. */
export declare function initSession(sessionId: string, profile?: DistributionProfile): void;
/** Get a session, returns undefined if not initialized. */
export declare function getSession(sessionId: string): HumanizationSession | undefined;
/** Destroy a session on disable/disconnect. */
export declare function destroySession(sessionId: string): void;
/**
 * Generate a humanized mouse movement path for a session.
 * Updates the session's cursor position to the target.
 */
export declare function generateMovement(sessionId: string, targetX: number, targetY: number, viewport: Viewport): Waypoint[];
//# sourceMappingURL=index.d.ts.map