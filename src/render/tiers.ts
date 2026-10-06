/**
 * Tier invalidation (ADR 0010), driven by the parameter schema's tier tags.
 *
 * A frame's inputs are the parameters, the zoom (page state, a view input) and an optional extra
 * model key (the golden runner's hand and placement key). Going from the last inputs to the next,
 * `dirtyTier` (src/core/schema.ts) reads each changed parameter's tier: a model parameter, or an
 * inclination change after which the structure signature changes (`structureKey`, ADR 0017),
 * rebuilds the model tier and everything after it; a view
 * parameter or the zoom re-runs only the view tier (projection, culls, compaction, CPU-placed
 * parts). Present inputs (surface, size) are the caller's: they never reach here.
 *
 * Both engines run their stages through `TierState.run`, so the page, the tests and the CPU
 * engine share one rule.
 */
import type { Params } from '../core/params';
import { dirtyTier } from '../core/schema';

export interface TierInputs {
  P: Params;
  zoom: number;
  /** anything else the model depends on (compared as a string) */
  modelKey?: string;
}

export interface TierWork {
  model: boolean;
  view: boolean;
}

/** What has to be rebuilt to go from `a` to `b` (everything when there is no `a`). */
export function tierWork(a: TierInputs | null, b: TierInputs): TierWork {
  if (!a || (a.modelKey ?? '') !== (b.modelKey ?? '')) return { model: true, view: true };
  const t = dirtyTier(a.P, b.P);
  const model = t === 'model';
  const view = model || t === 'view' || a.zoom !== b.zoom;
  return { model, view };
}

export class TierState {
  private last: TierInputs | null = null;
  /** how many times each tier has run (tests and the page's statistics) */
  readonly runs = { model: 0, view: 0 };

  /**
   * Runs the stages the change from the last inputs needs, in order (model, then view). A stage
   * that throws leaves the state invalid, so the next call rebuilds everything.
   */
  run(next: TierInputs, stages: { model: () => void; view: () => void }): TierWork {
    const w = tierWork(this.last, next);
    this.last = null;
    if (w.model) {
      stages.model();
      this.runs.model++;
    }
    if (w.view) {
      stages.view();
      this.runs.view++;
    }
    this.last = { ...next };
    return w;
  }

  /** Forget the last inputs (a new device, or the model's resources were dropped). */
  invalidate(): void {
    this.last = null;
  }
}
