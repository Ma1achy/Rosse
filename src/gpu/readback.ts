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
