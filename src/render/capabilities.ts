/**
 * What the page's engines draw, by milestone: the one place to switch a part on. Both engines
 * (WebGPU and the CPU engine of ADR 0011) report this record as `Engine.capabilities`, and the
 * page builds its controls, presets and links from it, so it never offers what is not drawn.
 *
 * - `merger`: the merger simulation, its tides, debris and shells (M8), wired in src/main.ts;
 * - `stars`: stars, artefacts, overlays and the sky (M7): off until M7's engine path is merged;
 * - `lens`: the lens (M9): off until M9's engine path is merged.
 *
 * M7 and M9 switch their flag on in the pull request that wires their drawing into the page.
 */
export interface Capabilities {
  stars: boolean;
  merger: boolean;
  lens: boolean;
}

export const CAPABILITIES: Readonly<Capabilities> = {
  stars: false,
  merger: true,
  lens: false,
};
