import { describe, expect, it } from 'vitest'
import { typeshadeVite } from './vite.js'

describe('typeshadeVite', () => {
  it('ignores non-shade files', () => {
    const p = typeshadeVite()
    expect(p.transform('export const x = 1', '/app/main.ts')).toBeNull()
  })

  it('emits default pack json for *.shade.ts', () => {
    const p = typeshadeVite()
    const out = p.transform(
      `
      "use typeshade";
      export function add(a: f32, b: f32): f32 { return a + b; }
      `,
      '/app/hello.shade.ts',
    )
    expect(out).not.toBeNull()
    expect(out!.code).toMatch(/export default/)
    expect(out!.code).toMatch(/"wgsl"/)
    const pack = JSON.parse(out!.code.replace(/^export default /, '').replace(/;\s*$/, ''))
    expect(pack.wgsl).toMatch(/fn add/)
  })
})
