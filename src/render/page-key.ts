/**
 * The key of the model tier of a merger or of simulated shells as the page draws them: every
 * parameter except the view tier's (the camera, `mTime`, the winding) and the present tier's
 * (`plates`), which the engines apply to what is built (src/render/merger.ts `view`, ADR 0010). A
 * change of any other parameter rebuilds (re-integrates) the merger; a change of these does not.
 */
import type { Params } from '../core/params';

const NOT_MODEL = new Set<string>(['az', 'incl', 'pa', 'winding', 'mTime', 'plates']);

export function pageModelKey(P: Params): string {
  return JSON.stringify(Object.entries(P).filter(([k]) => !NOT_MODEL.has(k)));
}
