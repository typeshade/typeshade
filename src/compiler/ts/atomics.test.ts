// Atomics in "use typeshade" (roadmap 0.2 item 4). `atomic<u32>` and `atomic<i32>` are
// locations in storage memory; the ten atomic builtins take one by pointer on WGSL, and this
// surface writes the location as the plain expression (`atomicAdd(bins[bin], 1)`). Measured
// on `main` before this: `atomic` was an unknown type and every builtin an unknown function.
// What is pinned here: the WGSL each spelling emits (Tint accepts the histogram example in the
// compile gate), the three CPU backends agreeing on a kernel that counts, the optimizer
// leaving an atomic call alone, the effect table seeing the write, and the refusals a wrong
// program gets, each naming the fix.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { startDebugSession } from '../../core/debug/session.js'
import { reflect } from '../../core/reflect.js'
import { fnWrites } from '../../core/passes/effects.js'
import { optimizeAt } from '../../core/passes/opt/optimize.js'
import { emitModule } from '../../core/backends/wgsl.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

const HISTOGRAM = `"use typeshade";
declare const src: storage<array<f32>>;
declare let bins: storage<array<atomic<u32>>>;
declare let total: storage<atomic<u32>>;
class Stats { hits: atomic<u32>; peak: atomic<i32>; }
declare let stats: storage<Stats>;
@compute([64, 1, 1])
export function histogram(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(src)) {
    return;
  }
  const bin = u32(src[gid.x] * 4.);
  atomicAdd(bins[bin], 1);
  const before = atomicAdd(total, 1);
  atomicMax(stats.peak, i32(before));
  if (before === 0) {
    atomicStore(stats.hits, 7);
  }
  atomicXor(stats.hits, 1);
}
`

const SRC = [0.1, 0.3, 0.3, 0.9, 0.5]

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

/** Run `entry` once per invocation index on one CPU backend, over the given bindings. */
function runAll(
  make: typeof compileModule,
  src: string,
  entry: string,
  invocations: number,
  bindings: Record<string, CpuValue>,
): void {
  const r = compile(src)
  expect(r.diagnostics).toEqual([])
  const cm = make(r.module)
  for (const [k, v] of Object.entries(bindings)) cm.setBinding(k, v)
  for (let g = 0; g < invocations; g++) cm.fns[entry]!([g, 0, 0])
}

describe('atomics: the WGSL', () => {
  it('declares atomic<u32> / atomic<i32> in storage and spells each builtin through a pointer', () => {
    const r = compile(HISTOGRAM)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain('var<storage, read_write> bins: array<atomic<u32>>;')
    expect(w).toContain('var<storage, read_write> total: atomic<u32>;')
    expect(w).toContain('  hits: atomic<u32>,')
    expect(w).toContain('  peak: atomic<i32>,')
    // A dropped read-modify-write result takes WGSL's phony assignment (issue #47's rule);
    // one that is bound is a plain `let`; `atomicStore` returns nothing and stands bare.
    expect(w).toContain('  _ = atomicAdd(&bins[bin], 1u);')
    expect(w).toContain('  let before = atomicAdd(&total, 1u);')
    expect(w).toContain('  _ = atomicMax(&stats.peak, i32(before));')
    expect(w).toContain('    atomicStore(&stats.hits, 7u);')
    expect(w).toContain('  _ = atomicXor(&stats.hits, 1u);')
    // A compute-only module has no GLSL to emit, and no diagnostic for its absence.
    expect(r.glsl).toBeUndefined()
  })

  it('a bare integer literal takes the atomic element type, u32 or i32', () => {
    const r = compile(`"use typeshade";
declare let counts: storage<array<atomic<i32>>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  atomicSub(counts[gid.x], 3);
  atomicStore(counts[0], -1);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('_ = atomicSub(&counts[gid.x], 3);')
    expect(r.wgsl).toContain('atomicStore(&counts[0], -1);')
  })
})

describe('atomics: the CPU backends', () => {
  it('the oracle and the codegen count every invocation, in order', () => {
    for (const make of [compileModule, compileModuleJs]) {
      const bins = [0, 0, 0, 0, 0]
      const stats = { hits: 0, peak: -1 }
      runAll(make, HISTOGRAM, 'histogram', 8, { src: SRC, bins, total: 0, stats })
      // 0.1, 0.3, 0.3, 0.9, 0.5 land in bins 0, 1, 1, 3, 2; three invocations past the
      // length return before touching anything.
      expect(bins, make.name).toEqual([1, 2, 1, 1, 0])
      // The first invocation saw 0 and stored 7; five XORs by 1 then leave 6. The peak is the
      // largest `before`, 4.
      expect(stats, make.name).toEqual({ hits: 6, peak: 4 })
    }
  })

  it('the debugger steps the kernel to the same values', () => {
    const r = compile(HISTOGRAM)
    const bins = [0, 0, 0, 0, 0]
    const stats = { hits: 0, peak: -1 }
    const bindings: Record<string, CpuValue> = { src: SRC, bins, total: 0, stats }
    for (let g = 0; g < 5; g++) {
      const s = startDebugSession(r.module, 'histogram', [[g, 0, 0]], { bindings })
      s.continue()
      expect(s.done).toBe(true)
    }
    expect(bins).toEqual([1, 2, 1, 1, 0])
    // Each session starts from the bindings it was given, so `total` is 0 to every one of
    // them and every invocation is "first": each stores 7 and then flips the low bit.
    expect(stats).toEqual({ hits: 6, peak: 0 })
  })

  it('every read-modify-write returns the old value and wraps or masks like the GPU', () => {
    const src = `"use typeshade";
declare let xs: storage<array<atomic<u32>>>;
declare let out: storage<array<u32>>;
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = atomicLoad(xs[0]);
  out[1] = atomicExchange(xs[1], 42);
  out[2] = atomicAnd(xs[2], 65280);
  out[3] = atomicOr(xs[3], 8);
  out[4] = atomicAdd(xs[4], 2);
  out[5] = atomicSub(xs[5], 9);
  out[6] = atomicMin(xs[0], 4);
  out[7] = atomicMax(xs[1], 40);
}
`
    for (const make of [compileModule, compileModuleJs]) {
      const xs = [10, 3, 61680, 5, 4294967295, 7]
      const out = [0, 0, 0, 0, 0, 0, 0, 0]
      runAll(make, src, 'k', 1, { xs, out })
      expect(out, make.name).toEqual([10, 3, 61680, 5, 4294967295, 7, 10, 42])
      // 61680 & 65280 = 61440; 5 | 8 = 13; 4294967295 + 2 wraps to 1; 7 - 9 wraps to
      // 4294967294; min(10, 4) = 4; max(42, 40) = 42.
      expect(xs, make.name).toEqual([4, 42, 61440, 13, 1, 4294967294])
    }
  })

  it('an atomic<i32> wraps as a signed integer', () => {
    const src = `"use typeshade";
declare let xs: storage<array<atomic<i32>>>;
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  atomicAdd(xs[0], 1);
  atomicSub(xs[1], 1);
}
`
    for (const make of [compileModule, compileModuleJs]) {
      const xs = [2147483647, -2147483648]
      runAll(make, src, 'k', 1, { xs })
      expect(xs, make.name).toEqual([-2147483648, 2147483647])
    }
  })
})

describe('atomics: the optimizer and the effect table', () => {
  it('keeps two atomicAdds on one location and never merges them', () => {
    const r = compile(`"use typeshade";
declare let bins: storage<array<atomic<u32>>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  atomicAdd(bins[gid.x], 1);
  atomicAdd(bins[gid.x], 1);
}
`)
    expect(r.diagnostics).toEqual([])
    const w = emitModule(optimizeAt(r.module, 'O2'))
    expect(w.match(/atomicAdd\(&bins\[gid\.x\], 1u\);/g)).toHaveLength(2)
    const bins = [0, 0, 0]
    runAll(
      compileModule,
      r.wgsl === undefined
        ? ''
        : `"use typeshade";
declare let bins: storage<array<atomic<u32>>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  atomicAdd(bins[gid.x], 1);
  atomicAdd(bins[gid.x], 1);
}
`,
      'k',
      3,
      { bins },
    )
    expect(bins).toEqual([2, 2, 2])
  })

  it('never shares an atomicLoad across a store to the same location', () => {
    const src = `"use typeshade";
declare let bins: storage<array<atomic<u32>>>;
declare let out: storage<array<u32>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  const a = atomicLoad(bins[gid.x]);
  atomicStore(bins[gid.x], 5);
  const b = atomicLoad(bins[gid.x]);
  out[gid.x] = a + b;
}
`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const w = emitModule(optimizeAt(r.module, 'O2'))
    expect(w.match(/atomicLoad\(&bins\[gid\.x\]\)/g)).toHaveLength(2)
    const bins = [1]
    const out = [0]
    runAll(compileModule, src, 'k', 1, { bins, out })
    expect(out).toEqual([6])
  })

  it('names the binding an atomic writes, itself and through a helper; a load writes nothing', () => {
    const r = compile(`"use typeshade";
declare let bins: storage<array<atomic<u32>>>;
function bump(i: u32): void {
  atomicAdd(bins[i], 1);
}
function peek(i: u32): u32 {
  return atomicLoad(bins[i]);
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  bump(gid.x);
  atomicStore(bins[0], peek(gid.x));
}
`)
    expect(r.diagnostics).toEqual([])
    const w = fnWrites(r.module)
    expect([...w.get('bump')!]).toEqual(['bins'])
    expect([...w.get('peek')!]).toEqual([])
    expect([...w.get('k')!]).toEqual(['bins'])
    // The helper's call statement survives the per-function fixpoint (issue #47's hazard).
    expect(emitModule(optimizeAt(r.module, 'O2'))).toContain('bump(gid.x);')
  })
})

describe('atomics: reflection', () => {
  it('lays an atomic out as its 4-byte integer', () => {
    const r = compile(HISTOGRAM)
    const stats = reflect(r.module).storage.find((s) => s.name === 'Stats')
    expect(stats?.size).toBe(8)
    expect(stats?.fields.map((f) => [f.name, f.offset])).toEqual([
      ['hits', 0],
      ['peak', 4],
    ])
  })
})

describe('atomics: what is refused, and what the fix is', () => {
  const HEAD = `"use typeshade"
declare let bins: storage<array<atomic<u32>>>
declare const ro: storage<array<atomic<u32>>>
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
`
  const BARE =
    `${TS_CODES.TYPE_MISMATCH} "bins[gid.x]" is an atomic<u32>: read it with atomicLoad(bins[gid.x]) ` +
    `and write it with atomicStore(bins[gid.x], v) or atomicAdd(bins[gid.x], v). An atomic is never read or assigned directly.`

  it('a plain read or assignment of an atomic location', () => {
    expect(errorsOf(`${HEAD}  const x = bins[gid.x] + 1\n}\n`)).toEqual([BARE])
    expect(errorsOf(`${HEAD}  bins[gid.x] = 1\n}\n`)).toEqual([BARE])
  })

  it('a read-only binding, which no atomic builtin may take', () => {
    expect(errorsOf(`${HEAD}  atomicAdd(ro[gid.x], 1)\n}\n`)).toEqual([
      `${TS_CODES.CONST_ASSIGN} atomicAdd needs read_write access to "ro", which is declared const; declare it with let.`,
    ])
    expect(errorsOf(`${HEAD}  const v = atomicLoad(ro[gid.x])\n}\n`)).toEqual([
      `${TS_CODES.CONST_ASSIGN} atomicLoad needs read_write access to "ro", which is declared const; declare it with let.`,
    ])
  })

  it('a value of the wrong type, a location that is not atomic, the wrong number of arguments', () => {
    expect(errorsOf(`${HEAD}  atomicAdd(bins[gid.x], 1.5)\n}\n`)).toEqual([
      `${TS_CODES.TYPE_MISMATCH} atomicAdd value must be u32 to match the atomic<u32>, got f32.`,
    ])
    expect(errorsOf(`${HEAD}  atomicAdd(gid.x, 1)\n}\n`)).toEqual([
      `${TS_CODES.TYPE_MISMATCH} atomicAdd takes an atomic<u32> or atomic<i32> location (an element of a storage<array<atomic<u32>>>, a field of a storage struct, or a storage<atomic<u32>> binding), got u32.`,
    ])
    expect(errorsOf(`${HEAD}  atomicLoad(bins[gid.x], 1)\n}\n`)).toEqual([
      `${TS_CODES.ARITY_MISMATCH} atomicLoad expects 1 argument, got 2.`,
    ])
  })

  it('an atomic declared anywhere but inside a storage binding', () => {
    const where = (w: string) =>
      `${TS_CODES.UNSUPPORTED} atomic<u32> lives in storage or workgroup memory only: declare it inside a storage binding (declare let counters: storage<array<atomic<u32>>>) or a workgroup variable (let tile: workgroup<array<atomic<u32>, 64>>), not as ${w}.`
    expect(errorsOf(`${HEAD}  let a: atomic<u32> = 0\n}\n`)).toEqual([where('a local')])
    expect(
      errorsOf(`"use typeshade";
function f(a: atomic<u32>): u32 { return 1; }
@fragment
export function fs(): vec4 { return vec4(1.); }
`),
    ).toEqual([where('a parameter')])
    expect(
      errorsOf(`"use typeshade";
declare const u: uniform<array<atomic<u32>>>;
@fragment
export function fs(): vec4 { return vec4(1.); }
`),
    ).toEqual([
      `${TS_CODES.UNSUPPORTED} "u" holds an atomic<u32>, which lives in storage memory only: write "declare let u: storage<array<atomic<u32>>>".`,
    ])
  })

  it('an element type that is not u32 or i32', () => {
    const errors = errorsOf(`"use typeshade";
declare let b: storage<array<atomic<f32>>>;
@fragment
export function fs(): vec4 { return vec4(1.); }
`)
    expect(errors[0]).toContain('atomic<T> T must be u32 or i32.')
  })

  it('refuses atomicAdd in a vertex entry', () => {
    // "Atomic built-in functions must not be used in a vertex shader stage" (wgsl.txt:25422;
    // core.def:1611-1616 spells every one `@stage("fragment", "compute")`), and the read_write
    // storage the location lives in is not reachable from a vertex stage either
    // (wgsl.txt:15342). Nothing checked the stage, so the module emitted clean and Tint refused
    // it. A fragment entry is legal and stays so.
    const vs = (body: string): string => `"use typeshade"
class Clip { @builtin("position") pos: vec4 }
declare let total: storage<atomic<u32>>
${body}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const n = ${body === '' ? 'atomicAdd(total, 1)' : 'bump()'}
  return { pos: vec4(f32(n), 0., 0., 1.) }
}
`
    expect(errorsOf(vs(''))).toEqual([
      `${TS_CODES.UNSUPPORTED} "atomicAdd" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows an atomic built-in in a fragment or compute stage only.`,
    ])
    // Through a helper the entry reaches, with the chain named, as `discard` and the
    // derivatives already were.
    expect(errorsOf(vs('function bump(): u32 { return atomicAdd(total, 1) }'))).toEqual([
      `${TS_CODES.UNSUPPORTED} "atomicAdd" is only valid in a fragment or compute shader; "bump" is reachable from the vertex entry "vs". WGSL allows an atomic built-in in a fragment or compute stage only.`,
    ])
    // Every atomic builtin, not just the one: the set is read off the intrinsic catalogue.
    expect(
      errorsOf(`"use typeshade";
class Clip { @builtin("position") pos: vec4; }
declare let total: storage<atomic<u32>>;
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const n = atomicLoad(total);
  return { pos: vec4(f32(n), 0., 0., 1.) };
}
`),
    ).toEqual([
      `${TS_CODES.UNSUPPORTED} "atomicLoad" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows an atomic built-in in a fragment or compute stage only.`,
    ])
    // A fragment entry is where an atomic is legal outside a compute one.
    expect(
      errorsOf(`"use typeshade";
class Color { @location(0) color: vec4; }
declare let total: storage<atomic<u32>>;
@fragment
export function fs(): Color {
  atomicAdd(total, 1);
  return { color: vec4(1., 0., 0., 1.) };
}
`),
    ).toEqual([])
  })

  it('a function the file declares under an atomic name keeps winning the call', () => {
    const r = compileTsSource(`"use typeshade";
function atomicAdd(a: u32, b: u32): u32 { return a + b; }
@fragment
export function fs(): vec4 { return vec4(f32(atomicAdd(1, 2)), 0., 0., 1.); }
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('fn atomicAdd(a: u32, b: u32) -> u32 {')
    expect(r.wgsl).not.toContain('&')
  })
})

// `atomicCompareExchangeWeak` (#152, wgsl.txt:25584): the eleventh atomic, and the only one
// that answers a STRUCT. Every rule below is one Tint states in its own words, measured with a
// broken shader fed to the same instrument first.
describe('atomicCompareExchangeWeak answers a struct WGSL will not let you name', () => {
  const CAS = `"use typeshade";
declare let lock: storage<atomic<u32>>;
declare let o: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const r = atomicCompareExchangeWeak(lock, 0, 7);
  o[0] = r.old_value;
  o[1] = r.exchanged ? 1 : 0;
}
`

  it('emits the pointer form and binds the result by inference', () => {
    const r = compile(CAS)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The result type is `__atomic_compare_exchange_result<T>`, which WGSL gives no way to
    // write: measured on Tint, a variable declared with it is "invalid type for variable
    // declaration". So the `let` names no type and NO struct is declared for it — the emitted
    // module must not carry one, because WGSL's is built in.
    expect(r.wgsl).toContain('let r = atomicCompareExchangeWeak(&lock, 0u, 7u);')
    expect(r.wgsl).not.toContain('struct __atomic_compare_exchange_result')
    expect(r.wgsl).toContain('o[0] = r.old_value;')
    // The field names are WGSL's own, in snake_case: `r.oldValue` is "struct member oldValue
    // not found" on Tint, so the surface spells them the way the target does.
    expect(r.wgsl).not.toContain('oldValue')
    // This exact text was compiled on Tint, which accepted it.
  })

  it('answers the same values on both CPU backends, exchanging only on a match', () => {
    const r = compile(CAS)
    for (const make of [compileModule, compileModuleJs]) {
      for (const [start, expected] of [
        [0, [0, 1]],
        [5, [5, 0]],
      ] as const) {
        const out = [0, 0]
        const cm = make(r.module)
        cm.setBinding('lock', start as unknown as CpuValue)
        cm.setBinding('o', out as unknown as CpuValue)
        cm.fns['cs']!([0, 0, 0])
        expect(out, `${make.name} from ${String(start)}`).toEqual([...expected])
      }
    }
  })

  it("takes three arguments, both of the atomic's own kind", () => {
    const bad = (call: string): string[] =>
      compileTsSource(`"use typeshade"
declare let lock: storage<atomic<u32>>
declare let o: storage<array<u32>>
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const r = ${call}
  o[0] = r.old_value
}
`)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => d.message)
    expect(bad('atomicCompareExchangeWeak(lock, 0)')[0]).toBe(
      'atomicCompareExchangeWeak expects 3 arguments, got 2.',
    )
    // A bare integer literal is retargeted to the atomic's kind, as everywhere else, so only a
    // value with a type of its own can mismatch.
    expect(bad('atomicCompareExchangeWeak(lock, i32(0), 7)')[0]).toBe(
      'atomicCompareExchangeWeak compare must be u32 to match the atomic<u32>, got i32.',
    )
    expect(bad('atomicCompareExchangeWeak(lock, 0, i32(7))')[0]).toBe(
      'atomicCompareExchangeWeak value must be u32 to match the atomic<u32>, got i32.',
    )
  })

  it('works on an i32 atomic too, and keeps the atomic rules it shares', () => {
    const r = compile(`"use typeshade";
declare let lock: storage<atomic<i32>>;
declare let o: storage<array<i32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const r = atomicCompareExchangeWeak(lock, -1, 7);
  o[0] = r.old_value;
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('atomicCompareExchangeWeak(&lock, -1, 7)')
    // A `declare const` binding is read-only, and every atomic builtin needs read_write.
    expect(
      compileTsSource(`"use typeshade";
declare const lock: storage<atomic<u32>>;
declare let o: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const r = atomicCompareExchangeWeak(lock, 0, 7);
  o[0] = r.old_value;
}
`)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => d.message)[0],
    ).toContain('needs read_write access to "lock"')
  })

  // #152's row L08, deferred with its reason rather than silently dropped: WGSL marks
  // `atomicStoreMin`/`atomicStoreMax` on an `atomic<vec2<u32>>` "proposed, After 1.0"
  // (wgsl.txt:25629) and no shipping driver has them, so there is nothing to measure a
  // lowering against and `atomic.elem` would have to grow a vector arm for a call that cannot
  // reach a device. The note beside `ATOMIC_INTRINSICS` says the same.
  it.todo('#152 row L08: atomicStoreMin/atomicStoreMax on an atomic<vec2<u32>>, after WGSL 1.0')
})
