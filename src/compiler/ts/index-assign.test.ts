import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

describe('xs[i] = v', () => {
  it('assigns into a local vector slot', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): vec3 {
        let v = vec3(1., 2., 3.);
        v[1] = 0.;
        return v;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const asg = r.funcs[0]!.body.find((s) => s.s === 'assign')
    expect(asg?.s).toBe('assign')
    if (asg && asg.s === 'assign') expect(asg.target.op).toBe('index')
  })

  it('rejects a constant OOB write', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): vec3 {
        let v = vec3(1., 2., 3.);
        v[3] = 0.;
        return v;
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true)
  })

  it('rejects writing through a parameter', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 4>, i: i32): void {
        xs[i] = 1.;
      }
    `)
    expect(r.diagnostics.some((d) => /parameter|not writable|storage/.test(d.message))).toBe(true)
  })

  it('allows a runtime index write on a local vec', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: i32): vec3 {
        let v = vec3(1., 2., 3.);
        v[i] = 0.;
        return v;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})
