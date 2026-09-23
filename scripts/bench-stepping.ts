// ═══ What the stepping walk costs, against the two backends it mirrors ═══
//
// `docs/debugging.md` §2.5 asks the milestone-2 pull request for a measurement rather than a
// guess: whether making `oracle.ts` itself a generator would be cheap enough to have one walk
// instead of two. The answer decides a design, so it is committed here as a script anyone can
// re-run rather than as a number in a comment that nobody can check.
//
// It exists because the number in that comment did not reproduce. It was quoted as a single
// ratio, 3.1x, from one run; a reviewer measuring the same thing got 4.1x, and single shots on
// this machine range from about 1.5x to 6.7x. The conclusion was never in doubt (a generator
// resume per statement is expensive next to a straight tree walk) but a ratio stated to two
// significant figures from one sample is a made-up precision. This reports a median of
// interleaved repetitions and prints the spread, so the number it gives is one that survives
// being looked at twice.
//
//   bun scripts/bench-stepping.ts
//
// Interleaved, not one backend after the other: a machine under changing load otherwise
// attributes its own drift to whichever backend ran during the slow patch.

import { compileTsSource } from '../src/compiler/ts/source-file.js';
import { compileModule } from '../src/core/oracle.js';
import { compileModuleJs } from '../src/core/cpu-codegen.js';
import { startDebugSession } from '../src/core/debug/session.js';
import type { ModuleDecl } from '../src/core/ir/index.js';

const SOURCE = `"use typeshade"
export function acc(seed: f32): f32 {
  let total = 0.
  for (let i: i32 = 0; i < 32; i++) {
    total = total + sin(seed + f32(i))
  }
  return total
}
`;

const REPS = 9;
const INVOCATIONS = 2000;

function build(): ModuleDecl {
  const r = compileTsSource(SOURCE, { fileName: 'bench.shade.ts' });
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('; '));
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  };
}

/** Microseconds per invocation for one timed pass. */
function time(run: (i: number) => void): number {
  const t0 = performance.now();
  for (let i = 0; i < INVOCATIONS; i++) run(i);
  return ((performance.now() - t0) * 1000) / INVOCATIONS;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const fmt = (x: number): string => `${x.toFixed(1)} µs`;
const range = (xs: readonly number[]): string =>
  `${Math.min(...xs).toFixed(1)} to ${Math.max(...xs).toFixed(1)}`;

const m = build();
// Session setup is hoisted out of the timed loop for the two compiled backends, so what is
// compared is per-invocation evaluation and not one-off preparation. The stepping walk has no
// equivalent to hoist: a session IS one invocation, which is part of what it costs.
const oracle = compileModule(m, { precision: 'f64' });
const js = compileModuleJs(m, { precision: 'f64' });

const samples: Record<string, number[]> = { codegen: [], oracle: [], stepping: [] };
for (let r = 0; r < REPS; r++) {
  // Warm each backend before timing it, every rep, so no one of them pays the JIT's entry fee
  // on behalf of the others.
  for (let i = 0; i < 200; i++) {
    js.fns.acc!(i);
    oracle.fns.acc!(i);
  }
  samples.codegen!.push(time((i) => void js.fns.acc!(i)));
  samples.oracle!.push(time((i) => void oracle.fns.acc!(i)));
  samples.stepping!.push(
    time((i) => {
      const s = startDebugSession(m, 'acc', [i], { precision: 'f64' });
      s.continue();
    }),
  );
}

const med = {
  codegen: median(samples.codegen!),
  oracle: median(samples.oracle!),
  stepping: median(samples.stepping!),
};
const ratios = samples.stepping!.map((s, i) => s / samples.oracle![i]!);

console.log(`stepping benchmark: ${REPS} interleaved reps x ${INVOCATIONS} invocations`);
console.log(
  `  new Function codegen   ${fmt(med.codegen).padStart(9)}   (${range(samples.codegen!)})`,
);
console.log(
  `  oracle tree-walk       ${fmt(med.oracle).padStart(9)}   (${range(samples.oracle!)})`,
);
console.log(
  `  stepping generator     ${fmt(med.stepping).padStart(9)}   (${range(samples.stepping!)})`,
);
console.log(`  generator / tree-walk  ${median(ratios).toFixed(1)}x   (per-rep ${range(ratios)}x)`);
console.log(
  '\nThe decision this measures (§2.5): making `oracle.ts` itself a generator would put that\n' +
    'multiple on every use of the reference backend, which is production-used and sits under\n' +
    'property suites. A duplicated walk plus a differential gate is the cheaper trade.',
);
