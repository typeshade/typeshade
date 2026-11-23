// ═══ The oracle check of the example runs, C5 (change 0145, amendment A2, M4.6) ═══
//
// Computes what a host's `run()` should give from the `f64` CPU oracle of the same IR
// (`src/core/oracle.ts`), with the bindings the host passes. A drawing entry is called once for
// each pixel and quantised as the CPU tier quantises a pixel; a compute entry is dispatched and a
// binding read back. The tolerance comes from the determinism report of the module: exact when it
// lists no operation, `PIXEL` and `RELATIVE` otherwise.
//
// What C5 can show: the CPU tier runs the generated JavaScript twin of the oracle in `f32`. So it
// finds a wrong call layer (binding packing, workgroup count, canvas size, quantisation) and
// `f32` drift. It cannot find an error of the IR that both engines share: the plain-JavaScript
// references (`_reference.ts`) are the independent evaluation.
//
// It imports the compiler, so the plain-JavaScript references do not import it.

import { compile, compileModule, type CpuValue, type WorkgroupCount } from '../src/index.js';
import type { Expected, Outputs, Tolerance } from './_compare.js';

/** A drawing entry: called once for each pixel of a `size` by `size` canvas. */
export interface FragmentCase {
  readonly kind: 'fragment';
  readonly entry: string;
  readonly size: number;
  readonly bindings: () => Readonly<Record<string, CpuValue>>;
}

/** A compute entry: dispatched, then `read` takes the numbers out of the bindings. */
export interface ComputeCase {
  readonly kind: 'compute';
  readonly entry: string;
  readonly workgroups: WorkgroupCount;
  readonly bindings: () => Readonly<Record<string, CpuValue>>;
  readonly read: (bindings: Readonly<Record<string, CpuValue>>) => number[];
}

export type OracleCase = FragmentCase | ComputeCase;

/** What the oracle gives for `source` run as `c` says: `pixels` or `values`, and the tolerance
 *  of the module's determinism report. */
export function oracleOutputs(
  source: string,
  fileName: string,
  c: OracleCase,
): { readonly outputs: Outputs; readonly exact: boolean } {
  const result = compile(source, { fileName });
  const errors = result.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0) throw new Error(`${fileName}: ${errors.map((d) => d.message).join('; ')}`);
  const oracle = compileModule(result.module, { precision: 'f64' });
  const bindings = c.bindings();
  for (const [name, value] of Object.entries(bindings)) oracle.setBinding(name, value);
  const exact = result.determinism.length === 0;
  if (c.kind === 'compute') {
    oracle.dispatch(c.entry, c.workgroups);
    return { outputs: { values: c.read(bindings) }, exact };
  }
  const pixels: number[] = [];
  const entry = oracle.fns[c.entry]!;
  for (let y = 0; y < c.size; y++)
    for (let x = 0; x < c.size; x++) {
      const out = entry([x + 0.5, y + 0.5, 0, 1]) as unknown as number[] | { color: number[] };
      for (const v of Array.isArray(out) ? out : out.color)
        pixels.push(Math.round(Math.min(1, Math.max(0, v)) * 255));
    }
  return { outputs: { pixels }, exact };
}

/** The parts `oracleOutputs` gave, as an `Expected` for `compareParts`: exact when the module's
 *  report lists no operation, else `loose`. */
export function expectedOf(
  oracle: { readonly outputs: Outputs; readonly exact: boolean },
  loose: (part: string) => Tolerance,
): Record<string, Expected> {
  return Object.fromEntries(
    Object.entries(oracle.outputs).map(([part, values]) => [
      part,
      { values, tolerance: oracle.exact ? { absolute: 0 } : loose(part) },
    ]),
  );
}
