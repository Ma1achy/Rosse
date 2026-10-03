import { describe, expect, it } from 'vitest';

/**
 * Smoke test for the skeleton: the module graph loads. Real tests arrive with each milestone
 * (docs/roadmap.md), starting with the RNG's shared CPU/GPU vectors in M1.
 */
describe('skeleton', () => {
  it('loads the core module', async () => {
    const core = await import('../../src/core/index');
    expect(core).toBeTypeOf('object');
  });
});
