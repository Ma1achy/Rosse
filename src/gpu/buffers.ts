/**
 * Buffer helpers: uploads of typed data and the writers for uniform structs whose layouts are
 * described in TypeScript (and checked against WGSL by tests/unit/layout.test.ts).
 */
import type { StructLayout } from '../marks/instance';

/** A buffer holding `data`, padded to a multiple of 4 bytes. */
export function bufferWithData(
  device: GPUDevice,
  data: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
  usage: GPUBufferUsageFlags,
  label?: string,
): GPUBuffer {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const buffer = device.createBuffer({
    ...(label ? { label } : {}),
    size: Math.max(4, Math.ceil(bytes.byteLength / 4) * 4),
    usage,
    mappedAtCreation: true,
  });
  new Uint8Array(buffer.getMappedRange()).set(bytes);
  buffer.unmap();
  return buffer;
}

/** Field values for a struct: numbers or vectors, by field name. */
export type StructValues = Record<string, number | readonly number[]>;

/** Writes a struct into an ArrayBuffer according to its layout. */
export function packStruct(layout: StructLayout, values: StructValues): ArrayBuffer {
  const buf = new ArrayBuffer(layout.size);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const i = new Int32Array(buf);
  for (const field of layout.fields) {
    const v = values[field.name];
    if (v === undefined) throw new Error(`${layout.name}.${field.name} missing`);
    const list = typeof v === 'number' ? [v] : v;
    const scalar = field.type.includes('u32') ? 'u' : field.type.includes('i32') ? 'i' : 'f';
    const n = field.size / 4;
    for (let k = 0; k < n; k++) {
      const x = list[k] ?? 0;
      const at = field.offset / 4 + k;
      if (scalar === 'u') u[at] = x;
      else if (scalar === 'i') i[at] = x;
      else f[at] = x;
    }
  }
  return buf;
}
