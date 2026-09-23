// ═══ Stepping the `"use typeshade"` corpus, on the files an author would open ═══
//
// `src/core/debug/step.test.ts` pins the session's behaviour on sources written for the test.
// This file runs it against the real `.shade.ts` examples in this directory — the registered
// modules, compiled from the same bytes on disk the compile gate hands to Tint — and asks the
// question `docs/debugging.md` §1.2 is about: when the run stops, does it name the statement
// the author wrote, in the file the author has open?
//
// The check is textual on purpose. A span that is merely PRESENT proves nothing; a span whose
// text is the statement it is about to execute is the whole promise.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shadeExamples, SHADE_EXT } from './_shade.js';
import { examples as allExamples } from './index.js';
import { compileModule } from '../src/index.js';
import { startDebugSession, type DebugPause, type SourceSpan } from '../src/debug.js';
import type { ModuleDecl, Stmt } from '../src/core/ir/index.js';
import { zeroOf, type CpuValue } from '../src/core/cpu-runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The registered module for `id`, and the exact bytes its spans index into — the same file
 *  `_shade.ts` read to compile it, so a span's offsets are offsets into this string. */
function example(id: string): { module: ModuleDecl; src: string } {
  const ex = shadeExamples.find((e) => e.id === id);
  expect(ex, `registered example ${id}`).toBeDefined();
  return { module: ex!.module, src: readFileSync(join(HERE, `${id}${SHADE_EXT}`), 'utf8') };
}

const textAt = (src: string, span: SourceSpan): string =>
  src.slice(span.start, span.start + span.length);

/** What the source of a statement of this kind must start with, so a span that drifted onto a
 *  neighbouring construct fails rather than merely looking plausible. */
function expectedOpening(s: Stmt): RegExp {
  switch (s.s) {
    case 'return':
      return /^return\b/;
    case 'if':
      return /^if\s*\(/;
    case 'for':
      return /^(for|while)\s*\(|^let\b/; // a `for` header, or the `for`-init statement itself
    case 'switch':
      return /^switch\s*\(/;
    case 'break':
      return /^break\b/;
    case 'continue':
      return /^continue\b/;
    case 'let':
    case 'var':
      // A single-declarator statement spans the whole thing, keyword included; one declarator
      // of several spans just itself, and a `for` header's `init` keeps its own `let`.
      return new RegExp(`^(const\\s+|let\\s+)?${s.name}\\b`);
    default:
      return /^\S/;
  }
}

/** Walk a whole run, asserting the invariant at every stop, and return the trace. */
function walk(
  module: ModuleDecl,
  src: string,
  entry: string,
  args: readonly CpuValue[],
  opts?: Parameters<typeof startDebugSession>[3],
): string[] {
  const s = startDebugSession(module, entry, args, opts);
  const trace: string[] = [];
  let p: DebugPause | undefined = s.pause;
  let guard = 0;
  while (p) {
    expect(++guard, 'a stepped example should not run away').toBeLessThan(500);
    const span = p.span;
    expect(span, `every statement of ${entry} is authored, so it has a span`).toBeDefined();

    const text = textAt(src, span!);
    expect(text, `${p.stmt.s} at ${span!.line}:${span!.character}`).toMatch(
      expectedOpening(p.stmt),
    );

    // The stop is inside the function the innermost frame names, and the frame agrees with
    // the pause about where it is.
    const frame = p.frames[0]!;
    expect(frame.span).toEqual(span);
    expect(span!.start).toBeGreaterThanOrEqual(frame.fnSpan!.start);
    expect(span!.start + span!.length).toBeLessThanOrEqual(
      frame.fnSpan!.start + frame.fnSpan!.length,
    );
    // …and the line it reports is the line that text is actually on.
    expect(src.split('\n')[span!.line]).toContain(text.split('\n')[0]);

    trace.push(text);
    p = s.stepIn();
  }
  expect(s.done).toBe(true);
  return trace;
}

describe('hello.shade.ts — stepping a vertex entry', () => {
  const { module, src } = example('hello');

  it('stops on each statement of vs, in the order they are written', () => {
    expect(walk(module, src, 'vs', [1])).toEqual([
      'let x = -0.8',
      'let y = -0.8',
      'if (i === 1) {\n    x = 0.8\n  }',
      'x = 0.8',
      'if (i === 2) {\n    x = 0.\n    y = 0.8\n  }',
      'return { pos: vec4(x, y, 0., 1.) }',
    ]);
  });

  it('takes the other branch for another invocation, and skips neither if', () => {
    expect(walk(module, src, 'vs', [2])).toEqual([
      'let x = -0.8',
      'let y = -0.8',
      'if (i === 1) {\n    x = 0.8\n  }',
      'if (i === 2) {\n    x = 0.\n    y = 0.8\n  }',
      'x = 0.',
      'y = 0.8',
      'return { pos: vec4(x, y, 0., 1.) }',
    ]);
  });

  it('the locals hold what the author would expect at each stop', () => {
    const s = startDebugSession(module, 'vs', [1], { precision: 'f64' });
    s.stepOver(); // now on `let y = -0.8`
    expect(s.pause!.frames[0]!.locals.get('x')).toBe(-0.8);
    s.stepOver(); // now on `if (i === 1)`
    s.stepOver(); // the branch is taken, so now on `x = 0.8` inside it
    expect(textAt(src, s.pause!.span!)).toBe('x = 0.8');
    expect(s.pause!.frames[0]!.locals.get('x')).toBe(-0.8);
    s.stepOver(); // now on `if (i === 2)`, with the assignment done
    expect(s.pause!.frames[0]!.locals.get('x')).toBe(0.8);
    expect(s.pause!.frames[0]!.locals.get('y')).toBe(-0.8);
  });

  it('a breakpoint on the line the author would click stops there', () => {
    const line = src.split('\n').findIndex((l) => l.trim() === 'y = 0.8');
    const s = startDebugSession(module, 'vs', [2], { breakpoints: [{ line }] });
    const hit = s.continue();
    expect(hit!.reason).toBe('breakpoint');
    expect(textAt(src, hit!.span!)).toBe('y = 0.8');
    expect(hit!.frames[0]!.locals.get('x')).toBe(0);
  });

  it('the value it ends on is the value the oracle computes', () => {
    for (const i of [0, 1, 2]) {
      const s = startDebugSession(module, 'vs', [i], { precision: 'f64' });
      s.continue();
      expect(s.result).toEqual(compileModule(module).fns.vs!(i));
    }
  });

  it('the fragment entry steps too, and its one statement is its return', () => {
    expect(walk(module, src, 'fs', [])).toEqual(['return { color: vec4(1., 0., 0., 1.) }']);
  });
});

describe('compute-reduction-twin.shade.ts — stepping one compute invocation', () => {
  const { module, src } = example('compute-reduction-twin');
  /** Eight inputs, one output window: the kernel folds input[0..8) into output[0]. */
  const inputs = [1, 2, 3, 4, 5, 6, 7, 8];

  const bindingsFor = (out: number[]): Record<string, CpuValue> => ({
    input: inputs,
    output: out,
    params: [out.length, 0, 0, 0],
  });

  it('stops on each statement of the kernel, loop iterations included', () => {
    const out = [0];
    const trace = walk(module, src, 'reduce_windows', [[0, 0, 0]], {
      bindings: bindingsFor(out),
      precision: 'f64',
    });
    expect(trace.slice(0, 6)).toEqual([
      'const idx = gid.x',
      'if (idx >= params.x) {\n    return\n  }',
      'const base = idx * 8',
      'let sum = 0.',
      'for (let j: u32 = 0; j < 8; j++) {\n    sum = sum + input[base + j]\n  }',
      'let j: u32 = 0',
    ]);
    // Eight folds and eight updates, then the store.
    expect(trace.filter((t) => t === 'sum = sum + input[base + j]')).toHaveLength(8);
    expect(trace.filter((t) => t === 'j++')).toHaveLength(8);
    expect(trace.at(-1)).toBe('output[idx] = sum');
  });

  it('the storage write it steps through is the one the oracle makes', () => {
    const stepped = [0];
    const s = startDebugSession(module, 'reduce_windows', [[0, 0, 0]], {
      bindings: bindingsFor(stepped),
      precision: 'f64',
    });
    s.continue();
    expect(s.done).toBe(true);
    expect(stepped).toEqual([36]);
  });

  it('an out-of-range invocation returns early, and the trace shows it', () => {
    const out = [0];
    const trace = walk(module, src, 'reduce_windows', [[5, 0, 0]], {
      bindings: bindingsFor(out),
      precision: 'f64',
    });
    expect(trace).toEqual([
      'const idx = gid.x',
      'if (idx >= params.x) {\n    return\n  }',
      'return',
    ]);
    expect(out).toEqual([0]);
  });

  it('the loop counter and the accumulator are readable at every iteration', () => {
    const out = [0];
    const s = startDebugSession(module, 'reduce_windows', [[0, 0, 0]], {
      bindings: bindingsFor(out),
      precision: 'f64',
    });
    const seen: Array<[CpuValue, CpuValue]> = [];
    let p: DebugPause | undefined = s.pause;
    while (p) {
      if (textAt(src, p.span!) === 'sum = sum + input[base + j]') {
        seen.push([p.frames[0]!.locals.get('j')!, p.frames[0]!.locals.get('sum')!]);
      }
      p = s.stepIn();
    }
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
      [3, 6],
      [4, 10],
      [5, 15],
      [6, 21],
      [7, 28],
    ]);
  });

  it('the bindings are their own scope at every stop', () => {
    const out = [0];
    const s = startDebugSession(module, 'reduce_windows', [[0, 0, 0]], {
      bindings: bindingsFor(out),
      precision: 'f64',
    });
    expect([...s.pause!.bindings.keys()].sort()).toEqual(['input', 'output', 'params']);
    expect(s.pause!.bindings.get('params')).toEqual([1, 0, 0, 0]);
  });

  it('a binding nobody supplied is named, not silently zero', () => {
    expect(() => startDebugSession(module, 'reduce_windows', [[0, 0, 0]]).continue()).toThrow(
      /no value supplied for binding 'params'/,
    );
  });
});

// ═══ Every registered example, stepped against the oracle ═══
//
// The gate `interp.ts`'s header claims: every example through both walks, bit-identical. It
// did not exist: `src/core/debug/step-differential.test.ts` sweeps only the generated corpus
// from `random-ir.ts`, whose `construct` arm builds f32 vectors and nothing else, so the
// element-CONVERTING constructor `vec2u(v)` was never reached by either gate. The review found
// the divergence by hand in `convert-grid:fs`: the stepper pushed raw components where the
// oracle saturates, so `f(-3)` answered -3 against the oracle's 0. This is the sweep that
// would have caught it, over the real corpus rather than a generated one.
//
// The registered corpus is what makes it worth having: these are the modules the compile gate
// hands to Tint, so every language feature that reaches a backend reaches this too, and a
// feature added to `cpu-runtime.ts` for the oracle and forgotten here fails on the example
// that uses it.

/** A deterministic value of `t`, small and in range, so the sweep compares walks rather than
 *  exercising overflow (`step-differential.test.ts` owns the boundary sweep). */
function sampleOf(
  t: { kind: string; n?: number; elem?: string; scalar?: string },
  k: number,
): CpuValue {
  const scalar = (s: string | undefined): number => {
    if (s === 'bool') return k % 2;
    if (s === 'u32') return k;
    if (s === 'i32') return k - 1;
    return k * 0.5 - 1;
  };
  if (t.kind === 'vec' || t.kind === 'vec64') {
    return Array.from({ length: t.n ?? 2 }, () => scalar(t.elem)) as CpuValue;
  }
  if (t.kind === 'scalar') return scalar(t.scalar);
  return 0;
}

/** Zeros for every binding the module declares, on both sides, so a module with bindings is
 *  swept rather than skipped. */
function zeroBindings(m: ModuleDecl): Record<string, CpuValue> {
  const out: Record<string, CpuValue> = {};
  for (const b of m.bindings) {
    // A runtime-sized array has no zero; give it a short one so the two walks index the same
    // memory and a write on one side is visible on that side only. A SIZED one needs no case
    // here: `zeroOf` builds its elements (#8 A10 gave it an array arm, since the source
    // language's init-less `let arr: array<f32, 3>` reaches it).
    out[b.name] =
      b.type.kind === 'array' && b.type.size === undefined
        ? ([0, 0, 0, 0, 0, 0, 0, 0] as CpuValue)
        : zeroOf(b.type);
  }
  return out;
}

describe('every registered example steps to what the oracle computes', () => {
  it('is bit-identical over every function of every example', () => {
    const divergences: string[] = [];
    let checks = 0;
    let swept = 0;
    // Both registries: the EDSL-authored examples and the `.shade.ts` ones. Together they are
    // the 44 modules the compile gate hands to Tint, which is what "every example" means.
    for (const ex of [...allExamples, ...shadeExamples]) {
      const m = ex.module;
      for (const f of m.funcs) {
        for (let k = 0; k < 3; k++) {
          const args = f.params.map((p) => sampleOf(p.type as never, k));
          // Fresh binding objects per side: a kernel that WRITES to storage must not have one
          // side's write seen by the other.
          const oracleBindings = zeroBindings(m);
          const stepBindings = zeroBindings(m);
          const oracle = compileModule(m, { gpuStubs: true, precision: 'f64' });
          for (const [n, v] of Object.entries(oracleBindings)) oracle.setBinding(n, v);

          let a: CpuValue | string;
          try {
            a = oracle.fns[f.name]!(...(args as never[]));
          } catch (e) {
            a = `throw ${(e as Error).message}`;
          }
          let b: CpuValue | string | undefined;
          try {
            const s = startDebugSession(m, f.name, args, {
              gpuStubs: true,
              precision: 'f64',
              bindings: stepBindings,
            });
            s.continue();
            b = s.result;
          } catch (e) {
            b = `throw ${(e as Error).message}`;
          }
          checks++;
          const same =
            typeof a === 'string' || typeof b === 'string'
              ? a === b
              : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
          if (!same && divergences.length < 8) {
            divergences.push(
              `${ex.id}:${f.name}(${JSON.stringify(args)}) oracle ${JSON.stringify(a)} != step ${JSON.stringify(b)}`,
            );
          }
          // The storage a kernel wrote has to agree too, not only what it returned.
          if (
            JSON.stringify(oracleBindings) !== JSON.stringify(stepBindings) &&
            divergences.length < 8
          ) {
            divergences.push(
              `${ex.id}:${f.name} bindings after the run: oracle ${JSON.stringify(oracleBindings)} != step ${JSON.stringify(stepBindings)}`,
            );
          }
        }
      }
      swept++;
    }
    console.log(
      `[debug-examples] ${swept} registered modules, ${checks} oracle-vs-step comparisons`,
    );
    // Floors, not exact counts: an example added to the registry widens the sweep rather
    // than failing it. The point of the floor is that a registry that stopped loading would
    // otherwise pass silently with nothing swept.
    expect(swept).toBeGreaterThan(40);
    expect(checks).toBeGreaterThan(200);
    expect(divergences).toEqual([]);
  });

  it('reaches the element-converting constructor, which is what the generated corpus misses', () => {
    // Naming the feature rather than trusting the count: `random-ir.ts` cannot generate
    // `vecN<T>(v: vecN<S>)`, so without a registered example carrying one this sweep would be
    // green and blind in exactly the place the review found the bug.
    const converting = shadeExamples.filter((ex) =>
      ex.module.funcs.some(
        (f) =>
          JSON.stringify(f.body).includes('"op":"construct"') &&
          /vec[234]u|vec[234]i/.test(readFileSync(join(HERE, `${ex.id}${SHADE_EXT}`), 'utf8')),
      ),
    );
    expect(converting.map((e) => e.id)).toContain('convert-grid');
  });
});
