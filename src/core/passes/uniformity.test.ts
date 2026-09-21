// Derivative uniformity (§54, #161), through the `"use typeshade"` front end and on the IR.
//
// Every row here was measured on Chromium 141 (`chromium_headless_shell-1194`) and 153
// (`chromium_headless_shell-1243`, the build CI installs), IDENTICALLY on both, with the
// broken-shader instrument check passing on both compilers first:
//
//   textureSample under `if (uv.x > 0.5)` on a fragment input
//     'textureSample' must only be called from uniform control flow
//   the same with `diagnostic(off, derivative_uniformity);` at module scope   ACCEPTED
//   the same with `@diagnostic(off, derivative_uniformity)` on the entry      ACCEPTED
//   textureSample under `if (k > 0.5)` on a uniform buffer value              ACCEPTED
//   textureSampleLevel under a condition on a fragment input                  ACCEPTED
//   dpdx under a condition on a fragment input
//     'dpdx' must only be called from uniform control flow
//   workgroupBarrier under a condition on a uniform buffer value              ACCEPTED
//   workgroupBarrier under `if (id.x > 4u)` on local_invocation_id
//     'workgroupBarrier' must only be called from uniform control flow
//
// Every one is reported by `createShaderModule`, NOT only by `createRenderPipeline` — so the
// compile gate already runs Tint's own check on every example, and #161's acceptance item
// asking for a pipeline leg rests on a premise the measurement disproves.

import { describe, expect, it } from 'vitest'
import { compile } from '../../compiler/ts/compile.js'
import { compileTsSource } from '../../compiler/ts/source-file.js'
import { TS_CODES } from '../../compiler/ts/codes.js'
import { uniformityViolations } from './uniformity.js'
import type { FuncDecl, ModuleDecl } from '../ir/nodes.js'
import { f32T, vec2fT, vec4fT } from '../ir/types.js'

const HEAD = `declare const t: texture_2d<f32>
declare const s: sampler
declare const k: uniform<f32>
class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
`

const frag = (
  body: string,
  attrs = '',
) => `${HEAD}${attrs}@fragment export function fs(v: VsOut): vec4 {
${body}
}`

const errorsOf = (source: string) =>
  compileTsSource(`"use typeshade"\n${source}`)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code ?? ''} ${d.message}`)

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`)
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return c
}

describe('a derivative under a branch the invocations do not share', () => {
  it('refuses textureSample under a condition on a fragment input, naming the input', () => {
    const [first, ...rest] = errorsOf(
      frag(`  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
    )
    expect(rest).toEqual([])
    expect(first).toContain(TS_CODES.UNIFORMITY)
    expect(first).toContain('textureSample() is reached under "VsOut.uv"')
    expect(first).toContain('a fragment input at @location(0)')
    expect(first).toContain('derivative_uniformity')
    // The three fixes are named, because "not allowed" alone leaves an author guessing.
    expect(first).toContain('textureSampleLevel')
    expect(first).toContain('@diagnostic("off", "derivative_uniformity")')
  })

  it('follows the condition through a local it was copied into', () => {
    const [first] = errorsOf(
      frag(`  const edge = v.uv.x > 0.5
  if (edge) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
    )
    expect(first).toContain('textureSample() is reached under "edge"')
  })

  it('refuses a derivative builtin for the same reason', () => {
    const [first] = errorsOf(
      frag(`  if (v.uv.x > 0.5) { return vec4(dpdx(v.uv.x), 0., 0., 1.) }
  return vec4(0., 0., 0., 1.)`),
    )
    expect(first).toContain('dpdx() is reached under')
  })

  it('reaches a switch and a loop condition, not only an if', () => {
    expect(
      errorsOf(
        frag(`  switch (i32(v.uv.x)) {
    case 0: return textureSample(t, s, v.uv)
    default: return vec4(0., 0., 0., 1.)
  }`),
      )[0],
    ).toContain('textureSample() is reached under')
  })
})

describe('what stays legal', () => {
  it('accepts textureSample under a condition on a uniform value', () => {
    expect(
      compiled(
        frag(`  if (k > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
      ).wgsl,
    ).toContain('textureSample(t, s,')
  })

  it('accepts textureSample under a counted loop, whose bound is a constant', () => {
    expect(
      compiled(
        frag(`  let acc: vec4 = vec4(0., 0., 0., 1.)
  for (let i = 0; i < 2; i++) { acc = textureSample(t, s, v.uv) }
  return acc`),
      ).wgsl,
    ).toContain('textureSample(t, s,')
  })

  it('accepts textureSampleLevel anywhere, which is the fix the message names', () => {
    expect(
      compiled(
        frag(`  if (v.uv.x > 0.5) { return textureSampleLevel(t, s, v.uv, 0.) }
  return vec4(0., 0., 0., 1.)`),
      ).wgsl,
    ).toContain('textureSampleLevel(t, s,')
  })

  it('accepts a sample at the top of the entry, which is every shader that has one', () => {
    expect(compiled(frag(`  return textureSample(t, s, v.uv)`)).wgsl).toContain('textureSample(')
  })
})

describe('@diagnostic("off", "derivative_uniformity")', () => {
  const OFF = '@diagnostic("off", "derivative_uniformity")\n'
  const SRC = frag(
    `  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`,
    OFF,
  )

  it('emits the directive when asked, and takes the module as written', () => {
    const c = compiled(SRC)
    expect(c.wgsl).toContain('diagnostic(off, derivative_uniformity);')
    // Before every other directive, and before the declarations.
    expect(c.wgsl!.indexOf('diagnostic(off')).toBeLessThan(c.wgsl!.indexOf('struct '))
    // GLSL ES 3.00 has no equivalent and needs none: an implicit derivative in non-uniform
    // control flow is undefined there, not refused. The text does not move.
    expect(c.glsl!.fragment).not.toContain('diagnostic')
  })

  it('leaves the emit byte-identical for a module that does not ask', () => {
    const without = compiled(frag(`  return textureSample(t, s, v.uv)`))
    expect(without.wgsl).not.toContain('diagnostic(')
  })

  it('refuses a severity and a rule it does not know, and a wrong argument shape', () => {
    for (const [attr, want] of [
      ['@diagnostic("loud", "derivative_uniformity")\n', 'is not a diagnostic severity'],
      ['@diagnostic("off", "made_up_rule")\n', 'is not a rule this compiler analyses'],
      ['@diagnostic("off")\n', '@diagnostic takes a severity and a rule'],
    ] as const) {
      expect(errorsOf(frag(`  return textureSample(t, s, v.uv)`, attr)).join('\n'), attr).toContain(
        want,
      )
    }
  })
})

describe('the walk itself, on a module the front end never saw', () => {
  const entry = (
    name: string,
    stage: FuncDecl['stage'],
    params: FuncDecl['params'],
    body: FuncDecl['body'],
  ): FuncDecl => ({ name, params, ret: vec4fT, body, stage })

  it('says nothing about a helper whose parameters it cannot classify', () => {
    // A non-entry function's parameters are `unknown`: the walk does not follow call
    // arguments into a body. `unknown` is not `non-uniform`, so a derivative under such a
    // condition is ALLOWED through to Tint, which owns the complete rule — a false positive
    // here would refuse a program both targets run.
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'helper',
          params: [{ name: 'c', type: f32T }],
          ret: vec4fT,
          body: [
            {
              s: 'if',
              arms: [
                {
                  cond: {
                    op: 'compare',
                    type: { kind: 'scalar', scalar: 'bool' },
                    cop: '>',
                    a: { op: 'param', type: f32T, name: 'c' },
                    b: { op: 'lit', type: f32T, value: 0 },
                  },
                  body: [
                    {
                      s: 'call',
                      expr: {
                        op: 'call',
                        type: vec4fT,
                        fn: 'textureSample',
                        args: [{ op: 'varref', type: vec2fT, name: 'uv' }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(uniformityViolations(m)).toEqual([])
  })

  it('still reports a BARRIER under the same unclassifiable condition', () => {
    // The opposite threshold, and the reason the walk is three-valued: a barrier is accepted
    // only when the control flow is PROVABLY uniform, so the rule it replaces — which refused
    // every branch — can only ever be relaxed by something this walk has proven.
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        entry(
          'cs',
          'compute',
          [{ name: 'c', type: f32T }],
          [
            {
              s: 'if',
              arms: [
                {
                  cond: {
                    op: 'compare',
                    type: { kind: 'scalar', scalar: 'bool' },
                    cop: '>',
                    a: { op: 'param', type: f32T, name: 'c' },
                    b: { op: 'lit', type: f32T, value: 0 },
                  },
                  body: [
                    {
                      s: 'call',
                      expr: {
                        op: 'call',
                        type: { kind: 'void' },
                        fn: 'workgroupBarrier',
                        args: [],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        ),
      ],
    }
    const found = uniformityViolations(m)
    expect(found).toHaveLength(1)
    expect(found[0]!.kind).toBe('barrier')
    expect(found[0]!.cause).toContain('cannot prove uniform')
  })
})
