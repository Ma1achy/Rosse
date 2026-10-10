/** The galaxy's own perspective (ADR 0084): `depthAuto` 0 is the orthographic galaxy, 1 scales marks by depth. */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA, tierOf } from '../../src/core/schema';
import { runProject } from '../../src/fallback/kernels/project';
import { runStipple } from '../../src/fallback/kernels/stipple';
import { buildScene } from '../../src/model/scene';
import { GALAXY_PERSP, cameraOf, perspOf, viewDesc } from '../../src/view/camera';
import { META } from './support/vectors';

const P0 = presetParams('Grand design', 7, { incl: 62, field: 0, fgstars: 0 });
const galaxy = buildScene(P0, META).galaxy;
const samples = runStipple(galaxy);

const project = (persp: number) =>
  runProject(viewDesc(cameraOf(P0), galaxy.g.dust, samples.n, samples.n, persp), samples);

describe('depthAuto', () => {
  it('is a view-tier choice, off in the core', () => {
    expect(DEF.depthAuto).toBe(0);
    expect(SCHEMA.depthAuto).toMatchObject({ kind: 'choice' });
    expect(tierOf('depthAuto')).toBe('view');
    expect(perspOf(P0)).toBe(0);
    expect(perspOf({ depthAuto: 1 })).toBe(-GALAXY_PERSP);
    expect(perspOf({ depthAuto: 2 })).toBe(GALAXY_PERSP);
  });

  it('changes nothing with persp 0 (the orthographic galaxy, bit for bit)', () => {
    const a = project(0);
    const b = runProject(viewDesc(cameraOf(P0), galaxy.g.dust, samples.n, samples.n), samples);
    expect(Array.from(a.f32)).toEqual(Array.from(b.f32));
  });

  it('draws the near side of a tilted disc larger than the far side', () => {
    const o = project(0);
    const p = project(GALAXY_PERSP);
    // the instance's size is its matrix's first column; compare marks by their plate y
    let near = 0;
    let nn = 0;
    let far = 0;
    let nf = 0;
    for (let i = 0; i < samples.n; i++) {
      if ((o.classes[i] ?? 0) === 0 || (p.classes[i] ?? 0) === 0) continue;
      const so = Math.hypot(o.f32[i * 8 + 4] ?? 0, o.f32[i * 8 + 5] ?? 0);
      const sp = Math.hypot(p.f32[i * 8 + 4] ?? 0, p.f32[i * 8 + 5] ?? 0);
      if (!so) continue;
      const y = o.f32[i * 8 + 1] ?? 0;
      if (y > 450) {
        near += sp / so;
        nn++;
      } else if (y < 350) {
        far += sp / so;
        nf++;
      }
    }
    expect(nn).toBeGreaterThan(50);
    expect(nf).toBeGreaterThan(50);
    expect(near / nn).toBeGreaterThan(1.03);
    expect(far / nf).toBeLessThan(0.97);
  });

  it('with the marks only, keeps the positions and shrinks the far marks', () => {
    const o = project(0);
    const p = project(-GALAXY_PERSP);
    let moved = 0;
    let shrunk = 0;
    let n = 0;
    for (let i = 0; i < samples.n; i++) {
      if ((o.classes[i] ?? 0) === 0 || (p.classes[i] ?? 0) === 0) continue;
      n++;
      if (o.f32[i * 8] !== p.f32[i * 8] || o.f32[i * 8 + 1] !== p.f32[i * 8 + 1]) moved++;
      if (
        Math.hypot(p.f32[i * 8 + 4] ?? 0, p.f32[i * 8 + 5] ?? 0) <
        Math.hypot(o.f32[i * 8 + 4] ?? 0, o.f32[i * 8 + 5] ?? 0)
      )
        shrunk++;
    }
    expect(moved).toBe(0);
    expect(shrunk / n).toBeGreaterThan(0.2);
  });

  it('shrinks the marks as the view zooms out, and not when it zooms in', () => {
    const at = (zoom: number) => {
      const cam = { ...cameraOf(P0), zoom };
      const r = runProject(
        viewDesc(cam, galaxy.g.dust, samples.n, samples.n, -GALAXY_PERSP),
        samples,
      );
      let s = 0;
      let n = 0;
      for (let i = 0; i < samples.n; i++)
        if ((r.classes[i] ?? 0) !== 0) {
          s += Math.hypot(r.f32[i * 8 + 4] ?? 0, r.f32[i * 8 + 5] ?? 0);
          n++;
        }
      return s / n;
    };
    expect(at(0.3)).toBeLessThan(0.8 * at(1));
    expect(at(2)).toBeGreaterThanOrEqual(at(1) * 0.99);
  });
});
