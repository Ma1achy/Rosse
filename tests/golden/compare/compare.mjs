// @ts-check
/**
 * Golden comparison entry point (`npm run golden`).
 *
 * M0: checks that the reference captures in tests/golden/reference/ are complete and match their
 * manifest (every ink image present, pixel hashes identical, no page errors). This catches LFS
 * checkouts that fetched pointers instead of images.
 *
 * From M2 this also renders every case with the new engine (WebGPU on SwiftShader and the CPU
 * engine) and applies the metric of docs/adr/0013-golden-image-metric.md; see ../README.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const dir = resolve(import.meta.dirname, '../reference');
const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No tests/golden/reference/manifest.json: run `npm run capture:reference` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let bad = 0;
for (const c of manifest.captures) {
  const file = join(dir, `${c.name}.ink.png`);
  try {
    const hash = createHash('sha256')
      .update(PNG.sync.read(readFileSync(file)).data)
      .digest('hex');
    if (hash !== c.inkPixelSha256) throw new Error('pixel hash differs from the manifest');
    if (c.pageErrors) throw new Error(`${c.pageErrors} page errors during capture`);
    for (const ext of ['plate.jpg', 'json'])
      if (!existsSync(join(dir, `${c.name}.${ext}`))) throw new Error(`missing .${ext}`);
  } catch (e) {
    bad++;
    console.error(`FAIL  ${c.name}: ${/** @type {Error} */ (e).message}`);
  }
}
console.log(
  `${manifest.captures.length - bad}/${manifest.captures.length} reference captures intact`,
);
console.log('Engine comparison arrives in milestone M2 (docs/roadmap.md).');
process.exit(bad ? 1 : 0);
