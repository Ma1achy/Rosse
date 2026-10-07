/**
 * Reading textures back to the CPU. Never on the frame path (ADR 0003): only for tests, for
 * statistics, and for the page's `?present=copy` mode (see src/main.ts).
 */

/** Reads a whole 2D texture back: rows tightly packed, `bytesPerPixel` each. */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  bytesPerPixel: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height } = texture;
  const row = width * bytesPerPixel;
  const stride = Math.ceil(row / 256) * 256;
  const buffer = device.createBuffer({
    label: 'readback',
    size: stride * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder({ label: 'readback' });
  enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [width, height]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * stride, y * stride + row), y * row);
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** Copies `size` bytes of a buffer back (it needs COPY_SRC). Tests and statistics only. */
export async function readBuffer(
  device: GPUDevice,
  src: GPUBuffer,
  size: number,
  offset = 0,
): Promise<ArrayBuffer> {
  const bytes = Math.max(4, Math.ceil(size / 4) * 4);
  const dst = device.createBuffer({
    label: 'readback',
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder({ label: 'readback' });
  enc.copyBufferToBuffer(src, offset, dst, 0, bytes);
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const copy = dst.getMappedRange().slice(0, size);
  dst.unmap();
  dst.destroy();
  return copy;
}
