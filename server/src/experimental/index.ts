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

  private isAvailable(feature: string): boolean {
    return (AVAILABLE_EXPERIMENTS as readonly string[]).includes(feature);
  }
}

export const experimentRegistry = new ExperimentRegistry();
