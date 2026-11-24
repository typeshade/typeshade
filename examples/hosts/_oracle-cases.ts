// ═══ The oracle cases of the host examples (change 0145, amendment A2, M4.6) ═══
//
// The host examples whose `run()` the CPU oracle can hold, with the entry and the bindings the
// host passes for its last frame. The others are named, with the reason, in
// `examples/registry-driver.test.ts`.

import type { OracleCase } from '../_oracle.js';
import { INPUTS } from './_reference.js';

const { size, times } = INPUTS.draw;

export const ORACLE_CASES: Readonly<Record<string, OracleCase>> = {
  'host-draw': {
    kind: 'fragment',
    entry: 'fs',
    size,
    bindings: () => ({ frame: { time: times[times.length - 1]!, size: [size, size] } }),
  },
};
