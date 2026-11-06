import { createDevice } from 'typeshade/runtime';
import { signedMax, signedMin, unsignedMax, unsignedMin } from './extremes.shade.ts';

/** Require WebGPU for the colliding-key scatters, with and without the optional subgroup text. */
export async function scatterExtremes(): Promise<Record<string, number[]>> {
  const result: Record<string, number[]> = {};
  const unsigned = Uint32Array.from({ length: 1031 }, (_, i) => Math.imul(i + 1, 2654435761) + 19);
  let checked = 0;
  for (const subgroups of ['off', 'auto'] as const) {
    const dev = await createDevice({ prefer: ['webgpu'], subgroups });
    try {
      const keys = dev.array(
        Uint32Array.from({ length: unsigned.length }, (_, i) => (Math.floor(i / 4) * 7) % 31),
      );
      const values = dev.array(unsigned);
      const signed = dev.array(Int32Array.from(unsigned));
      const expectVariant = (name: string): void => {
        const want = dev.info.subgroups === null ? 'tree' : 'subgroup';
        const got = dev.statistics.variants[name];
        if (got !== want)
          throw new Error(`${name} with subgroups ${subgroups}: ${got}, wanted ${want}`);
        checked++;
      };
      for (const [name, fn, initial] of [
        ['unsignedMin', unsignedMin, 0xffffff00],
        ['unsignedMax', unsignedMax, 17],
      ] as const) {
        const best = dev.array(new Uint32Array(32).fill(initial));
        await fn(best, keys, values);
        expectVariant(name);
        result[`scatter_${name}_${subgroups}`] = [...(await best.read())];
      }
      for (const [name, fn, initial] of [
        ['signedMin', signedMin, 2147483600],
        ['signedMax', signedMax, -2147483600],
      ] as const) {
        const best = dev.array(new Int32Array(32).fill(initial));
        await fn(best, keys, signed);
        expectVariant(name);
        result[`scatter_${name}_${subgroups}`] = [...(await best.read())];
      }
    } finally {
      dev.dispose();
    }
  }
  return { ...result, scatterVariantChecks: [checked] };
}
