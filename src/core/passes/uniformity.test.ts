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
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js'
import { boolT, f32T, u32T, vec2fT, vec3uT, vec4fT, voidT } from '../ir/types.js'

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

  it('follows the condition through a local it was copied into, to its ROOT', () => {
    // The message names the value an author would change, which is the input the local came
    // from and not the local: `edge` is a name, `VsOut.uv` is the reason.
    const [first] = errorsOf(
      frag(`  const edge = v.uv.x > 0.5
  if (edge) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
    )
    expect(first).toContain('textureSample() is reached under "VsOut.uv"')
  })

  it('is FLOW-SENSITIVE: a local overwritten with a constant is uniform after that', () => {
    // Joining every write to a name regardless of order refused this, which Tint accepts —
    // the failure mode the three-valued design exists to prevent. Order decides.
    expect(
      compiled(
        frag(`  let g: f32 = v.uv.x
  g = 0.25
  if (g > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
      ).wgsl,
    ).toContain('textureSample(t, s,')
    // …and a write UNDER a branch is only as uniform as the branch, so this one stays refused.
    expect(
      errorsOf(
        frag(`  let g: f32 = 0.
  if (v.uv.x > 0.5) { g = 1. }
  if (g > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
      )[0],
    ).toContain('textureSample() is reached under')
  })

  it('refuses a derivative builtin for the same reason', () => {
    const [first] = errorsOf(
      frag(`  if (v.uv.x > 0.5) { return vec4(dpdx(v.uv.x), 0., 0., 1.) }
  return vec4(0., 0., 0., 1.)`),
    )
    expect(first).toContain('dpdx() is reached under')
  })

  it('reaches a switch scrutinee, not only an if', () => {
    expect(
      errorsOf(
        frag(`  switch (i32(v.uv.x)) {
    case 0: return textureSample(t, s, v.uv)
    default: return vec4(0., 0., 0., 1.)
  }`),
      )[0],
    ).toContain('textureSample() is reached under')
    // A `for` CONDITION cannot be non-uniform in this surface: §17 requires a constant bound,
    // so `for (let i = 0; f32(i) < v.uv.x; i++)` is `TS8006 for exit must compare "i" to a
    // constant bound`, which is the stricter rule and fires first. The walk classifies a loop
    // condition anyway, because an EDSL-assembled module is under no such rule — and because a
    // loop body that is uniform is the shape a reduction with a barrier in it needs.
    expect(
      errorsOf(
        frag(`  let acc: vec4 = vec4(0., 0., 0., 1.)
  for (let i = 0; f32(i) < v.uv.x; i++) { acc = textureSample(t, s, v.uv) }
  return acc`),
      )[0],
    ).toContain('constant bound')
  })

  it('makes everything after a non-uniform `return` non-uniform, and nothing after a discard', () => {
    // Measured on Tint: `if (uv.x > 1.0) { return … }` above a textureSample is
    // `'textureSample' must only be called from uniform control flow`, while the same with
    // `discard` is ACCEPTED — an invocation that discards is demoted to a helper and goes on
    // contributing the neighbour a derivative differences against, which is why `discard`
    // beside `fwidth` is the ordinary antialiased-cutout idiom.
    expect(
      errorsOf(
        frag(`  if (v.uv.x > 1.) { return vec4(0., 0., 0., 1.) }
  return textureSample(t, s, v.uv)`),
      )[0],
    ).toContain('textureSample() is reached under')
    expect(
      compiled(
        frag(`  if (v.uv.x > 1.) { discard }
  return textureSample(t, s, v.uv)`),
      ).wgsl,
    ).toContain('textureSample(t, s,')
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
    const body = `  return textureSample(t, s, v.uv)`
    const without = compiled(frag(body))
    expect(without.wgsl).not.toContain('diagnostic(')
    // Byte for byte, not merely "no directive line": the whole point is that a module that
    // asks for nothing emits what it always did.
    const withOff = compiled(frag(body, OFF))
    expect(withOff.wgsl).toBe(`diagnostic(off, derivative_uniformity);\n\n${String(without.wgsl)}`)
  })

  it('honours the severity rather than emitting one and ignoring it', () => {
    // `warning` and `info` demote the rule; `error` is the default it already has. A directive
    // the emit carried while the front end went on refusing would never reach a compiler —
    // `wgsl` is `undefined` whenever a diagnostic is an error.
    const src = frag(
      `  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`,
      '@diagnostic("warning", "derivative_uniformity")\n',
    )
    const c = compile(`"use typeshade"\n${src}`)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.diagnostics.filter((d) => d.category === 'warning').map((d) => d.code)).toContain(
      TS_CODES.UNIFORMITY,
    )
    expect(c.wgsl).toContain('diagnostic(warning, derivative_uniformity);')
  })

  it('does not let the filter silence a BARRIER, which is not that rule', () => {
    // Measured: `workgroupBarrier` under a non-uniform condition is `'workgroupBarrier' must
    // only be called from uniform control flow` on Tint WITH `diagnostic(off,
    // derivative_uniformity);` in the module. Silencing it here would hand the author a
    // module that fails at createShaderModule instead of at the line.
    const errors = errorsOf(`declare let out: storage<array<f32>>
let tile: workgroup<array<f32, 64>>
@diagnostic("off", "derivative_uniformity")
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = 1.
  if (lid.x < u32(4)) { workgroupBarrier() }
  out[lid.x] = tile[lid.x]
}`)
    expect(errors.join('\n')).toContain('workgroupBarrier() is reached under')
  })

  it('refuses two directives that set one rule two ways, rather than emitting both', () => {
    // WGSL takes one severity per rule per scope, so both lines in one module is
    // `conflicting diagnostic directive` on Tint — and a module no driver accepts is exactly
    // what §54 exists to catch at the line. Deduplicating on the (severity, rule) PAIR let
    // this through: the two rows differ, so both were kept and both were written.
    const conflict = errorsOf(
      frag(
        `  return textureSample(t, s, v.uv)`,
        '@diagnostic("off", "derivative_uniformity")\n@diagnostic("error", "derivative_uniformity")\n',
      ),
    )
    expect(conflict.join('\n')).toContain('conflicting diagnostic directive')
    // Reported at BOTH directives, each naming the function the other sits on: two entries in
    // a long file are two places to look, and "another @diagnostic in this file" named
    // neither. The same sentence twice, once per line an author has to choose between.
    expect(conflict).toHaveLength(2)
    for (const c of conflict) {
      expect(c).toContain('set to "off" by the @diagnostic on "fs"')
      expect(c).toContain('to "error" by the one on "fs"')
    }
    // The SAME severity written twice says one thing twice, which is not a conflict — and one
    // directive is emitted, not two.
    const twice = compiled(
      frag(
        `  return textureSample(t, s, v.uv)`,
        '@diagnostic("off", "derivative_uniformity")\n@diagnostic("off", "derivative_uniformity")\n',
      ),
    )
    expect(twice.wgsl!.match(/diagnostic\(off, derivative_uniformity\);/g)).toHaveLength(1)
  })

  it('names the two FUNCTIONS when the conflicting directives sit on different ones', () => {
    // The shape the message exists for: a directive on a helper and another on the entry.
    // Naming "another @diagnostic in this file" left an author to search for the other one.
    const errors = errorsOf(`${HEAD}@diagnostic("off", "derivative_uniformity")
export function helper(uv: vec2): vec4 { return textureSample(t, s, uv) }
@diagnostic("error", "derivative_uniformity")
@fragment export function fs(v: VsOut): vec4 { return helper(v.uv) }`)
    expect(errors).toHaveLength(2)
    for (const e of errors) {
      expect(e).toContain('set to "off" by the @diagnostic on "helper"')
      expect(e).toContain('to "error" by the one on "fs"')
    }
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

// ═══ The four proofs the walk makes, each pinned by the shape that once broke it ═══
//
// Every row below is a program an earlier version of this walk answered WRONG, in one of the
// two directions the header says must not happen: a derivative refused though Tint accepts
// it, or a barrier admitted though Tint refuses it. None of the four is reachable from the
// example corpus, so the compile gate never saw them — which is how they got in.
describe('the walk claims only what it has proven', () => {
  it('leaves an UNKNOWN divergence unknown, rather than promoting it to non-uniform', () => {
    // `return` under a condition this walk cannot classify makes the rest of the function
    // reachable by a subset of the invocations — but by which subset is exactly what is not
    // known, so the class after it is the DIVERGENCE's own, not the literal `non-uniform`.
    // Promoting it refused this program, which Tint compiles: a call into a user function is
    // `unknown`, and `unknown` is above the derivative threshold.
    expect(
      compiled(
        `${HEAD}export function opaque(): f32 { return 0.5 }
@fragment export function fs(v: VsOut): vec4 {
  if (opaque() > 0.5) { return vec4(0., 0., 0., 1.) }
  return textureSample(t, s, v.uv)
}`,
      ).wgsl,
    ).toContain('textureSample(t, s,')
    // The BARRIER threshold is untouched by that: `unknown` is still not `uniform`.
    expect(
      errorsOf(`declare let out: storage<array<f32>>
export function opaque(): f32 { return 0.5 }
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (opaque() > 0.5) { return }
  workgroupBarrier()
  out[lid.x] = 1.
}`)[0],
    ).toContain('workgroupBarrier() is reached under')
  })

  it('rebinds the ROOT of a write, so `v.x = …` is a write to `v`', () => {
    // Reading only a bare `varref` target left `g` at the class its initialiser had, so the
    // condition below read `uniform` and the barrier was ADMITTED — where Tint answers
    // `'workgroupBarrier' must only be called from uniform control flow`. A false PROOF, which
    // is the one thing the barrier threshold cannot tolerate.
    const member = errorsOf(`declare let out: storage<array<f32>>
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  let g: vec2 = vec2(0., 0.)
  g.x = f32(lid.x)
  if (g.x > 4.) { workgroupBarrier() }
  out[lid.x] = g.x
}`)
    expect(member[0]).toContain('workgroupBarrier() is reached under')
    expect(member[0]).toContain('local_invocation_id')
    // The same through an index, which reaches the root the same way.
    const index = errorsOf(`declare let out: storage<array<f32>>
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  let g: array<f32, 2> = [0., 0.]
  g[0] = f32(lid.x)
  if (g[0] > 4.) { workgroupBarrier() }
  out[lid.x] = g[1]
}`)
    expect(index[0]).toContain('workgroupBarrier() is reached under')
  })

  it('reports a call under a branch once, not once per loop iteration', () => {
    // The loop fixpoint walks a body more than once — that is what follows a value carried
    // round the loop — and every walk pushed its own finding, so an author read the same
    // sentence about the same line two or three times over.
    // A copy chain three deep is what makes the body walk settle only on the third pass —
    // `a = b; b = c` carries `c`'s class round the loop one name per iteration — so the
    // barrier under it was reported three times over. Measured: 3 without the filter, 1 with.
    const errors = errorsOf(`declare let out: storage<array<f32>>
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  let a: f32 = 0.
  let b: f32 = 0.
  let c: f32 = f32(lid.x)
  for (let i = 0; i < 4; i++) {
    if (lid.x > u32(4)) { workgroupBarrier() }
    a = b
    b = c
  }
  out[lid.x] = a
}`)
    expect(errors.filter((e) => e.includes('workgroupBarrier() is reached under'))).toHaveLength(1)
  })
})

// ═══ A one-line helper is not a policy boundary (§54) ═══
//
// Both directions of the interprocedural answer, measured on Chromium 141 with the
// broken-shader instrument reporting first. Tint refuses every row marked refused here and
// ACCEPTS both uniform rows — so each is a real verdict, not a reading of the spec:
//
//   if (edge(v.uv.x)) { … } with the sample after the branch
//     'textureSample' must only be called from uniform control flow
//   the same with the sample inside the branch, and with an identity helper, and with dpdx
//     the same refusal, at the call
//   if (edge(k)) on a uniform                                                   ACCEPTED
//   textureSample under `if (x > 0.5)` inside a helper called with v.uv.x
//     'textureSample' must only be called from uniform control flow
//   the same helper called with k                                               ACCEPTED
//
// The INLINE form of each refusal was already caught. What made these a hole rather than a
// policy is that the same program passed or refused on whether its condition — or its
// derivative — went through a helper, and §54's whole claim is that this compiler answers
// before Tint does.
describe('a value that goes through a helper keeps its class', () => {
  const EDGE = 'export function edge(x: f32): bool { return x > 0.5 }\n'

  it.each([
    [
      'the sample after the branch',
      `${HEAD}${EDGE}@fragment export function fs(v: VsOut): vec4 {
  if (edge(v.uv.x)) { return vec4(1., 0., 0., 1.) }
  return textureSample(t, s, v.uv)
}`,
      'textureSample() is reached under "VsOut.uv"',
    ],
    [
      'the sample inside the branch',
      `${HEAD}${EDGE}@fragment export function fs(v: VsOut): vec4 {
  if (edge(v.uv.x)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
      'textureSample() is reached under "VsOut.uv"',
    ],
    [
      'an identity helper, which carries no comparison at all',
      `${HEAD}export function id1(x: f32): f32 { return x }
@fragment export function fs(v: VsOut): vec4 {
  if (id1(v.uv.x) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
      'textureSample() is reached under "VsOut.uv"',
    ],
    [
      'a derivative builtin under the same condition',
      `${HEAD}${EDGE}@fragment export function fs(v: VsOut): vec4 {
  if (edge(v.uv.x)) { return vec4(dpdx(v.uv.x), 0., 0., 1.) }
  return vec4(0., 0., 0., 1.)
}`,
      'dpdx() is reached under "VsOut.uv"',
    ],
  ])('refuses a derivative under a helper CONDITION on an input: %s', (_what, source, want) => {
    // A call into a user function returns at most the join of its arguments, never more
    // uniform: returning a bare `unknown` laundered the input, and `unknown` is below the
    // derivative threshold. The message still names the ROOT — the input, not the helper.
    const errors = errorsOf(source)
    expect(errors[0], _what).toContain(want)
    expect(errors[0]).toContain('a fragment input at @location(0)')
  })

  it('refuses a derivative INSIDE a helper, under a branch on its own parameter', () => {
    // The other direction: the argument classes are seeded onto the callee's parameters, so a
    // helper handed a fragment input is analysed as the caller handed it. Seeding every
    // helper parameter `unknown` regardless let this through while Tint refused it — the same
    // hole as the row above, read from the other end.
    const errors = errorsOf(`${HEAD}export function shade(x: f32, uv: vec2): vec4 {
  if (x > 0.5) { return textureSample(t, s, uv) }
  return vec4(0., 0., 0., 1.)
}
@fragment export function fs(v: VsOut): vec4 { return shade(v.uv.x, v.uv) }`)
    expect(errors[0]).toContain('textureSample() is reached under "VsOut.uv"')
  })

  it.each([
    [
      'a helper CONDITION on a uniform',
      `${HEAD}${EDGE}@fragment export function fs(v: VsOut): vec4 {
  if (edge(k)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'the same helper BODY, called with a uniform',
      `${HEAD}export function shade(x: f32, uv: vec2): vec4 {
  if (x > 0.5) { return textureSample(t, s, uv) }
  return vec4(0., 0., 0., 1.)
}
@fragment export function fs(v: VsOut): vec4 { return shade(k, v.uv) }`,
    ],
  ])('still accepts %s, which Tint accepts', (_what, source) => {
    // The floor is `unknown`, never `uniform`: a helper's body can read a module `var` or a
    // storage buffer this walk never sees. `unknown` is below the derivative threshold, so
    // these compile — and both were measured ACCEPTED on Tint, so refusing them would be a
    // false positive on a program both targets run.
    expect(compiled(source).wgsl).toContain('textureSample(t, s,')
  })

  it('keeps the BARRIER threshold where it was: unknown is still not uniform', () => {
    // A barrier is accepted only when the flow is PROVABLY uniform, so a helper call in the
    // condition keeps the refusal whatever the arguments are — the relaxation may only ever
    // admit what is proven, and a user call is never proven.
    for (const cond of ['edge(f32(lid.x))', 'edge(k)']) {
      const errors = errorsOf(`declare let out: storage<array<f32>>
declare const k: uniform<f32>
export function edge(x: f32): bool { return x > 0.5 }
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (${cond}) { workgroupBarrier() }
  out[lid.x] = 1.
}`)
      expect(errors.join('\n'), cond).toContain('workgroupBarrier() is reached under')
    }
  })
})

describe('where the diagnostic points', () => {
  it('underlines the barrier call, not the entry it sits in', () => {
    // The `call` node the barrier lowering returns carried no span, so §54's diagnostic fell
    // back to the enclosing declaration and underlined the entry's `@compute` decorator —
    // three lines above the statement an author has to move. An editor squiggle over a whole
    // function is a squiggle that says nothing.
    const source = `"use typeshade"
declare let out: storage<array<f32>>
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (lid.x > u32(4)) { workgroupBarrier() }
  out[lid.x] = 1.
}`
    const [d, ...rest] = compileTsSource(source).diagnostics.filter((x) => x.category === 'error')
    expect(rest).toEqual([])
    expect(d!.code).toBe(TS_CODES.UNIFORMITY)
    expect(source.slice(d!.start, d!.start + d!.length)).toBe('workgroupBarrier()')
    expect([d!.line, d!.endLine]).toEqual([4, 4])
  })
})

describe('the call graph, walked to a fixpoint that does not read declaration order', () => {
  const BARRIER: Stmt = {
    s: 'call',
    expr: { op: 'call', type: voidT, fn: 'workgroupBarrier', args: [] },
  }
  const calls = (name: string): Stmt => ({
    s: 'call',
    expr: { op: 'call', type: voidT, fn: name, args: [] },
  })
  const helper = (name: string, body: readonly Stmt[]): FuncDecl => ({
    name,
    params: [],
    ret: voidT,
    body,
  })
  /** `lid.x > 4u`, on a `@builtin(local_invocation_id)` parameter: the seed table's own
   *  non-uniform value, and what Tint refuses a barrier under. */
  const lidOver4: Expr = {
    op: 'compare',
    type: boolT,
    cop: '>',
    a: {
      op: 'member',
      type: u32T,
      base: { op: 'param', type: vec3uT, name: 'lid' },
      field: 'x',
    },
    b: { op: 'lit', type: u32T, value: 4 },
  }
  const compute = (body: readonly Stmt[]): FuncDecl => ({
    name: 'cs',
    params: [{ name: 'lid', type: vec3uT, builtin: 'local_invocation_id' }],
    ret: voidT,
    body,
    stage: 'compute',
  })
  const moduleOf = (funcs: readonly FuncDecl[]): ModuleDecl => ({
    consts: [],
    structs: [],
    bindings: [],
    funcs,
  })

  it('answers a call chain the same whichever end of it is declared first', () => {
    // Accumulating the start classes into ONE map made the answer depend on `m.funcs` order:
    // a helper walked before its caller seeded its own callees from a start class nothing had
    // set yet, and `joinKnown` can only degrade, so a function two calls below an entry stayed
    // at that first guess forever. The same program compiled with the entry declared first and
    // did not with the helpers first — a difference an author has no way to read.
    const inner = helper('inner', [BARRIER])
    const outer = helper('outer', [calls('inner')])
    const entry = compute([calls('outer')])
    expect(uniformityViolations(moduleOf([inner, outer, entry]))).toEqual([])
    expect(uniformityViolations(moduleOf([entry, outer, inner]))).toEqual([])
  })

  it('still carries a caller’s non-uniform control flow two calls down, in either order', () => {
    // The relaxation only ever admits what is proven, so the same chain under a branch on
    // `local_invocation_id` keeps the refusal — from the entry, through `outer`, into `inner`.
    const inner = helper('inner', [BARRIER])
    const outer = helper('outer', [calls('inner')])
    const entry = compute([{ s: 'if', arms: [{ cond: lidOver4, body: [calls('outer')] }] }])
    for (const funcs of [
      [inner, outer, entry],
      [entry, outer, inner],
    ]) {
      const found = uniformityViolations(moduleOf(funcs))
      expect(found.map((v) => [v.fn, v.callee, v.kind])).toEqual([
        ['inner', 'workgroupBarrier', 'barrier'],
      ])
      expect(found[0]!.cause).toContain('local_invocation_id')
    }
  })

  it('takes a helper NOTHING calls on its own terms, as WGSL does', () => {
    // A module of helpers alone — a fragment of a shader under test, or a library compiled by
    // itself — has no caller to claim anything wrong about, so its body starts uniform. A
    // pessimistic seed refused a barrier at the top level of such a module, under no branch at
    // all, with a message about moving it out of one; and no spelling got the module through,
    // since the diagnostic filter does not reach the barrier rule.
    expect(uniformityViolations(moduleOf([helper('sync', [BARRIER])]))).toEqual([])
    // Not vacuous: the same barrier under a branch this walk cannot classify is still
    // reported, because `unknown` is not `uniform`.
    const opaque: Expr = { op: 'call', type: boolT, fn: 'hostSaysSo', args: [] }
    const found = uniformityViolations(
      moduleOf([helper('sync', [{ s: 'if', arms: [{ cond: opaque, body: [BARRIER] }] }])]),
    )
    expect(found.map((v) => [v.fn, v.kind])).toEqual([['sync', 'barrier']])
  })
})
