/** Keep logical packed bytes unchanged, with zeroed allocation padding for a linked block.
 *  A driver's reported minimum can exceed the value's size. It never defines column stride. */
export function glUniformBytes(bytes: Uint8Array, minimum: number): ArrayBuffer {
  const size = Math.max(minimum, 16, Math.ceil(bytes.byteLength / 16) * 16);
  const data = new Uint8Array(size);
  data.set(bytes);
  return data.buffer;
}
