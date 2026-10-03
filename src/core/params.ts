/**
 * Drawing parameters: the typed equivalent of the reference's `DEF` (app23.js:L11–19).
 *
 * Planned: a `Params` type, the defaults, and a split of every key into the cache tier it
 * invalidates (ADR 0010): model keys (shape of the galaxy), view keys (incl, az, pa, zoom) and
 * present keys (surface, plates, pen colour). The reference also uses hidden state (the camera at
 * first placement in `homeFor`, app23.js:L445); here it becomes explicit parameters
 * (`lensHome`, `overlayHome`), so a drawing is a pure function of its parameters (ADR 0008).
 */
export {};
