/**
 * Mouse humanization session orchestrator.
 * Manages per-session personality and cursor position, delegates path generation.
 */

import { BALABIT_PROFILE, type DistributionProfile } from './profile';
import { generatePersonality, type MousePersonality } from './personality';
import { generatePath, type Waypoint, type Viewport } from './generator';
import { createLog } from '../../logger';

const log = createLog('[Mouse]');

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

const sessions = new Map<string, HumanizationSession>();

/** Initialize a new humanization session with a random personality. */
export function initSession(sessionId: string, profile?: DistributionProfile): void {
  const personality = generatePersonality();
  sessions.set(sessionId, {
    personality,
    cursorX: 0,
    cursorY: 0,
    profile: profile ?? BALABIT_PROFILE,
  });
  log(`Session "${sessionId}" initialized — speed=${personality.speedMultiplier.toFixed(2)}, overshoot=${personality.overshootTendency.toFixed(2)}, curvature=${personality.curvatureBias.toFixed(2)}, jitter=${personality.jitterPx.toFixed(2)}px`);
}

/** Get a session, returns undefined if not initialized. */
export function getSession(sessionId: string): HumanizationSession | undefined {
  return sessions.get(sessionId);
}

/** Destroy a session on disable/disconnect. */
export function destroySession(sessionId: string): void {
  sessions.delete(sessionId);
  log(`Session "${sessionId}" destroyed`);
}

/**
 * Generate a humanized mouse movement path for a session.
 * Updates the session's cursor position to the target.
 */
export function generateMovement(
  sessionId: string,
  targetX: number,
  targetY: number,
  viewport: Viewport
): Waypoint[] {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`No humanization session for "${sessionId}"`);
  }

  const fromX = session.cursorX;
  const fromY = session.cursorY;
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const waypoints = generatePath(
    fromX,
    fromY,
    targetX,
    targetY,
    session.profile,
    session.personality,
    viewport
  );

  const overshoot = distance > session.profile.overshootThreshold;
  log(`Path (${fromX},${fromY})→(${targetX},${targetY}) dist=${Math.round(distance)}px waypoints=${waypoints.length} overshoot=${overshoot}`);

  // Update cursor position
  session.cursorX = targetX;
  session.cursorY = targetY;

  return waypoints;
}
