import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

describe('module const', () => {
  it('folds LIMIT: i32 = 16 to a module ConstDecl + constref', () => {
    const r = compileTsSource(`
      "use typeshade";
      const LIMIT: i32 = 16;
      export function f(): i32 { return LIMIT; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.consts[0]?.name).toBe('LIMIT')
    expect(r.consts[0]?.cpuValue).toBe(16)
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('constref')
    expect(r.wgsl).toMatch(/const LIMIT/)
  })

  // #13 — the existing arm above asserts the const EXISTS in the WGSL; it never asserted how
  // the value was SPELLED, and the spelling was wrong for every type but f32. `emitConst`
  // formatted with the float writer regardless of `ConstDecl.type`, so this compiled with no
  // diagnostic and emitted `const WINDOW: u32 = 8.0;` — rejected by Tint.
  it('spells an integer, bool and f32 module const for its declared type', () => {
    const r = compileTsSource(`
      "use typeshade";
      const KU: u32 = 8;
      const KI: i32 = -3;
      const KF: f32 = 2.5;
      const KB: bool = true;
      export function f(): u32 { return KU; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('const KU: u32 = 8u;')
    expect(r.wgsl).toContain('const KI: i32 = -3;')
    expect(r.wgsl).toContain('const KF: f32 = 2.5;')
    expect(r.wgsl).toContain('const KB: bool = true;')
  })

  // The issue's own repro, whole: a compute kernel whose window size is a module const.
  it('emits a usable integer const as a loop bound and a multiplier (the #13 repro)', () => {
    const r = compileTsSource(`
      "use typeshade";
      const WINDOW: u32 = 8;
      declare const input: storage<array<f32>>;
      declare const output: storage<array<f32>, "read_write">;
      @compute([64, 1, 1])
      export function reduce_windows(@builtin("global_invocation_id") gid: vec3u): void {
        let sum = 0.;
        for (let j: u32 = 0; j < WINDOW; j++) { sum = sum + input[gid.x * WINDOW + j]; }
        output[gid.x] = sum;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('const WINDOW: u32 = 8u;')
    // The float spelling is the whole bug — assert it is gone, not merely that 8u appears.
    expect(r.wgsl).not.toContain('8.0')
  })

  // #13 follow-up. Routing `emitConst` through `intLit` means an out-of-range integer const
  // would THROW from inside `emitModule`, where the caller cannot attribute it to a line —
  // and the front end's emit path turns that into no diagnostic at all and a truncated
  // module. Diagnosed at lowering instead, so `wgsl` stays undefined and the reader sees why.
  it.each([
    ['u32', '5000000000', 'outside [0, 4294967295]'],
    ['u32', '-1', 'outside [0, 4294967295]'],
    ['i32', '3000000000', 'outside [-2147483648, 2147483647]'],
    ['i32', '-3000000000', 'outside [-2147483648, 2147483647]'],
  ])('rejects an out-of-range %s module const (%s)', (type, value, tail) => {
    const r = compileTsSource(`
      "use typeshade";
      const K: ${type} = ${value};
      export function f(): ${type} { return K; }
    `)
    const errs = r.diagnostics.filter((d) => d.category === 'error')
    expect(errs[0]?.message).toContain(`Module const "K" is ${type}, but ${value} is ${tail}`)
    expect(errs[0]?.code).toBe(TS_CODES.TYPE_MISMATCH)
    expect(r.wgsl).toBeUndefined()
  })

  // #64 — the bool arm was not moved with the integer ones, so `const K: bool = 2` reached the
  // writers' fail-closed bool literal arm and came back as a wrapped SD0017 (TS8015) anchored
  // on the file's `"use typeshade"` directive, a line that says nothing about the declaration.
  it.each([
    ['2', '2'],
    ['-1', '-1'],
    ['0.5', '0.5'],
  ])('rejects a bool module const that is neither true nor false (%s)', (value, shown) => {
    const src = `"use typeshade";
const K: bool = ${value};
export function f(): bool { return K; }
`
    const r = compileTsSource(src)
    const errs = r.diagnostics.filter((d) => d.category === 'error')
    expect(errs[0]?.message).toBe(
      `Module const "K" is bool, but ${shown} is neither true nor false. Write true, false, 1 or 0.`,
    )
    expect(errs[0]?.code).toBe(TS_CODES.TYPE_MISMATCH)
    // On the declaration, the way the integer arms report, not on the directive.
    expect(src.slice(errs[0]!.start, errs[0]!.start + errs[0]!.length)).toBe(`K: bool = ${value}`)
    expect(r.wgsl).toBeUndefined()
  })

  it('keeps the four bool values a target can spell', () => {
    const r = compileTsSource(`
      "use typeshade";
      const T: bool = true;
      const F: bool = false;
      const ONE: bool = 1;
      const ZERO: bool = 0;
      export function f(): bool { return T; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('const T: bool = true;')
    expect(r.wgsl).toContain('const F: bool = false;')
    expect(r.wgsl).toContain('const ONE: bool = true;')
    expect(r.wgsl).toContain('const ZERO: bool = false;')
  })

  it('rejects a fractional integer module const instead of truncating it', () => {
    // It used to become 1 through `Math.trunc`, with nothing said.
    const r = compileTsSource(`
      "use typeshade";
      const K: i32 = 1.5;
      export function f(): i32 { return K; }
    `)
    const errs = r.diagnostics.filter((d) => d.category === 'error')
    expect(errs[0]?.message).toContain('Module const "K" is i32, but 1.5 is not an integer')
    expect(r.wgsl).toBeUndefined()
  })

  it('keeps the boundary values, which are in range', () => {
    const r = compileTsSource(`
      "use typeshade";
      const LO: i32 = -2147483648;
      const HI: u32 = 4294967295;
      export function f(): u32 { return HI; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('const LO: i32 = -2147483648;')
    expect(r.wgsl).toContain('const HI: u32 = 4294967295u;')
  })

  it('folds const expressions and later consts', () => {
    const r = compileTsSource(`
      "use typeshade";
      const A: i32 = 4;
      const B: i32 = A + A;
      export function f(): i32 { return B; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.consts.map((c) => c.cpuValue)).toEqual([4, 8])
  })

  it('lets two functions read the same module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const GAIN: f32 = 2.;
      export function a(x: f32): f32 { return x * GAIN; }
      export function b(x: f32): f32 { return x + GAIN; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs).toHaveLength(2)
  })

  it('rejects assigning to a module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const LIMIT: i32 = 16;
      export function f(): i32 {
        LIMIT = 1;
        return LIMIT;
      }
    `)
    expect(r.diagnostics.some((d) => /const|immutable|assign/i.test(d.message))).toBe(true)
  })

  it('rejects a non-foldable module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const BAD: f32 = foo;
      export function f(): f32 { return BAD; }
    `)
    expect(
      r.diagnostics.some((d) => /foldable|Unknown identifier|Module const/.test(d.message)),
    ).toBe(true)
  })

  it('a top-level let is a module variable (§24), not a const', () => {
    const r = compileTsSource(`
      "use typeshade";
      let acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(false)
    expect(r.wgsl).toContain('var<private> acc: f32 = 0.0;')
    expect(r.wgsl).not.toContain('const acc')
  })
})
