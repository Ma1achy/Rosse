/**
 * Vector drawings: packs every record in assets/drawings/vector/*.json (lines, dots, blobs) into
 * shared segment, dot and blob buffers with a per-drawing range table, for GPU expansion into pen
 * ribbons at the drawing's pen weight (ADR 0006; spike in spikes/vector-lines/).
 */
export {};
