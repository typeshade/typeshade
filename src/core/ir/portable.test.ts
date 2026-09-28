// The portable IR (change 0025, section 5): a module written to JSON and read back emits the same
// WGSL, GLSL, reflection, console variant and manifest, byte for byte, over every example. The
// fixtures are what `JSON.stringify` alone loses, each shown to change the output when lost: a
// subtree shared by identity, `-0`, and the `declRef` of a declared function that shadows a
// builtin. Then the spans it keeps, a cycle, and the version it refuses.
//
// Verifies: Rule 11.10, Rule 11.11.

import { describe, expect, it } from 'vitest';
import { examples } from '../../../examples/index.js';
import { shadeExamples } from '../../../examples/_shade.js';
import { compile } from '../../compiler/ts/compile.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { reflect } from '../reflect.js';
import { consoleBuffer } from '../passes/console-buffer.js';
import { buildManifest } from '../manifest.js';
import { VERSION } from '../version.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from './nodes.js';
import { sourceSpanOf } from './span.js';
import { fromPortableIr, toPortableIr, type PortableIr } from './portable.js';

const corpus = [...examples, ...shadeExamples].filter(
  (e): e is typeof e & { module: ModuleDecl } => e.module !== undefined,
);

/** `m` through its portable IR and JSON, the way a manifest carries it. */
function roundTrip(m: ModuleDecl, reviver?: (key: string, value: unknown) => unknown): ModuleDecl {
  return fromPortableIr(JSON.parse(JSON.stringify(toPortableIr(m)), reviver) as PortableIr);
}

/** What `emit` gives: its text, or the sentence it refused with. */
function attempt(emit: () => string): string {
  try {
    return emit();
  } catch (e) {
    return `refused: ${(e as Error).message}`;
  }
}

/** Everything the round trip is held to. */
function emitted(m: ModuleDecl) {
  const recorded = consoleBuffer(m);
  return {
    wgsl: attempt(() => emitModule(m)),
    vertex: attempt(() => emitGlslModule(m, 'vertex')),
    fragment: attempt(() => emitGlslModule(m, 'fragment')),
    reflect: reflect(m),
    console: {
      wgsl: attempt(() => emitModule(recorded.module)),
      log: recorded.log,
      notRecorded: recorded.notRecorded,
    },
    manifest: JSON.stringify(buildManifest(m, { console: true })),
  };
}

/** The module `src` compiles to, with no error. */
function compiled(src: string): ModuleDecl {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module!;
}

describe('the portable IR (change 0025, section 5)', () => {
  it(`covers the corpus (${corpus.length} modules), a console call among them`, () => {
    expect(corpus.length).toBeGreaterThan(80);
    expect(corpus.some((e) => consoleBuffer(e.module).log !== undefined)).toBe(true);
  });

  for (const ex of corpus) {
    it(`${ex.id}: emits the same through JSON`, () => {
      const ir = toPortableIr(ex.module);
      // Plain JSON: it survives JSON unchanged, `-0` included.
      expect(JSON.parse(JSON.stringify(ir))).toEqual(ir);
      expect(emitted(roundTrip(ex.module))).toEqual(emitted(ex.module));
    });
  }

  it('keeps a subtree the IR shares by identity', () => {
    // `voronoi` assigns an EDSL value it declared, and `autoVars` finds the value by identity
    // as the target and inside `min(…)`. Written as a tree, the read becomes the initial value.
    const m = corpus.find((e) => e.id === 'voronoi')!.module;
    expect(emitModule(m)).toContain('_av0 = min(_av0, ');
    expect(emitModule(roundTrip(m))).toBe(emitModule(m));
    expect(emitModule(treeCopy(m))).not.toContain('_av0 = min(_av0, ');
  });

  it('keeps -0', () => {
    // CSE tells `-0.0` from `0.0` (`x * -0.0` is -0 where `x * 0.0` is 0), so the four
    // products stay apart. Written as 0, they merge into two.
    const m = compiled(`"use typeshade";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(uv.x * -0.0, uv.x * 0.0, uv.y * -0.0, uv.y * 0.0);
}
`);
    const back = roundTrip(m);
    expect(emitted(back)).toEqual(emitted(m));
    expect(emitModule(back)).not.toContain('_cse');
    const lost = roundTrip(m, (_k, v) =>
      typeof v === 'object' && v !== null && '#' in v
        ? Number((v as { '#': string })['#']) || 0
        : v,
    );
    expect(emitModule(lost)).toContain('_cse');
    expect(emitGlslModule(lost, 'fragment')).not.toBe(emitGlslModule(m, 'fragment'));
  });

  it("keeps a call's declRef: a declared function that shadows a builtin", () => {
    // A call resolves to the module's own `pack4xU8` because it carries `declRef`; without it,
    // the call is the builtin, which GLSL ES 3.00 has no form of.
    const m = compiled(`"use typeshade";
export function pack4xU8(v: vec4u): u32 {
  return v.x;
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const p = pack4xU8(vec4u(7, 0, 0, 0));
  return vec4(f32(p) * 0., 0., 0., 1.);
}
`);
    const back = roundTrip(m);
    expect(emitted(back)).toEqual(emitted(m));
    expect(emitGlslModule(back, 'fragment')).toContain('uint pack4xU8(');
    // The reference is to the function the module holds, not a copy of it.
    const call = callsIn(back).find((c) => c.fn === 'pack4xU8')!;
    expect(call.declRef).toBe(back.funcs.find((f) => f.name === 'pack4xU8'));
    const lost = roundTrip(m, (k, v) => (k === 'declRef' ? undefined : v));
    expect(attempt(() => emitGlslModule(lost, 'fragment'))).toBe(
      'refused: glsl-es300: pack4xU8 has no GLSL ES 3.00 form',
    );
  });

  it("keeps an entry's span and a console call's, and drops the rest", () => {
    const m = compiled(`"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function twice(x: f32): f32 {
  return x * 2.;
}
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const v = twice(f32(gid.x));
  console.log("v", v);
  out[gid.x] = v;
}
`);
    const back = roundTrip(m);
    const entry = (x: ModuleDecl) => x.funcs.find((f) => f.name === 'cs')!;
    const helper = (x: ModuleDecl) => x.funcs.find((f) => f.name === 'twice')!;
    expect(sourceSpanOf(entry(back))).toEqual(sourceSpanOf(entry(m)));
    expect(sourceSpanOf(entry(m))).toBeDefined();
    expect(sourceSpanOf(helper(m))).toBeDefined();
    expect(sourceSpanOf(helper(back))).toBeUndefined();
    const logged = (x: ModuleDecl) =>
      entry(x).body.find((s): s is Extract<Stmt, { s: 'call' }> => s.s === 'call')!;
    expect(sourceSpanOf(logged(back))).toEqual(sourceSpanOf(logged(m)));
    expect(sourceSpanOf(logged(back).expr)).toEqual(sourceSpanOf(logged(m).expr));
    expect(entry(back).body.filter((s) => s.s !== 'call' && sourceSpanOf(s) !== undefined)).toEqual(
      [],
    );
    expect(emitted(back)).toEqual(emitted(m));
  });

  it('closes a cycle onto the object it started from', () => {
    // WGSL has no recursion, but a hand-built FuncDecl can reach itself through a call's
    // `declRef`, and the writer must not follow it forever.
    const f32T = { kind: 'scalar', scalar: 'f32' } as const;
    const self: { -readonly [K in keyof FuncDecl]: FuncDecl[K] } = {
      name: 'f',
      params: [],
      ret: f32T,
      body: [],
    };
    const call: Expr = { op: 'call', type: f32T, fn: 'f', args: [], declRef: self };
    self.body = [{ s: 'return', expr: call }];
    const back = fromPortableIr(
      JSON.parse(
        JSON.stringify(toPortableIr({ consts: [], structs: [], bindings: [], funcs: [self] })),
      ) as PortableIr,
    );
    const f = back.funcs[0]!;
    const ret = f.body[0] as Extract<Stmt, { s: 'return' }>;
    expect((ret.expr as Extract<Expr, { op: 'call' }>).declRef).toBe(f);
  });

  it('refuses IR another version wrote, naming both versions', () => {
    const ir = toPortableIr(corpus[0]!.module);
    expect(() => fromPortableIr({ ...ir, compiler: '0.0.0-other' })).toThrow(
      `This program's IR was written by typeshade 0.0.0-other, and this is typeshade ${VERSION}: only the version that wrote it reads it. Build the program again with typeshade ${VERSION}; its emitted text still loads as it is.`,
    );
  });
});

/** Every call expression in `m`'s function bodies. */
function callsIn(m: ModuleDecl): Extract<Expr, { op: 'call' }>[] {
  const out: Extract<Expr, { op: 'call' }>[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    const x = v as { op?: unknown };
    if (x.op === 'call') out.push(v as Extract<Expr, { op: 'call' }>);
    for (const [k, c] of Object.entries(v)) if (k !== 'declRef') walk(c);
  };
  for (const f of m.funcs) walk(f.body);
  return out;
}

/** A copy of `m` in which no object is shared: what a writer that ignored identity would give. */
function treeCopy(m: ModuleDecl): ModuleDecl {
  const copy = (v: unknown): unknown => {
    if (typeof v === 'function') return copy({ ...(v as object) });
    if (typeof v !== 'object' || v === null) return v;
    if (Array.isArray(v)) return v.map(copy);
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== 'decl' && k !== 'declRef')
        .map(([k, x]) => [k, copy(x)]),
    );
  };
  return copy(m) as ModuleDecl;
}
