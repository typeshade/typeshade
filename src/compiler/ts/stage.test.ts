import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('@compute + gid', () => {
  it('marks @compute([64]) as a compute entry with gid', () => {
    const r = compileTsSource(`
      "use typeshade";
      @compute([64])
      export function paint(): void {
        const i = gid.x;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const f = r.funcs.find((fn) => fn.name === 'paint')!
    expect(f.stage).toBe('compute')
    expect(f.workgroupSize).toBe(64)
    expect(f.params.some((p) => p.name === 'gid' && p.builtin === 'global_invocation_id')).toBe(true)
    expect(f.attrs?.some((a) => a.includes('workgroup_size'))).toBe(true)
  })

  it('rejects gid in a helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function helper(): u32 {
        return gid.x;
      }
    `)
    expect(r.diagnostics.some((d) => /@compute/.test(d.message))).toBe(true)
  })

  it('accepts bare @compute as workgroup 64', () => {
    const r = compileTsSource(`
      "use typeshade";
      @compute
      export function paint(): void {}
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.workgroupSize).toBe(64)
  })
})
