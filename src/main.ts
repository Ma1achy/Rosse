/**
 * Entry point of the page.
 *
 * Planned flow (docs/architecture.md, "Frame"): check for WebGPU (and fall back as ADR 0011
 * describes), create the device (gpu/device.ts), load the drawings (marks/), build the model for
 * the current parameters (core/, model/, sim/), then render on each camera or parameter change
 * through the three cache tiers of ADR 0010.
 *
 * Not implemented yet: this is the repository skeleton (milestone M0).
 */
export {};
