export function firstVertexLast(
  count: number,
  strip: boolean,
  source?: ArrayLike<number>,
  restart = -1,
): Uint32Array {
  const out = new Uint32Array(strip ? Math.max(0, count - 2) * 3 : count - (count % 3));
  let n = 0;
  let k = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < count; i++) {
    const v = source === undefined ? i : source[i]!;
    if (v === restart) {
      k = 0;
      continue;
    }
    k += 1;
    if (strip ? k >= 3 : k % 3 === 0) {
      const odd = strip && k % 2 === 0;
      out[n++] = odd ? v : b;
      out[n++] = odd ? b : v;
      out[n++] = a;
    }
    a = b;
    b = v;
  }
  return out.subarray(0, n);
}
