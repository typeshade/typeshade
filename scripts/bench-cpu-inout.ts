// #961: compare generated CPU factories on the same method-calling kernel.
// Save a baseline before changing the generator, then compare it on the candidate.
// Run the bundled script under Node to measure V8, not Bun's JavaScriptCore.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compile } from '../src/compiler/ts/compile.js';
import { generateModuleJs } from '../src/core/cpu-codegen.js';
import { createCodegenRuntime } from '../src/core/cpu-codegen-runtime.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';

const source = `"use typeshade";
class Voice {
  value: f32 = 0.;
  step(amount: f32): f32 { this.value += amount; return this.value; }
  tick(): f32 { return this.step(0.25) + this.step(0.5); }
}
export function render(out: array<f32>, voices: array<Voice>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = voices[i].tick();
}
`;
const result = compile(source);
if (result.diagnostics.some((d) => d.category === 'error'))
  throw new Error(JSON.stringify(result.diagnostics));
const gen = generateModuleJs(result.module, { precision: 'f32' });
if (gen.fallbacks.length) throw new Error('The benchmark must run generated functions only.');
const snapshot = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  factory: gen.factorySource,
  source,
};
const [mode, path] = process.argv.slice(2);
if (!path || !['--save-baseline', '--baseline'].includes(mode ?? '')) {
  throw new Error(
    'Use --save-baseline <file> on the baseline, then --baseline <file> on the candidate.',
  );
}
if (mode === '--save-baseline') {
  writeFileSync(path, JSON.stringify(snapshot));
} else {
  const baseline = JSON.parse(readFileSync(path, 'utf8')) as typeof snapshot;
  if (baseline.source !== source) throw new Error('The benchmark source changed.');
  const make = (factory: string) => {
    const runtime = createCodegenRuntime();
    const fns = new Function('$', factory)(runtime) as Record<
      string,
      (...args: CpuValue[]) => CpuValue
    >;
    runtime.F = fns;
    return fns.render!;
  };
  const count = 512;
  const frames = 128;
  const baselineFn = make(baseline.factory);
  const candidateFn = make(snapshot.factory);
  const run = (fn: typeof baselineFn) => {
    const voices = Array.from({ length: count }, () => ({ value: 0 }));
    const out = Array<number>(count).fill(0);
    const start = performance.now();
    for (let frame = 0; frame < frames; frame++) fn(out, voices as unknown as CpuValue);
    const ms = performance.now() - start;
    for (let i = 0; i < count; i++) {
      if (voices[i]!.value !== 96 || out[i] !== 191.5) throw new Error('Wrong kernel result.');
    }
    return ms;
  };
  for (let i = 0; i < 10; i++) {
    run(baselineFn);
    run(candidateFn);
  }
  const samples: { baseline: number; candidate: number }[] = [];
  for (let i = 0; i < 20; i++) {
    // Alternate order so one version is not always measured immediately after the other.
    if (i % 2) {
      const candidate = run(candidateFn);
      samples.push({ baseline: run(baselineFn), candidate });
    } else {
      const baseline = run(baselineFn);
      samples.push({ baseline, candidate: run(candidateFn) });
    }
  }
  const median = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return (sorted[9]! + sorted[10]!) / 2;
  };
  const before = median(samples.map((s) => s.baseline));
  const after = median(samples.map((s) => s.candidate));
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  console.log(
    JSON.stringify(
      {
        node: process.version,
        v8: process.versions.v8,
        baseline: baseline.revision,
        candidate: snapshot.revision,
        candidateDirty: snapshot.dirty,
        baselineFactorySha256: hash(baseline.factory),
        candidateFactorySha256: hash(snapshot.factory),
        count,
        frames,
        warmups: 10,
        samples,
        medianMs: { baseline: before, candidate: after },
        speedup: before / after,
      },
      null,
      2,
    ),
  );
}
