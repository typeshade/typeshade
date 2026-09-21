// ═══ normal-matrix — the numbers, not just the bytes ═══
//
// `emit-goldens.test.ts` pins this example's emitted text and `scripts/compile-gate.ts` proves
// Tint and a real WebGL2 driver accept it. Neither evaluates it, and for a file whose point is
// that the matrix SHAPES are right, the shapes are exactly what a byte gate cannot see: a
// `mat2x3` and a `mat3x2` hold the same six numbers and differ only in what they mean.
//
// So this evaluates the example's own IR on the CPU oracle and pins the three things the
// picture depends on.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../src/index.js'
import { compileModule } from '../src/core/oracle.js'
import { compileModuleJs } from '../src/core/cpu-codegen.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const { diagnostics, module } = compile(readFileSync(join(HERE, 'normal-matrix.shade.ts'), 'utf8'))

describe('normal-matrix computes what its shapes say', () => {
  it('compiles with no diagnostics', () => {
    expect(diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('normalMatrix is the upper-left 3x3 of the model matrix', () => {
    // Column-major, every entry distinct, so a transposed or mis-strided read cannot
    // coincide with the right answer.
    const m4 = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(compileModule(module).fns.normalMatrix!(m4)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11])
  })

  it('the fragment stage holds v * M == transpose(M) * v, component for component', () => {
    // The b channel is `abs(row.y - col.y)`, the residual of that identity, and it must be 0
    // for EVERY input — not just for one that happens to make the components equal. A
    // non-basis normal and an asymmetric uv are what tell the two apart.
    const cpu = compileModule(module)
    cpu.setBinding('u', {
      model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      tint: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })
    const cases: readonly (readonly [number[], number[]])[] = [
      [
        [0, 0, 1],
        [0.5, 0.5],
      ],
      [
        [1, 2, 3],
        [0.25, 0.75],
      ],
      [
        [-2, 0.5, 7],
        [0.125, 0.875],
      ],
    ]
    for (const [normal, uv] of cases) {
      const rgba = cpu.fns.fs!({ pos: [0, 0, 0, 1], uv, normal }) as number[]
      expect(rgba[2], `residual for normal ${normal.join(',')}`).toBe(0)
    }
  })

  it('the three CPU evaluators agree, which is where a shape bug hides', () => {
    // `transpose` on the example's mat2x3 was right in the interpreter and wrong in the
    // codegen backend, because only the former read the shape from the static type. Nothing
    // compared them on a matrix until this.
    const args = [{ pos: [0, 0, 0, 1], uv: [0.25, 0.75], normal: [1, 2, 3] }]
    const bind = (m: ReturnType<typeof compileModule>): void => {
      m.setBinding('u', {
        model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        tint: [0.5, 0, 0, 0, 0.75, 0, 0, 0, 1],
      })
    }
    const interp = compileModule(module)
    const codegen = compileModuleJs(module)
    bind(interp)
    bind(codegen as unknown as ReturnType<typeof compileModule>)
    expect(codegen.fns.fs!(...args)).toEqual(interp.fns.fs!(...args))
    const m4 = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(codegen.fns.normalMatrix!(m4)).toEqual(interp.fns.normalMatrix!(m4))
  })
})
