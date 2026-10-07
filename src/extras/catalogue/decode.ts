/**
 * The Galaxy Zoo 2 catalogue (`assets/data/rosse/gz2-catalogue.json`): 239,695 galaxies, packed
 * column by column. The decode is v21's `loadCat` (app23.js:L1767) and
 * `assets/data/rosse/decode_gz2_catalogue.py`, which it must match on every field:
 *
 *   base64 -> gzip -> for each field of `hdr.fields`, N bytes (one per galaxy);
 *   then RA and Dec as 24-bit planes (3 x N bytes each, high byte first);
 *   then the DR7 object ids as delta-coded unsigned LEB128 varints (id = previous id + varint).
 *
 * Memory is the concern on phones (docs/milestones/m12/README.md): the decoded catalogue is the
 * 11.3 MB of the unpacked bytes (the columns are views of it, as in v21), plus RA and Dec as
 * `Float64Array` (3.8 MB) and the ids as a `BigUint64Array` (1.9 MB; the ids exceed 2^53, and v21's
 * array of 239,695 decimal strings costs several times that). Nothing here is on the frame path:
 * the decode runs in a worker (./worker.ts).
 *
 * Values are not stored decoded: the byte columns are scaled on demand by `./fields.ts`, with the
 * same expressions as v21 and the Python.
 */

export interface CatalogueHeader {
  /** Number of galaxies. */
  n: number;
  /** The byte columns, in storage order. */
  fields: string[];
  /** Length of the varint section of the ids, in bytes. */
  idbytes: number;
}

/** The packed file: the header and the base64 of the gzip stream. */
export interface PackedCatalogue {
  hdr: CatalogueHeader;
  b64: string;
}

/** A decoded catalogue. */
export interface Catalogue {
  n: number;
  fields: string[];
  /** One byte per galaxy per field; views of one buffer. */
  cols: Record<string, Uint8Array>;
  /** Right ascension in degrees (0 to 360). */
  ra: Float64Array;
  /** Declination in degrees (-90 to 90). */
  dec: Float64Array;
  /** SDSS DR7 object ids, ascending. */
  objid: BigUint64Array;
}

/** Base64 to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gunzip with the platform's `DecompressionStream` (browsers, workers and Node 18+). */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('this browser cannot unpack the catalogue');
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode the unpacked bytes of the catalogue. Throws if the length is not what the header says.
 * The columns are views of `buf`.
 */
export function decodeCatalogueBytes(buf: Uint8Array, hdr: CatalogueHeader): Catalogue {
  const N = hdr.n;
  const F = hdr.fields;
  const want = (F.length + 6) * N + hdr.idbytes;
  if (buf.length !== want)
    throw new Error(
      `catalogue: ${String(buf.length)} bytes unpacked, the header says ${String(want)}`,
    );
  let off = 0;
  const cols: Record<string, Uint8Array> = {};
  for (const f of F) {
    cols[f] = buf.subarray(off, off + N);
    off += N;
  }
  const u24 = (o: number): Float64Array => {
    const a = buf.subarray(o, o + N);
    const b = buf.subarray(o + N, o + 2 * N);
    const c = buf.subarray(o + 2 * N, o + 3 * N);
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++)
      out[i] = (((a[i] as number) << 16) | ((b[i] as number) << 8) | (c[i] as number)) / 16777215;
    return out;
  };
  const ra = u24(off);
  off += 3 * N;
  const dec = u24(off);
  off += 3 * N;
  for (let i = 0; i < N; i++) {
    ra[i] = (ra[i] as number) * 360;
    dec[i] = (dec[i] as number) * 180 - 90;
  }
  // ids: delta-coded unsigned LEB128. A group of up to four bytes fits a Number exactly; the sum
  // is kept in a BigInt only through the 64-bit running total (ids reach about 5.9e17 > 2^53).
  const objid = new BigUint64Array(N);
  let cur = 0n;
  let j = off;
  for (let k = 0; k < N; k++) {
    let lo = 0;
    let shift = 0;
    let big = 0n;
    for (;;) {
      const byte = buf[j++] as number;
      if (shift < 28) lo += (byte & 127) * 2 ** shift;
      else big |= BigInt(byte & 127) << BigInt(shift);
      shift += 7;
      if (!(byte & 128)) break;
    }
    cur += BigInt(lo) + big;
    objid[k] = cur;
  }
  if (j !== buf.length)
    throw new Error(`catalogue: ${String(buf.length - j)} bytes left after the ids`);
  return { n: N, fields: F, cols, ra, dec, objid };
}

/** Decode the packed file: base64, gunzip, columns. */
export async function decodePacked(packed: PackedCatalogue): Promise<Catalogue> {
  return decodeCatalogueBytes(await gunzip(base64ToBytes(packed.b64)), packed.hdr);
}
