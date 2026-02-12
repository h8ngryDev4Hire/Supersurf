/**
 * ExperimentRegistry — session-scoped feature flag registry for experimental features
 * Part of SuperSurf experimental features
 */

export { diffSnapshots, calculateConfidence, formatDiffSection } from './page-diffing';
export type { PageState, DiffResult } from './page-diffing';

const AVAILABLE_EXPERIMENTS = ['page_diffing', 'smart_waiting'] as const;
type ExperimentName = typeof AVAILABLE_EXPERIMENTS[number];

class ExperimentRegistry {
  private _enabled: Map<string, boolean> = new Map();

  enable(feature: string): void {
    if (!this.isAvailable(feature)) {
      throw new Error(`Unknown experiment: "${feature}". Available: ${AVAILABLE_EXPERIMENTS.join(', ')}`);
    }
    this._enabled.set(feature, true);
  }

  disable(feature: string): void {
    if (!this.isAvailable(feature)) {
      throw new Error(`Unknown experiment: "${feature}". Available: ${AVAILABLE_EXPERIMENTS.join(', ')}`);
    }
    this._enabled.set(feature, false);
  }

  isEnabled(feature: string): boolean {
    return this._enabled.get(feature) === true;
  }

  reset(): void {
    this._enabled.clear();
  }

  listAvailable(): string[] {
    return [...AVAILABLE_EXPERIMENTS];
  }

  getStates(): Record<string, boolean> {
    const states: Record<string, boolean> = {};
    for (const exp of AVAILABLE_EXPERIMENTS) {
      states[exp] = this.isEnabled(exp);
    }
    return states;
  }

  isAvailable(feature: string): boolean {
    return (AVAILABLE_EXPERIMENTS as readonly string[]).includes(feature);
  }
}

export const experimentRegistry = new ExperimentRegistry();

/**
 * Check if an infrastructure-level experiment (e.g. "multiplexer") is enabled via env var.
 * Infrastructure experiments are gated at startup, not session-toggleable.
 */
export function isInfraExperimentEnabled(
  feature: string,
  config: { enabledExperiments?: string[] }
): boolean {
  if (!config.enabledExperiments) return false;
  return config.enabledExperiments.includes(feature);
}

/**
 * Pre-enable session features listed in the env var config.
 * Silently skips infra features (like "multiplexer") that aren't in AVAILABLE_EXPERIMENTS.
 */
export function applyInitialState(config: { enabledExperiments?: string[] }): void {
  if (!config.enabledExperiments) return;
  for (const feature of config.enabledExperiments) {
    if (experimentRegistry.isAvailable(feature)) {
      experimentRegistry.enable(feature);
    }
  }
}
