// ═══ The oracle cases of the learning path (change 0145, amendment A2, M4.6) ═══
//
// For each step, the entry and the bindings its `host.ts` passes, built from `_reference.ts`'s
// inputs, so `examples/_oracle.ts` can compute what the step's `run()` should give from the CPU
// oracle. A binding is built again at each call: a dispatch writes its arrays in place.
// `parallel-sum` has no case: its `tiers` omit `cpu` (a barrier), so no CPU `run()` exists to hold.

import type { OracleCase } from '../_oracle.js';
import { INPUTS } from './_reference.js';

const frame = (time?: number): OracleCase['bindings'] => {
  const size = [INPUTS.size, INPUTS.size];
  return () => ({ frame: { size, ...(time === undefined ? {} : { time }) } });
};

const drawing = (entry: string, bindings: OracleCase['bindings'] = () => ({})): OracleCase => ({
  kind: 'fragment',
  entry,
  size: INPUTS.size,
  bindings,
});

export const ORACLE_CASES: Readonly<Record<string, OracleCase>> = {
  'first-color': drawing('fs'),
  'uv-gradient': drawing('fs', frame()),
  'moving-wave': drawing('fs', frame(INPUTS.time)),
  'sdf-shapes': drawing('fs', frame()),
  'tile-pattern': drawing('fs', frame()),
  fractal: drawing('fs', frame()),
  palette: drawing('fs', frame()),
  'bouncing-balls': drawing('fs', frame(INPUTS.time)),
  'ray-tracer': drawing('fs', frame()),
  'double-array': {
    kind: 'compute',
    entry: 'doubled',
    workgroups: Math.ceil(INPUTS.double.count / 64),
    bindings: () => ({ numbers: Array.from({ length: INPUTS.double.count }, (_, i) => i) }),
    read: (b) => b['numbers'] as number[],
  },
  'image-blur': {
    kind: 'compute',
    entry: 'blur',
    workgroups: [Math.ceil(INPUTS.blur.width / 8), Math.ceil(INPUTS.blur.height / 8), 1],
    bindings: () => {
      const { width, height } = INPUTS.blur;
      return {
        size: { width, height },
        source: Array.from({ length: width * height }, (_, i) => {
          const x = i % width;
          const y = Math.floor(i / width);
          return x >= width / 4 && x < width / 2 && y >= height / 4 && y < height / 2 ? 1 : 0;
        }),
        blurred: new Array<number>(width * height).fill(0),
      };
    },
    read: (b) => b['blurred'] as number[],
  },
  histogram: {
    kind: 'compute',
    entry: 'histogram',
    workgroups: Math.ceil(INPUTS.histogram.count / 64),
    bindings: () => ({
      values: Array.from({ length: INPUTS.histogram.count }, (_, i) => ((i * 37) % 100) / 100),
      bins: new Array<number>(8).fill(0),
    }),
    read: (b) => b['bins'] as number[],
  },
};
