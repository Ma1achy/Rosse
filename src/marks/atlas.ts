/**
 * Bitmap drawings (ADR 0006): the sheets in assets/drawings/bitmap/, packed by tools/pack-atlas
 * into assets-built/ as one r8 layer per drawing with its own mip chain, so cells never bleed
 * into each other. This module reads that data (plain bytes, shared by the GPU and the CPU
 * fallback) and uploads it into `texture_2d_array` textures (r8unorm) with every mip level.
 *
 * A sheet with more layers than the device allows in one array (`pieces`: 638, against a default
 * `maxTextureArrayLayers` of 256) is split into several arrays; gpu/device.ts asks for the
 * adapter's own limit, so on most adapters one array is enough.
 */

/** Ink-edge thresholds of the reference's fragment shader (app23.js:L1124): smoothstep(lo, hi, t). */
export const INK_EDGE: readonly [number, number] = [0.12, 0.55];
/** The thresholds for MAGNIFIED atlases (whole drawings drawn large; app23.js:L1099). */
export const INK_EDGE_MAGNIFIED: readonly [number, number] = [0.46, 0.62];
/** The reference's MAGNIFIED set (app23.js:L1099). None of the bitmap sheets is in it. */
export const MAGNIFIED: ReadonlySet<string> = new Set([
  'arms',
  'whole',
  'env',
  'rings',
  'bars',
  'arcs',
  'shells',
  'trails',
  'penlines',
  'companions',
  'misc',
  'sstars',
]);

export function inkEdge(atlas: string): readonly [number, number] {
  return MAGNIFIED.has(atlas) ? INK_EDGE_MAGNIFIED : INK_EDGE;
}

export type AtlasName = 'dots' | 'knots' | 'stars' | 'cores' | 'fgstars' | 'pieces' | 'strokes';

export interface LevelEntry {
  width: number;
  height: number;
  /** byte offset of the level in the atlas file */
  offset: number;
  /** layers × width × height */
  byteLength: number;
}

export interface AtlasEntry {
  file: string;
  cellWidth: number;
  cellHeight: number;
  layers: number;
  cols: number;
  repeatU: boolean;
  levels: LevelEntry[];
  source: string;
  sha256: string;
}

export interface SurfaceEntry {
  file: string;
  width: number;
  height: number;
  format: 'rgba8unorm';
  source: string;
  sha256: string;
}

/** assets-built/index.json */
export interface BuiltIndex {
  packer: number;
  sourceHash: string;
  atlases: Record<AtlasName, AtlasEntry>;
  surfaces: { paper: SurfaceEntry };
}

/** One atlas in memory: every level, each `layers × width × height` bytes of ink (alpha). */
export interface AtlasData {
  name: string;
  layers: number;
  repeatU: boolean;
  edge: readonly [number, number];
  levels: { width: number; height: number; data: Uint8Array<ArrayBuffer> }[];
}

/** The paper texture, RGBA8. */
export interface ImageData8 {
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
}

/** Splits an atlas from its file bytes. */
export function atlasFromBytes(
  name: string,
  entry: AtlasEntry,
  bytes: Uint8Array<ArrayBuffer>,
): AtlasData {
  return {
    name,
    layers: entry.layers,
    repeatU: entry.repeatU,
    edge: inkEdge(name),
    levels: entry.levels.map((l) => {
      if (l.offset + l.byteLength > bytes.length) throw new Error(`atlas ${name}: file too short`);
      return {
        width: l.width,
        height: l.height,
        data: bytes.subarray(l.offset, l.offset + l.byteLength),
      };
    }),
  };
}

/** Fetches assets-built data: `base` is the URL of the assets-built directory, with a trailing /. */
export class BuiltAssets {
  private constructor(
    readonly base: string,
    readonly index: BuiltIndex,
  ) {}

  static async load(base: string): Promise<BuiltAssets> {
    const res = await fetch(`${base}index.json`);
    if (!res.ok)
      throw new Error(
        `assets-built/index.json: ${String(res.status)} (run npm run prepare-assets)`,
      );
    return new BuiltAssets(base, (await res.json()) as BuiltIndex);
  }

  private async bytes(file: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await fetch(`${this.base}${file}`);
    if (!res.ok) throw new Error(`${file}: ${String(res.status)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async atlas(name: AtlasName): Promise<AtlasData> {
    const entry = this.index.atlases[name];
    return atlasFromBytes(name, entry, await this.bytes(entry.file));
  }

  async paper(): Promise<ImageData8> {
    const e = this.index.surfaces.paper;
    return { width: e.width, height: e.height, data: await this.bytes(e.file) };
  }
}

/** How a sheet's layers are split across texture arrays of at most `maxLayers` layers. */
export function planArrays(layers: number, maxLayers: number): { first: number; count: number }[] {
  if (maxLayers < 1) throw new Error('maxLayers must be at least 1');
  const out: { first: number; count: number }[] = [];
  for (let first = 0; first < layers; first += maxLayers)
    out.push({ first, count: Math.min(maxLayers, layers - first) });
  return out;
}

/** An atlas on the GPU: one or more texture arrays, each holding a run of layers. */
export interface GpuAtlas {
  data: AtlasData;
  arrays: { first: number; count: number; texture: GPUTexture; view: GPUTextureView }[];
  /** the highest mip level (for the LOD clamp) */
  maxLod: number;
  /** cell size in texels at level 0 */
  cellWidth: number;
  cellHeight: number;
  destroy(): void;
}

/** Uploads an atlas into r8unorm texture arrays with every mip level. */
export function uploadAtlas(device: GPUDevice, data: AtlasData): GpuAtlas {
  const top = data.levels[0];
  if (!top) throw new Error(`atlas ${data.name}: no levels`);
  const plan = planArrays(data.layers, device.limits.maxTextureArrayLayers);
  const arrays = plan.map(({ first, count }) => {
    const texture = device.createTexture({
      label: `atlas ${data.name} [${String(first)}, ${String(first + count)})`,
      size: [top.width, top.height, count],
      format: 'r8unorm',
      mipLevelCount: data.levels.length,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    data.levels.forEach((l, mip) => {
      const layerBytes = l.width * l.height;
      device.queue.writeTexture(
        { texture, mipLevel: mip },
        l.data.subarray(first * layerBytes, (first + count) * layerBytes),
        { bytesPerRow: l.width, rowsPerImage: l.height },
        [l.width, l.height, count],
      );
    });
    return { first, count, texture, view: texture.createView({ dimension: '2d-array' }) };
  });
  return {
    data,
    arrays,
    maxLod: data.levels.length - 1,
    cellWidth: top.width,
    cellHeight: top.height,
    destroy() {
      arrays.forEach((a) => {
        a.texture.destroy();
      });
    },
  };
}
