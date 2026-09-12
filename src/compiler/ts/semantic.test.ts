import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

describe('Phase 12 semantic bans', () => {
  it('rejects console.log', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        console.log(1.);
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_API && /console/.test(d.message))).toBe(true)
    expect(r.wgsl).toBeUndefined()
  })

  it('rejects fetch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        fetch("x");
        return 1.;
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_API)).toBe(true)
  })

  it('rejects Date / new', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        const t = new Date();
        return 1.;
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_API || d.code === TS_CODES.HOST_STMT)).toBe(true)
  })

  it('rejects await and async', () => {
    const r = compileTsSource(`
      "use typeshade";
      export async function f(): Promise<f32> {
        return await 1.;
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true)
  })

  it('rejects for-of', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: vec3): f32 {
        for (const x of xs) { }
        return 0.;
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT && /for-of/.test(d.message))).toBe(true)
  })

  it('rejects try/catch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        try { return 1.; } catch { return 0.; }
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true)
  })

  it('rejects top-level let', () => {
    const r = compileTsSource(`
      "use typeshade";
      let acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(true)
  })

  it('still compiles a pure helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function add(a: f32, b: f32): f32 {
        return a + b;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toEqual(expect.any(String))
  })
})
