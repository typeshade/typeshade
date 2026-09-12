import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('++ / --', () => {
  it('lowers i++ and ++i as assign', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(start: u32): u32 {
        let i = start;
        i++;
        ++i;
        i--;
        --i;
        return i;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const body = r.funcs[0]!.body
    const assigns = body.filter((s) => s.s === 'assign')
    expect(assigns.length).toBe(4)
  })

  it('rejects ++ as a value', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: u32): u32 {
        return i++;
      }
    `)
    expect(r.diagnostics.some((d) => d.message.includes('++/--'))).toBe(true)
  })
})
