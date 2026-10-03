// Deterministic prefix sum (work-group scan plus block offsets), used for every compaction so
// output order depends only on input order, never on scheduling (ADR 0004).
