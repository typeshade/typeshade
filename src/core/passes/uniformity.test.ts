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
//
// Verifies: Rule 8.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import { TS_CODES } from '../../compiler/ts/codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { uniformityViolations } from './uniformity.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { boolT, f32T, u32T, vec2fT, vec3uT, vec4fT, voidT } from '../ir/types.js';

const HEAD = `declare const t: texture_2d<f32>
declare const s: sampler
declare const k: uniform<f32>
class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } }
`;

const frag = (
  body: string,
  attrs = '',
) => `${HEAD}${attrs}@fragment export function fs(v: VsOut): vec4 {
${body}
}`;

/** The language service's diagnostics on the same source, as `code message`. Each helper below
 *  asserts the editor says what the compiler says, so every pin here reads both halves (Rule
 *  12.7). */
const editorSays = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', `"use typeshade"\n${source}`);
  return service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)} ${d.message}`);
};

const errorsOf = (source: string) => {
  const said = compileTsSource(`"use typeshade"\n${source}`)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code ?? ''} ${d.message}`);
  expect(editorSays(source)).toEqual(said);
  return said;
};

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(editorSays(source)).toEqual([]);
  return c;
}

/** The whole TS8052 sentence for a `textureSample` (Rule 12.5): where the call is reached, and
 *  the hoist that fits that place. */
const sampleRefusal = (reached: string, hoist: string): string =>
  `${TS_CODES.UNIFORMITY} textureSample() is reached ${reached}, which WGSL's derivative_uniformity rule refuses: the implicit level of detail is a difference between neighbouring invocations, and one that did not run has no value to difference against. ${hoist}, or use textureSampleLevel or textureSampleGrad, whose level of detail is the one you wrote, or write @diagnostic("off", "derivative_uniformity") on the entry to take the module as written.`;

/** The whole TS8052 sentence for a call the workgroup has to reach together: where it is
 *  reached, where to move it, and what to write the statement on instead. */
const barrierRefusal = (callee: string, reached: string, move: string, on: string): string =>
  `${TS_CODES.UNIFORMITY} ${callee}() is reached ${reached}, and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. ${move}, or ${on} a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`;

const UV = '"VsOut.uv" (a fragment input at @location(0))';
const LID = '"lid" (@builtin(local_invocation_id))';

describe('a derivative under a branch the invocations do not share', () => {
  it('refuses textureSample under a condition on a fragment input, naming the input', () => {
    const [first, ...rest] = errorsOf(
      frag(`  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
    );
    expect(rest).toEqual([]);
    expect(first).toContain(TS_CODES.UNIFORMITY);
    expect(first).toContain('textureSample() is reached under "VsOut.uv"');
    expect(first).toContain('a fragment input at @location(0)');
    expect(first).toContain('derivative_uniformity');
    // The three fixes are named, because "not allowed" alone leaves an author guessing.
    expect(first).toContain('textureSampleLevel');
    expect(first).toContain('@diagnostic("off", "derivative_uniformity")');
  });

  it('follows the condition through a local it was copied into, to its ROOT', () => {
    // The message names the value an author would change, which is the input the local came
    // from and not the local: `edge` is a name, `VsOut.uv` is the reason.
    const [first] = errorsOf(
      frag(`  const edge = v.uv.x > 0.5
  if (edge) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
    );
    expect(first).toContain('textureSample() is reached under "VsOut.uv"');
  });

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
    ).toContain('textureSample(t, s,');
    // …and a write UNDER a branch is only as uniform as the branch, so this one stays refused.
    expect(
      errorsOf(
        frag(`  let g: f32 = 0.
  if (v.uv.x > 0.5) { g = 1. }
  if (g > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
      )[0],
    ).toContain('textureSample() is reached under');
  });

  it('refuses a derivative builtin for the same reason', () => {
    const [first] = errorsOf(
      frag(`  if (v.uv.x > 0.5) { return vec4(dpdx(v.uv.x), 0., 0., 1.) }
  return vec4(0., 0., 0., 1.)`),
    );
    expect(first).toContain('dpdx() is reached under');
  });

  it('reaches a switch scrutinee, not only an if', () => {
    expect(
      errorsOf(
        frag(`  switch (i32(v.uv.x)) {
    case 0: return textureSample(t, s, v.uv)
    default: return vec4(0., 0., 0., 1.)
  }`),
      )[0],
    ).toContain('textureSample() is reached under');
    // A `for` bound may be a runtime value (Rule 7.5, #203), so a loop whose trip count differs
    // between invocations is authorable, and a sample in its body is under that divergence.
    // Named as the loop it is: no branch surrounds the call, so "above the branch" pointed at
    // nothing (Rule 12.1).
    expect(
      errorsOf(
        frag(`  let acc: vec4 = vec4(0., 0., 0., 1.)
  for (let i: i32 = 0; i < i32(v.uv.x * 4.); i++) { acc = textureSample(t, s, v.uv) }
  return acc`),
      ),
    ).toEqual([
      sampleRefusal(`in a loop whose condition reads ${UV}`, 'Hoist the call out of the loop'),
    ]);
  });

  it('makes everything after a non-uniform `return` non-uniform, and nothing after a discard', () => {
    // Measured on Tint: `if (uv.x > 1.0) { return … }` above a textureSample is
    // `'textureSample' must only be called from uniform control flow`, while the same with
    // `discard` is ACCEPTED — an invocation that discards is demoted to a helper and goes on
    // contributing the neighbour a derivative differences against, which is why `discard`
    // beside `fwidth` is the ordinary antialiased-cutout idiom.
    // The call sits in no branch, so the sentence names the return and the hoist above it.
    expect(
      errorsOf(
        frag(`  if (v.uv.x > 1.) { return vec4(0., 0., 0., 1.) }
  return textureSample(t, s, v.uv)`),
      ),
    ).toEqual([
      sampleRefusal(`after a return taken under ${UV}`, 'Hoist the call above the return'),
    ]);
    expect(
      compiled(
        frag(`  if (v.uv.x > 1.) { discard }
  return textureSample(t, s, v.uv)`),
      ).wgsl,
    ).toContain('textureSample(t, s,');
  });
});

// Every acceptance below was measured ACCEPTED on Tint, not assumed: an acceptance a pass
// asserts without a verdict beside it is the shape both of this arm's earlier mistakes took.
describe('what stays legal', () => {
  it('accepts textureSample under a condition on a uniform value', () => {
    expect(
      compiled(
        frag(`  if (k > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`),
      ).wgsl,
    ).toContain('textureSample(t, s,');
  });

  it('accepts textureSample under a counted loop, whose bound is a constant', () => {
    expect(
      compiled(
        frag(`  let acc: vec4 = vec4(0., 0., 0., 1.)
  for (let i = 0; i < 2; i++) { acc = textureSample(t, s, v.uv) }
  return acc`),
      ).wgsl,
    ).toContain('textureSample(t, s,');
  });

  it('accepts textureSampleLevel anywhere, which is the fix the message names', () => {
    expect(
      compiled(
        frag(`  if (v.uv.x > 0.5) { return textureSampleLevel(t, s, v.uv, 0.) }
  return vec4(0., 0., 0., 1.)`),
      ).wgsl,
    ).toContain('textureSampleLevel(t, s,');
  });

  it('accepts a sample at the top of the entry, which is every shader that has one', () => {
    expect(compiled(frag(`  return textureSample(t, s, v.uv)`)).wgsl).toContain('textureSample(');
  });
});

describe('@diagnostic("off", "derivative_uniformity")', () => {
  const OFF = '@diagnostic("off", "derivative_uniformity")\n';
  const SRC = frag(
    `  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`,
    OFF,
  );

  it('emits the directive when asked, and takes the module as written', () => {
    const c = compiled(SRC);
    expect(c.wgsl).toContain('diagnostic(off, derivative_uniformity);');
    // Before every other directive, and before the declarations.
    expect(c.wgsl!.indexOf('diagnostic(off')).toBeLessThan(c.wgsl!.indexOf('struct '));
    // GLSL ES 3.00 has no equivalent and needs none: an implicit derivative in non-uniform
    // control flow is undefined there, not refused. The text does not move.
    expect(c.glsl!.fragment).not.toContain('diagnostic');
  });

  it('leaves the emit byte-identical for a module that does not ask', () => {
    const body = `  return textureSample(t, s, v.uv)`;
    const without = compiled(frag(body));
    expect(without.wgsl).not.toContain('diagnostic(');
    // Byte for byte, not merely "no directive line": the whole point is that a module that
    // asks for nothing emits what it always did.
    const withOff = compiled(frag(body, OFF));
    expect(withOff.wgsl).toBe(`diagnostic(off, derivative_uniformity);\n\n${String(without.wgsl)}`);
  });

  it('honours the severity rather than emitting one and ignoring it', () => {
    // `warning` and `info` demote the rule; `error` is the default it already has. A directive
    // the emit carried while the front end went on refusing would never reach a compiler —
    // `wgsl` is `undefined` whenever a diagnostic is an error.
    const src = frag(
      `  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)`,
      '@diagnostic("warning", "derivative_uniformity")\n',
    );
    const c = compile(`"use typeshade"\n${src}`);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.diagnostics.filter((d) => d.category === 'warning').map((d) => d.code)).toContain(
      TS_CODES.UNIFORMITY,
    );
    expect(c.wgsl).toContain('diagnostic(warning, derivative_uniformity);');
  });

  it('does not let the filter silence a BARRIER, which is not that rule', () => {
    // Measured: `workgroupBarrier` under a non-uniform condition is `'workgroupBarrier' must
    // only be called from uniform control flow` on Tint WITH `diagnostic(off,
    // derivative_uniformity);` in the module. Silencing it here would hand the author a
    // module that fails at createShaderModule instead of at the line.
    const errors = errorsOf(`declare const out: storage<array<f32>, "read_write">
let tile: workgroup<array<f32, 64>>
@diagnostic("off", "derivative_uniformity")
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = 1.
  if (lid.x < u32(4)) { workgroupBarrier() }
  out[lid.x] = tile[lid.x]
}`);
    expect(errors.join('\n')).toContain('workgroupBarrier() is reached under');
  });

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
    );
    expect(conflict.join('\n')).toContain('conflicting diagnostic directive');
    // ONE conflict, ONE diagnostic. Reporting it at both decorators with byte-identical text
    // made a reader check whether two conflicts had been found.
    expect(conflict).toHaveLength(1);
    expect(conflict[0]).toContain('set to "off" by the @diagnostic on "fs"');
    expect(conflict[0]).toContain('to "error" by the one on "fs"');
    // The SAME severity written twice says one thing twice, which is not a conflict — and one
    // directive is emitted, not two.
    const twice = compiled(
      frag(
        `  return textureSample(t, s, v.uv)`,
        '@diagnostic("off", "derivative_uniformity")\n@diagnostic("off", "derivative_uniformity")\n',
      ),
    );
    expect(twice.wgsl!.match(/diagnostic\(off, derivative_uniformity\);/g)).toHaveLength(1);
  });

  it('names the two FUNCTIONS when the conflicting directives sit on different ones', () => {
    // The shape the message exists for: a directive on a helper and another on the entry.
    // Naming "another @diagnostic in this file" left an author to search for the other one.
    const errors = errorsOf(`${HEAD}@diagnostic("off", "derivative_uniformity")
export function helper(uv: vec2): vec4 { return textureSample(t, s, uv) }
@diagnostic("error", "derivative_uniformity")
@fragment export function fs(v: VsOut): vec4 { return helper(v.uv) }`);
    // One diagnostic, on the SECOND directive — the one that introduced the disagreement —
    // naming the function each side sits on so the other is findable without searching.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('set to "off" by the @diagnostic on "helper"');
    expect(errors[0]).toContain('to "error" by the one on "fs"');
  });

  it('refuses a severity and a rule it does not know, and a wrong argument shape', () => {
    for (const [attr, want] of [
      ['@diagnostic("loud", "derivative_uniformity")\n', 'is not a diagnostic severity'],
      ['@diagnostic("off", "made_up_rule")\n', 'is not a rule this compiler analyses'],
      ['@diagnostic("off")\n', '@diagnostic takes a severity and a rule'],
    ] as const) {
      expect(errorsOf(frag(`  return textureSample(t, s, v.uv)`, attr)).join('\n'), attr).toContain(
        want,
      );
    }
  });
});

describe('the walk itself, on a module the front end never saw', () => {
  const entry = (
    name: string,
    stage: FuncDecl['stage'],
    params: FuncDecl['params'],
    body: FuncDecl['body'],
  ): FuncDecl => ({ name, params, ret: vec4fT, body, stage });

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
    };
    expect(uniformityViolations(m)).toEqual([]);
  });

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
    };
    const found = uniformityViolations(m);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('barrier');
    expect(found[0]!.cause).toContain('cannot prove uniform');
  });
});

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
    ).toContain('textureSample(t, s,');
    // The BARRIER threshold is untouched by that: `unknown` is still not `uniform`.
    expect(
      errorsOf(`declare const out: storage<array<f32>, "read_write">
export function opaque(): f32 { return 0.5 }
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (opaque() > 0.5) { return }
  workgroupBarrier()
  out[lid.x] = 1.
}`),
    ).toEqual([
      barrierRefusal(
        'workgroupBarrier',
        'after a return taken under the expression, which this compiler cannot prove uniform',
        'Move it above the return',
        'return on',
      ),
    ]);
  });

  it('rebinds the ROOT of a write, so `v.x = …` is a write to `v`', () => {
    // Reading only a bare `varref` target left `g` at the class its initialiser had, so the
    // condition below read `uniform` and the barrier was ADMITTED — where Tint answers
    // `'workgroupBarrier' must only be called from uniform control flow`. A false PROOF, which
    // is the one thing the barrier threshold cannot tolerate.
    const member = errorsOf(`declare const out: storage<array<f32>, "read_write">
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  let g: vec2 = vec2(0., 0.)
  g.x = f32(lid.x)
  if (g.x > 4.) { workgroupBarrier() }
  out[lid.x] = g.x
}`);
    expect(member[0]).toContain('workgroupBarrier() is reached under');
    expect(member[0]).toContain('local_invocation_id');
    // The same through an index, which reaches the root the same way.
    const index = errorsOf(`declare const out: storage<array<f32>, "read_write">
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  let g: array<f32, 2> = [0., 0.]
  g[0] = f32(lid.x)
  if (g[0] > 4.) { workgroupBarrier() }
  out[lid.x] = g[1]
}`);
    expect(index[0]).toContain('workgroupBarrier() is reached under');
  });

  it('reports a call under a branch once, not once per loop iteration', () => {
    // The loop fixpoint walks a body more than once — that is what follows a value carried
    // round the loop — and every walk pushed its own finding, so an author read the same
    // sentence about the same line two or three times over.
    // A copy chain three deep is what makes the body walk settle only on the third pass —
    // `a = b; b = c` carries `c`'s class round the loop one name per iteration — so the
    // barrier under it was reported three times over. Measured: 3 without the filter, 1 with.
    const errors = errorsOf(`declare const out: storage<array<f32>, "read_write">
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
}`);
    expect(errors.filter((e) => e.includes('workgroupBarrier() is reached under'))).toHaveLength(1);
  });
});

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
// ═══ The nine programs, both directions, one table ═══
//
// This arm was answered wrong three times running, each time in the direction opposite the
// last, so both directions are pinned here together rather than in two places that can drift:
//
//   1. a user call returned the JOIN OF NOTHING — a bare `unknown` — and laundered a
//      non-uniform value, so L1 to L5 compiled while Tint refused them.
//   2. it returned the JOIN OF EVERY ARGUMENT, and over-refused, so A1 to A5 were refused
//      while Tint accepted them.
//   3. it returns the join of the arguments the callee's RESULT DEPENDS ON, which is what the
//      summary pass computes. Both halves of the table come out right from that one rule.
//
// Every row was measured on Chromium 141 (`chromium_headless_shell-1194`), with the
// broken-shader instrument reporting `fn broken( {` first, and the ACCEPTED rows were emitted
// and handed to Tint whole.
describe('a value that goes through a helper keeps its class', () => {
  const EDGE = 'export function edge(x: f32): bool { return x > 0.5 }\n';

  it.each([
    [
      'the sample after the branch',
      `${HEAD}${EDGE}@fragment export function fs(v: VsOut): vec4 {
  if (edge(v.uv.x)) { return vec4(1., 0., 0., 1.) }
  return textureSample(t, s, v.uv)
}`,
      'textureSample() is reached after a return taken under "VsOut.uv"',
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
    const errors = errorsOf(source);
    expect(errors[0], _what).toContain(want);
    expect(errors[0]).toContain('a fragment input at @location(0)');
  });

  it('refuses a derivative INSIDE a helper, under a branch on its own parameter', () => {
    // The other direction: the argument classes are seeded onto the callee's parameters, so a
    // helper handed a fragment input is analysed as the caller handed it. Seeding every
    // helper parameter `unknown` regardless let this through while Tint refused it — the same
    // hole as the row above, read from the other end.
    const errors = errorsOf(`${HEAD}export function shade(x: f32, uv: vec2): vec4 {
  if (x > 0.5) { return textureSample(t, s, uv) }
  return vec4(0., 0., 0., 1.)
}
@fragment export function fs(v: VsOut): vec4 { return shade(v.uv.x, v.uv) }`);
    expect(errors[0]).toContain('textureSample() is reached under "VsOut.uv"');
  });

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
    expect(compiled(source).wgsl).toContain('textureSample(t, s,');
  });

  it.each([
    [
      'A1 the helper ignores both arguments',
      `${HEAD}export function always(uv: vec2, m: f32): bool { return true }
@fragment export function fs(v: VsOut): vec4 {
  if (always(v.uv, k)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'A2 it returns the uniform of two parameters',
      `${HEAD}export function pick(a: f32, b: f32): f32 { return b }
@fragment export function fs(v: VsOut): vec4 {
  if (pick(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'A3 the non-uniform argument is spent on a local nothing returns',
      `${HEAD}export function gate(uv: vec2, m: f32): bool {
  const unused = uv.x * 2.
  return m > 0.5
}
@fragment export function fs(v: VsOut): vec4 {
  if (gate(v.uv, k)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'A4 it is spent on a branch the return does not sit under',
      `${HEAD}export function gate2(uv: vec2, m: f32): bool {
  let acc: f32 = 0.
  if (uv.x > 0.5) { acc = 1. }
  return m > 0.5
}
@fragment export function fs(v: VsOut): vec4 {
  if (gate2(v.uv, k)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'A5 the realistic one: the answer comes from the uniform parameter',
      `${HEAD}export function lightingMode(uv: vec2, mode: f32): bool { return mode > 0.5 }
@fragment export function fs(v: VsOut): vec4 {
  if (lightingMode(v.uv, k)) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'A6 transitive: the forwarded argument is the uniform one',
      `${HEAD}export function inner2(a: f32, b: f32): f32 { return a }
export function outer2(p: f32, q: f32): f32 { return inner2(p, q) }
@fragment export function fs(v: VsOut): vec4 {
  if (outer2(k, v.uv.x) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
  ])('accepts a call whose RESULT does not depend on the non-uniform argument: %s', (_w, src) => {
    // The argument reaches the helper and never reaches its return value, so it cannot make
    // the value vary. Joining every argument refused all six; Tint accepts all six. The
    // summary pass is what tells the two halves of this table apart.
    expect(compiled(src).wgsl).toContain('textureSample(t, s,');
  });

  it.each([
    [
      'D1 control dependence: the return sits under a branch on the non-uniform parameter',
      `${HEAD}export function pick(x: f32, y: f32): f32 {
  if (x > 0.5) { return 1. }
  return y
}
@fragment export function fs(v: VsOut): vec4 {
  if (pick(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'D2 transitive: the forwarded argument lands in the callee\u2019s dependent slot',
      `${HEAD}export function inner(a: f32, b: f32): f32 { return a }
export function outer(p: f32, q: f32): f32 { return inner(q, p) }
@fragment export function fs(v: VsOut): vec4 {
  if (outer(k, v.uv.x) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'D3 a local carries the non-uniform parameter into the return',
      `${HEAD}export function via(x: f32, y: f32): f32 {
  const c = x * 2.
  return c + y
}
@fragment export function fs(v: VsOut): vec4 {
  if (via(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'D4 written under a branch on it, then returned',
      `${HEAD}export function via3(x: f32, y: f32): f32 {
  let acc: f32 = y
  if (x > 0.5) { acc = 1. }
  return acc
}
@fragment export function fs(v: VsOut): vec4 {
  if (via3(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
  ])('still refuses one whose result DOES depend on it, however indirectly: %s', (_w, src) => {
    // The other side of the summary: a parameter reaches the result through a local, through
    // a branch it does not appear in, or through a callee's own dependent slot. Each of these
    // is refused by Tint, and each would be accepted by a summary that read only the
    // `return` expressions.
    expect(errorsOf(src)[0]).toContain('is reached under "VsOut.uv"');
  });

  it('keeps the BARRIER threshold where it was: unknown is still not uniform', () => {
    // A barrier is accepted only when the flow is PROVABLY uniform, so a helper call in the
    // condition keeps the refusal whatever the arguments are — the relaxation may only ever
    // admit what is proven, and a user call is never proven.
    for (const cond of ['edge(f32(lid.x))', 'edge(k)']) {
      const errors = errorsOf(`declare const out: storage<array<f32>, "read_write">
declare const k: uniform<f32>
export function edge(x: f32): bool { return x > 0.5 }
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (${cond}) { workgroupBarrier() }
  out[lid.x] = 1.
}`);
      expect(errors.join('\n'), cond).toContain('workgroupBarrier() is reached under');
    }
  });
});

describe('where the diagnostic points', () => {
  it('underlines the barrier call, not the entry it sits in', () => {
    // The `call` node the barrier lowering returns carried no span, so §54's diagnostic fell
    // back to the enclosing declaration and underlined the entry's `@compute` decorator —
    // three lines above the statement an author has to move. An editor squiggle over a whole
    // function is a squiggle that says nothing.
    const source = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  if (lid.x > u32(4)) { workgroupBarrier(); }
  out[lid.x] = 1.;
}`;
    const [d, ...rest] = compileTsSource(source).diagnostics.filter((x) => x.category === 'error');
    expect(rest).toEqual([]);
    expect(d!.code).toBe(TS_CODES.UNIFORMITY);
    expect(source.slice(d!.start, d!.start + d!.length)).toBe('workgroupBarrier()');
    expect([d!.line, d!.endLine]).toEqual([4, 4]);
  });
});

describe('the call graph, walked to a fixpoint that does not read declaration order', () => {
  const BARRIER: Stmt = {
    s: 'call',
    expr: { op: 'call', type: voidT, fn: 'workgroupBarrier', args: [] },
  };
  const calls = (name: string): Stmt => ({
    s: 'call',
    expr: { op: 'call', type: voidT, fn: name, args: [] },
  });
  const helper = (name: string, body: readonly Stmt[]): FuncDecl => ({
    name,
    params: [],
    ret: voidT,
    body,
  });
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
  };
  const compute = (body: readonly Stmt[]): FuncDecl => ({
    name: 'cs',
    params: [{ name: 'lid', type: vec3uT, builtin: 'local_invocation_id' }],
    ret: voidT,
    body,
    stage: 'compute',
  });
  const moduleOf = (funcs: readonly FuncDecl[]): ModuleDecl => ({
    consts: [],
    structs: [],
    bindings: [],
    funcs,
  });

  it('answers a call chain the same whichever end of it is declared first', () => {
    // Accumulating the start classes into ONE map made the answer depend on `m.funcs` order:
    // a helper walked before its caller seeded its own callees from a start class nothing had
    // set yet, and `joinKnown` can only degrade, so a function two calls below an entry stayed
    // at that first guess forever. The same program compiled with the entry declared first and
    // did not with the helpers first — a difference an author has no way to read.
    const inner = helper('inner', [BARRIER]);
    const outer = helper('outer', [calls('inner')]);
    const entry = compute([calls('outer')]);
    expect(uniformityViolations(moduleOf([inner, outer, entry]))).toEqual([]);
    expect(uniformityViolations(moduleOf([entry, outer, inner]))).toEqual([]);
  });

  it('still carries a caller’s non-uniform control flow two calls down, in either order', () => {
    // The relaxation only ever admits what is proven, so the same chain under a branch on
    // `local_invocation_id` keeps the refusal — from the entry, through `outer`, into `inner`.
    const inner = helper('inner', [BARRIER]);
    const outer = helper('outer', [calls('inner')]);
    const entry = compute([{ s: 'if', arms: [{ cond: lidOver4, body: [calls('outer')] }] }]);
    for (const funcs of [
      [inner, outer, entry],
      [entry, outer, inner],
    ]) {
      const found = uniformityViolations(moduleOf(funcs));
      expect(found.map((v) => [v.fn, v.callee, v.kind])).toEqual([
        ['inner', 'workgroupBarrier', 'barrier'],
      ]);
      expect(found[0]!.cause).toContain('local_invocation_id');
    }
  });

  it('takes a helper NOTHING calls on its own terms, as WGSL does', () => {
    // A module of helpers alone — a fragment of a shader under test, or a library compiled by
    // itself — has no caller to claim anything wrong about, so its body starts uniform. A
    // pessimistic seed refused a barrier at the top level of such a module, under no branch at
    // all, with a message about moving it out of one; and no spelling got the module through,
    // since the diagnostic filter does not reach the barrier rule.
    expect(uniformityViolations(moduleOf([helper('sync', [BARRIER])]))).toEqual([]);
    // Not vacuous: the same barrier under a branch this walk cannot classify is still
    // reported, because `unknown` is not `uniform`.
    const opaque: Expr = { op: 'call', type: boolT, fn: 'hostSaysSo', args: [] };
    const found = uniformityViolations(
      moduleOf([helper('sync', [{ s: 'if', arms: [{ cond: opaque, body: [BARRIER] }] }])]),
    );
    expect(found.map((v) => [v.fn, v.kind])).toEqual([['sync', 'barrier']]);
  });
});

// ═══ A write's target, and WGSL's address-space table ═══
//
// Two rules that have nothing to do with each other and were found together. A write's TARGET
// is a computation, so its index expressions taint the written variable. And a read of
// `private`, `workgroup` or `read_write` storage is NON-UNIFORM ON SIGHT: Tint classifies by
// address space and does not look at what was written, so it refuses a read of a variable
// nothing in the module writes. An earlier round classified those spaces by the join of every
// write instead, which was four false acceptances against the table below.
//
// Measured on Chromium 141 (`chromium_headless_shell-1194`, `google / swiftshader`) through
// the compile gate's own mechanics, with the broken-shader instrument reporting `fn broken( {`
// first, front end and Tint on the same emitted module.
describe("a write's target, and the address space a read comes from", () => {
  const CS = (decls: string, body: string) => `declare const out: storage<array<f32>, "read_write">
${decls}@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
${body}
  out[lid.x] = 1.
}`;

  it('joins the INDEX a write lands on, through a helper (the summary)', () => {
    // `a[u32(x)] = y` makes every element of `a` depend on `x`: which element took `y` is what
    // `x` decided. The summary read the assigned value and the enclosing branch and not the
    // target's own index, so `idx`'s summary was `{y}` and the call site joined the uniform
    // argument. Tint: `'textureSample' must only be called from uniform control flow`, with
    // `parameter 'v' of 'fs' may be non-uniform`.
    expect(
      errorsOf(`${HEAD}export function idx(x: f32, y: f32): f32 {
  let a: array<f32, 2> = [0., 0.]
  a[u32(x)] = y
  return a[0]
}
@fragment export function fs(v: VsOut): vec4 {
  if (idx(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`)[0],
    ).toContain('textureSample() is reached under "VsOut.uv"');
  });

  it('joins it in the flow walk too, with no helper in sight (the same omission)', () => {
    // The same one-line gap one level out, and pre-existing rather than introduced: the walk's
    // assign arm classified the value and the branch and never the target's index. Tint
    // refuses this one as well.
    expect(
      errorsOf(`${HEAD}@fragment export function fs(v: VsOut): vec4 {
  let a: array<f32, 2> = [0., 0.]
  a[u32(v.uv.x)] = k
  if (a[0] > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`)[0],
    ).toContain('textureSample() is reached under "VsOut.uv"');
  });

  it('leaves a write whose index depends on nothing non-uniform alone', () => {
    // The triangulation that makes the two rows above about the INDEX and not about writes in
    // general: same helper, constant subscript. Tint ACCEPTS this, measured.
    expect(
      compiled(`${HEAD}export function idx3(x: f32, y: f32): f32 {
  let a: array<f32, 2> = [0., 0.]
  a[0] = y
  return a[0]
}
@fragment export function fs(v: VsOut): vec4 {
  if (idx3(v.uv.x, k) > 0.5) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`).wgsl,
    ).toContain('textureSample(t, s,');
  });

  it.each([
    [
      'a helper stows into a module var and returns something else entirely',
      `${HEAD}let stash: f32 = 0.
export function launder(nonUniform: f32, mode: f32): bool {
  stash = nonUniform
  return mode > 0.5
}
@fragment export function fs(v: VsOut): vec4 {
  if (launder(v.uv.x, k)) {
    if (stash > 0.25) { return textureSample(t, s, v.uv) }
  }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'a void helper stows and the caller reads it in a condition',
      `${HEAD}let stash: f32 = 0.
export function stow(x: f32): void { stash = x }
@fragment export function fs(v: VsOut): vec4 {
  stow(v.uv.x)
  if (stash > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'the READ is behind a nullary helper, so no argument carries it',
      `${HEAD}let stash: f32 = 0.
export function stow(x: f32): void { stash = x }
export function peek(): f32 { return stash }
@fragment export function fs(v: VsOut): vec4 {
  stow(v.uv.x)
  if (peek() > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'through a writable storage binding rather than a module var',
      `${HEAD}declare const scratch: storage<array<f32>, "read_write">
export function stow2(x: f32): void { scratch[0] = x }
@fragment export function fs(v: VsOut): vec4 {
  stow2(v.uv.x)
  if (scratch[0] > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
  ])('refuses a value laundered through shared memory: %s', (_what, src) => {
    // A return value is not the only thing that leaves a function. The summary is CORRECT
    // about the result in each of these and says nothing about the write, so the pass accepted
    // programs whose inline forms it already refused — the same program passing or failing on
    // whether its write went through a helper. Tint refuses every row.
    expect(errorsOf(src)[0]).toContain('is reached under');
  });

  it('does not assert `uniform` about a location a callee overwrote', () => {
    // The worse half, and a hang if it ships: the caller's own `stash = 1.` was bound into the
    // flow-sensitive environment, a statement-level call fell through the walk untouched, and
    // the barrier was reached at `uniform`. Tint: `'workgroupBarrier' must only be called from
    // uniform control flow`. Two controls measured beside it — replacing the call with the
    // assignment it performs, and dropping the prior write — were both already refused, so the
    // acceptance turned entirely on the call sitting between the two writes.
    const errors = errorsOf(
      CS(
        `let stash: f32 = 0.\nexport function stow(x: f32): void { stash = x }\n`,
        `  stash = 1.\n  stow(f32(lid.x))\n  if (stash > 0.5) { workgroupBarrier() }`,
      ),
    );
    expect(errors[0]).toContain('workgroupBarrier() is reached under');
    // Named by its ADDRESS SPACE now, not by the argument that was stowed into it: a read of
    // a module variable is non-uniform on sight, so the write side never enters the answer.
    expect(errors[0]).toContain('a module variable');
  });

  it('refuses a read of shared memory whatever was written into it', () => {
    // An earlier round claimed a location written only constants, or only a uniform buffer's
    // value, stayed uniform. That was FALSE against Tint, which classifies by ADDRESS SPACE
    // and does not look at the write side at all: measured, `reading from module-scope private
    // variable 'flag' may result in a non-uniform value` for both of these, and for a variable
    // NOTHING in the module writes.
    for (const write of ['  flag = 1.', '  flag = k2', '']) {
      const src = CS(
        `declare const k2: uniform<f32>\nlet flag: f32 = 1.\n`,
        `${write}\n  if (flag > 0.5) { workgroupBarrier() }`,
      );
      expect(errorsOf(src)[0], write).toContain('workgroupBarrier() is reached under');
    }
  });

  it.each([
    ['a module const', 'const MODE: f32 = 1.\n', 'MODE'],
    ['an override', 'declare const lod: override<f32>\n', 'lod'],
    ['a uniform buffer', 'declare const k3: uniform<f32>\n', 'k3'],
    ['a READ-ONLY storage element', 'declare const ro: storage<array<f32>>\n', 'ro[0]'],
  ])('leaves the uniform side of the address-space table alone: %s', (_what, decl, read) => {
    // The other half of the table, and the half that keeps it from being a blanket ban. Each
    // measured ACCEPTED on Tint.
    expect(errorsOf(CS(decl, `  if (${read} > 0.5) { workgroupBarrier() }`))).toEqual([]);
  });

  it('accepts workgroupUniformLoad, the one way left to branch on workgroup memory', () => {
    // With a workgroup read non-uniform on sight, this builtin is the only spelling that can
    // carry a barrier — it IS one value for the workgroup, with a barrier on each side, which
    // is what it exists for. Refusing it left an author no way to write the program at all.
    // Measured ACCEPTED on Tint, with the same module refused when the load is dropped.
    const src = CS(
      `let tile4: workgroup<array<f32, 4>>\n`,
      `  tile4[lid.x] = f32(lid.x)\n  if (workgroupUniformLoad(tile4[0]) > 0.5) { workgroupBarrier() }`,
    );
    expect(errorsOf(src)).toEqual([]);
    expect(
      errorsOf(
        CS(
          `let tile5: workgroup<array<f32, 4>>\n`,
          `  tile5[lid.x] = f32(lid.x)\n  if (tile5[0] > 0.5) { workgroupBarrier() }`,
        ),
      )[0],
    ).toContain('workgroupBarrier() is reached under');
  });

  it.each([
    [
      'a private variable',
      `${HEAD}let stash: f32 = 0.
export function peek(): f32 { return stash }
@fragment export function fs(v: VsOut): vec4 {
  if (peek() > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
    [
      'a read_write storage element',
      `${HEAD}declare const scratch: storage<array<f32>, "read_write">
export function peek2(): f32 { return scratch[0] }
@fragment export function fs(v: VsOut): vec4 {
  if (peek2() > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`,
    ],
  ])('carries the address space out of a NULLARY helper: %s', (_what, src) => {
    // A call's class floors at `unknown` and never looks inside a body, so a helper with no
    // parameters had an empty summary and went through. One bit on the summary carries it.
    // Both measured REFUSED on Tint; the same helper returning a `uniform` is ACCEPTED by both
    // and is the row below.
    expect(errorsOf(src)[0]).toContain('is reached under');
  });

  it('and leaves a nullary helper that returns a UNIFORM alone', () => {
    expect(
      compiled(`${HEAD}export function peek3(): f32 { return k }
@fragment export function fs(v: VsOut): vec4 {
  if (peek3() > 0.25) { return textureSample(t, s, v.uv) }
  return vec4(0., 0., 0., 1.)
}`).wgsl,
    ).toContain('textureSample(t, s,');
  });
});

// ═══ A `break` or `continue` under a non-uniform condition (proposal 0008 §4, Rule 8.5) ═══
//
// The walk modelled `return` alone, so a jump out of a loop under `lid.x` left the rest of the
// loop uniform, and every refused row below compiled with no diagnostic and failed at
// `createShaderModule`. Each row was measured on Chromium 141 (`chromium_headless_shell-1194`)
// with the instrument reporting a broken shader first, the refused ones as
// `'workgroupBarrier' must only be called from uniform control flow` (or the same of
// `textureSample`), and the accepted ones compiled whole:
//
//   barrier below `if (lid.x > 2u) { break; }` in the body, `for`, `while` and `for…of`   refused
//   the same with `continue`                                                              refused
//   barrier ABOVE the jump, `break` and `continue` alike (the second iteration)           refused
//   barrier below a `break` out of a `switch` case, in that case                          refused
//   `textureSample` below the jump in a fragment loop, and above it                        refused
//   a local the loop writes, before or after the jump, branched on after the loop         refused
//   the same through a UNIFORM `break` or `continue`, carrying `f32(lid.x)` out            refused
//   a barrier above or below `if (lid.x > 2u) { return; }` in a loop, or below the loop    refused
//   barrier below the loop, the jump non-uniform                                          ACCEPTED
//   barrier in the body, the jump on a uniform, on the counter, on `workgroup_id`         ACCEPTED
//   barrier in the outer loop, the non-uniform `break` in an inner one                    ACCEPTED
//   barrier after the `switch`, or above the `break` in the case                          ACCEPTED
//   barrier after a loop whose `continue` is non-uniform                                  ACCEPTED
//   `textureSample` below the loop, `textureSampleLevel` below the jump                   ACCEPTED
describe('a break or continue taken under a non-uniform condition', () => {
  const kernel = (body: string, decls = ''): string =>
    `declare const out: storage<array<u32>, "read_write">;
declare const k: uniform<f32>;
${decls}@compute([64]) export function cs(@builtin("local_invocation_id") lid: vec3u, @builtin("workgroup_id") wid: vec3u): void {
${body}
}`;
  const leftByBreak = barrierRefusal(
    'workgroupBarrier',
    `in a loop some invocations leave by a break taken under ${LID}`,
    'Move it out of the loop',
    'break on',
  );
  const skippedByContinue = barrierRefusal(
    'workgroupBarrier',
    `in a loop where some invocations skip ahead by a continue taken under ${LID}`,
    'Move it out of the loop',
    'continue on',
  );
  const branchedOnLid = barrierRefusal(
    'workgroupBarrier',
    `under ${LID}`,
    'Move it out of the branch',
    'branch on',
  );

  it.each([
    [
      'below a break, in a for',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { break; }
    workgroupBarrier();
  }`,
      leftByBreak,
    ],
    [
      'ABOVE a break: the next iteration is reached by fewer invocations',
      `  for (let i: i32 = 0; i < 4; i++) {
    workgroupBarrier();
    if (lid.x > 2) { break; }
  }`,
      leftByBreak,
    ],
    [
      'below a break, in a while',
      `  let i: i32 = 0;
  while (i < 4) {
    if (lid.x > 2) { break; }
    workgroupBarrier();
    i++;
  }`,
      leftByBreak,
    ],
    [
      'below a break, in a for…of',
      `  const xs = array<u32, 4>(1, 2, 3, 4);
  for (const x of xs) {
    if (lid.x > x) { break; }
    workgroupBarrier();
  }`,
      leftByBreak,
    ],
    [
      'below a break in an else, and in an if nested in a uniform one',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (k > 0.5) {
      if (lid.x > 2) { out[i] = 1; } else { break; }
    }
    workgroupBarrier();
  }`,
      leftByBreak,
    ],
    [
      'below a continue',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { continue; }
    workgroupBarrier();
  }`,
      skippedByContinue,
    ],
    [
      'ABOVE a continue',
      `  for (let i: i32 = 0; i < 4; i++) {
    workgroupBarrier();
    if (lid.x > 2) { continue; }
  }`,
      skippedByContinue,
    ],
    [
      'below a continue taken inside a switch, which continues the loop',
      `  for (let i: i32 = 0; i < 4; i++) {
    switch (i32(wid.x)) {
      case 0: {
        if (lid.x > 2) { continue; }
        out[0] = 1;
        break;
      }
      default: { }
    }
    workgroupBarrier();
  }`,
      skippedByContinue,
    ],
    [
      'below a break out of a switch case, in that case',
      `  switch (i32(wid.x)) {
    case 0: {
      if (lid.x > 2) { break; }
      workgroupBarrier();
      break;
    }
    default: { }
  }`,
      barrierRefusal(
        'workgroupBarrier',
        `after a break out of the switch taken under ${LID}`,
        'Move it above the break',
        'break on',
      ),
    ],
    [
      'ABOVE a return taken in a loop, and so below it on the next iteration',
      `  for (let i: i32 = 0; i < 4; i++) {
    workgroupBarrier();
    if (lid.x > 2) { return; }
  }`,
      barrierRefusal(
        'workgroupBarrier',
        `after a return taken inside a loop under ${LID}`,
        'Move it above the loop',
        'return on',
      ),
    ],
    [
      // The first pass of the body reaches it after a plain `return`, the settled one after a
      // return a loop takes; the settled one names it, since "above the return" is refused too.
      'below a return taken in a loop',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { return; }
    workgroupBarrier();
  }`,
      barrierRefusal(
        'workgroupBarrier',
        `after a return taken inside a loop under ${LID}`,
        'Move it above the loop',
        'return on',
      ),
    ],
    [
      'below the loop a return was taken in',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { return; }
  }
  workgroupBarrier();`,
      barrierRefusal(
        'workgroupBarrier',
        `after a return taken inside a loop under ${LID}`,
        'Move it above the loop',
        'return on',
      ),
    ],
  ])('refuses a barrier %s', (_what, body, want) => {
    expect(errorsOf(kernel(body))).toEqual([want]);
  });

  it.each([
    [
      'written below the jump',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { break; }
    x = x + 1.;
  }
  if (x > 3.) { workgroupBarrier(); }`,
    ],
    [
      'written above it, a constant (the second iteration writes it)',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    x = 1.;
    if (lid.x > 2) { break; }
  }
  if (x > 0.5) { workgroupBarrier(); }`,
    ],
    [
      'written below a continue',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { continue; }
    x = x + 1.;
  }
  if (x > 3.) { workgroupBarrier(); }`,
    ],
    [
      'the counter of a while',
      `  let i: i32 = 0;
  while (i < 4) {
    if (lid.x > 2) { break; }
    i++;
  }
  if (i > 2) { workgroupBarrier(); }`,
    ],
    [
      'carried out by a UNIFORM break, though the body ends with a constant',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    x = f32(lid.x);
    if (k > 0.5) { break; }
    x = 0.;
  }
  if (x > 0.5) { workgroupBarrier(); }`,
    ],
    [
      'carried to the next iteration by a UNIFORM continue',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (x > 0.5) { workgroupBarrier(); }
    x = f32(lid.x);
    if (k > 0.5) { continue; }
    x = 0.;
  }`,
    ],
    [
      'carried out of a switch by a break',
      `  let x = 0.;
  switch (i32(wid.x)) {
    case 0: {
      x = f32(lid.x);
      if (k > 0.5) { break; }
      x = 0.;
      break;
    }
    default: { }
  }
  if (x > 0.5) { workgroupBarrier(); }`,
    ],
  ])('refuses a branch on a local the loop wrote, %s', (_what, body) => {
    expect(errorsOf(kernel(body))).toEqual([branchedOnLid]);
  });

  it.each([
    [
      'below the loop the break left',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { break; }
    out[i] = 1;
  }
  workgroupBarrier();`,
    ],
    [
      'below the loop a continue skipped ahead in',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { continue; }
    out[i] = 1;
  }
  workgroupBarrier();`,
    ],
    [
      'in the body, the break on a uniform',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (k > 0.5) { break; }
    workgroupBarrier();
  }`,
    ],
    [
      'in the body, the break on the counter',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (i === 2) { break; }
    workgroupBarrier();
  }`,
    ],
    [
      'in the body, the continue on workgroup_id',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (wid.x > 2) { continue; }
    workgroupBarrier();
  }`,
    ],
    [
      'in the outer loop, the break in an inner one',
      `  for (let j: i32 = 0; j < 4; j++) {
    for (let i: i32 = 0; i < 4; i++) {
      if (lid.x > 2) { break; }
      out[i] = 1;
    }
    workgroupBarrier();
  }`,
    ],
    [
      'in a loop body after a switch a break left',
      `  for (let i: i32 = 0; i < 4; i++) {
    switch (i32(wid.x)) {
      case 0: {
        if (lid.x > 2) { break; }
        out[0] = 1;
        break;
      }
      default: { }
    }
    workgroupBarrier();
  }`,
    ],
    [
      'above the break in a switch case, which runs once',
      `  switch (i32(wid.x)) {
    case 0: {
      workgroupBarrier();
      if (lid.x > 2) { break; }
      out[0] = 1;
      break;
    }
    default: { }
  }`,
    ],
    [
      'above a loop a return is taken in',
      `  workgroupBarrier();
  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { return; }
  }`,
    ],
    [
      'after a local the loop wrote is written again below it',
      `  let x = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { break; }
  }
  x = 2.;
  if (x > 3.) { workgroupBarrier(); }`,
    ],
  ])('accepts a barrier %s', (_what, body) => {
    expect(errorsOf(kernel(body))).toEqual([]);
  });

  it('refuses a sample below the jump and above it, and takes one below the loop', () => {
    const loop = (inner: string): string =>
      frag(`  let c = vec4(0., 0., 0., 0.);
  for (let i: i32 = 0; i < 4; i++) {
${inner}
  }
  return c;`);
    const refusal = sampleRefusal(
      `in a loop some invocations leave by a break taken under ${UV}`,
      'Hoist the call out of the loop',
    );
    expect(
      errorsOf(
        loop(`    if (v.uv.x > 0.5) { break; }
    c = c + textureSample(t, s, v.uv + vec2(f32(i), 0.));`),
      ),
    ).toEqual([refusal]);
    expect(
      errorsOf(
        loop(`    c = c + textureSample(t, s, v.uv + vec2(f32(i), 0.));
    if (v.uv.x > 0.5) { break; }`),
      ),
    ).toEqual([refusal]);
    // The two remedies it names: the level of detail written, and the call out of the loop.
    expect(
      compiled(
        loop(`    if (v.uv.x > 0.5) { break; }
    c = c + textureSampleLevel(t, s, v.uv, 0.);`),
      ).wgsl,
    ).toContain('textureSampleLevel(t, s,');
    expect(
      compiled(
        frag(`  let c = vec4(0., 0., 0., 0.);
  for (let i: i32 = 0; i < 4; i++) {
    if (v.uv.x > 0.5) { break; }
    c = c + vec4(1., 0., 0., 0.);
  }
  return c + textureSample(t, s, v.uv);`),
      ).wgsl,
    ).toContain('textureSample(t, s,');
  });

  it('carries the condition of a jump into a helper’s summary', () => {
    // `count(x)` returns how many iterations ran, which `x` decided through the break. Tint
    // refuses the sample under `count(v.uv.x)`, through a `break` and through a `continue`,
    // and accepts it under `count(k)`.
    const counted = (jump: string, arg: string): string =>
      `${HEAD}function count(x: f32): f32 {
  let n = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (x > 0.5) { ${jump}; }
    n = n + 1.;
  }
  return n;
}
@fragment export function fs(v: VsOut): vec4 {
  if (count(${arg}) > 2.) { return textureSample(t, s, v.uv); }
  return vec4(0., 0., 0., 1.);
}`;
    for (const jump of ['break', 'continue']) {
      expect(errorsOf(counted(jump, 'v.uv.x')), jump).toEqual([
        sampleRefusal(`under ${UV}`, 'Hoist the call above the branch'),
      ]);
      expect(compiled(counted(jump, 'k')).wgsl, jump).toContain('textureSample(t, s,');
    }
  });

  it('carries the condition of a break out of a switch case into a helper’s summary', () => {
    // `pick(x)` returns what the case wrote, which `x` decided through the break. Tint refuses
    // the sample under `pick(v.uv.x)` ("'textureSample' must only be called from uniform
    // control flow") and accepts it under `pick(k)`.
    const picked = (arg: string): string => `${HEAD}function pick(x: f32): f32 {
  let r = 0.;
  switch (i32(k)) {
    case 0: {
      if (x > 0.5) { break; }
      r = 1.;
      break;
    }
    default: { }
  }
  return r;
}
@fragment export function fs(v: VsOut): vec4 {
  if (pick(${arg}) > 0.5) { return textureSample(t, s, v.uv); }
  return vec4(0., 0., 0., 1.);
}`;
    expect(errorsOf(picked('v.uv.x'))).toEqual([
      sampleRefusal(`under ${UV}`, 'Hoist the call above the branch'),
    ]);
    expect(compiled(picked('k')).wgsl).toContain('textureSample(t, s,');
  });

  // Only a jump taken under DEFINITELY non-uniform control flow narrows the loop. Each of these
  // compiled before this change, and Tint accepts each, measured: `done` and `f64(…)` are
  // values this walk cannot classify, and `out.length` is the size of the bound buffer.
  it.each([
    [
      'below a break on a helper it cannot see through',
      `  for (let i: i32 = 0; i < 8; i++) {
    if (done(i)) { break; }
    workgroupBarrier();
  }`,
    ],
    [
      'above a break on that helper',
      `  for (let i: i32 = 0; i < 8; i++) {
    workgroupBarrier();
    if (done(i)) { break; }
  }`,
    ],
    [
      'above a continue on it',
      `  for (let i: i32 = 0; i < 8; i++) {
    workgroupBarrier();
    if (done(i)) { continue; }
    out[i] = 1;
  }`,
    ],
    [
      'below a break on a comparison of doubles',
      `  const lim: f64 = f64(k);
  for (let i: i32 = 0; i < 8; i++) {
    if (f64(f32(i)) > lim) { break; }
    workgroupBarrier();
  }`,
    ],
    [
      'below a break on the length of a read_write storage array',
      `  for (let i: u32 = 0; i < 64; i++) {
    if (i >= out.length) { break; }
    workgroupBarrier();
  }`,
    ],
  ])('accepts a barrier %s', (_what, body) => {
    const src = kernel(body, 'function done(i: i32): bool { return f32(i) > k; }\n');
    expect(errorsOf(src)).toEqual([]);
    expect(compiled(src).wgsl).toContain('workgroupBarrier();');
  });

  // The sentence names what made the flow non-uniform FIRST. A loop inside a branch on `lid`
  // is reached under that branch, whatever its bound; a jump taken on a shared value in a loop
  // `lid` bounds leaves the loop's reason standing. Each named move compiles on Tint.
  const inLoopBoundByLid = barrierRefusal(
    'workgroupBarrier',
    `in a loop whose condition reads ${LID}`,
    'Move it out of the loop',
    'bound the loop by',
  );
  it.each([
    [
      'in a for with a constant bound, inside a branch on lid',
      `  if (lid.x > 2) {
    for (let j: i32 = 0; j < 4; j++) {
      workgroupBarrier();
    }
  }`,
      branchedOnLid,
    ],
    [
      'in a while with a constant bound, inside a branch on lid',
      `  if (lid.x > 2) {
    let j: i32 = 0;
    while (j < 4) {
      workgroupBarrier();
      j++;
    }
  }`,
      branchedOnLid,
    ],
    [
      'in a for…of, inside a branch on lid',
      `  const xs = array<u32, 4>(1, 2, 3, 4);
  if (lid.x > 2) {
    for (const x of xs) {
      workgroupBarrier();
      out[x] = 1;
    }
  }`,
      branchedOnLid,
    ],
    [
      'in a constant loop inside a loop a break left',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (lid.x > 2) { break; }
    for (let j: i32 = 0; j < 4; j++) {
      workgroupBarrier();
    }
  }`,
      leftByBreak,
    ],
    [
      'below a break on a uniform, in a loop lid bounds',
      `  for (let i: u32 = 0; i < lid.x; i++) {
    if (k > 0.5) { break; }
    workgroupBarrier();
  }`,
      inLoopBoundByLid,
    ],
    [
      'above a continue on a uniform, in a loop lid bounds',
      `  for (let i: u32 = 0; i < lid.x; i++) {
    workgroupBarrier();
    if (k > 0.5) { continue; }
  }`,
      inLoopBoundByLid,
    ],
    [
      'above an unconditional break, in a loop lid bounds',
      `  for (let i: u32 = 0; i < lid.x; i++) {
    workgroupBarrier();
    break;
  }`,
      inLoopBoundByLid,
    ],
    [
      'below a loop lid bounds that a return on a uniform left',
      `  for (let i: u32 = 0; i < lid.x; i++) {
    if (k > 0.5) { return; }
  }
  workgroupBarrier();`,
      barrierRefusal(
        'workgroupBarrier',
        `after a return inside a loop whose condition reads ${LID}`,
        'Move it above the loop',
        'bound the loop by',
      ),
    ],
    [
      // The refusal is main's, and conservative (#180): Tint accepts `done`, which compares to a
      // uniform. Pinned for the sentence, whose value, unclassified, comes last.
      'below a loop a return under a helper it cannot see through left',
      `  for (let i: i32 = 0; i < 4; i++) {
    if (done(i)) { return; }
  }
  workgroupBarrier();`,
      barrierRefusal(
        'workgroupBarrier',
        'after a return taken inside a loop under done(…), which this compiler cannot prove uniform',
        'Move it above the loop',
        'return on',
      ),
    ],
  ])('names the flow a barrier is reached under: %s', (_what, body, want) => {
    expect(errorsOf(kernel(body, 'function done(i: i32): bool { return f32(i) > k; }\n'))).toEqual([
      want,
    ]);
  });

  it('names the flow a derivative is reached under, with the hoist that fits it', () => {
    // A loop inside a branch on a fragment input: hoisting the sample out of the loop leaves it
    // under the branch, so the branch is named.
    expect(
      errorsOf(
        frag(`  let c = vec4(0., 0., 0., 0.);
  if (v.uv.x > 0.5) {
    for (let i: i32 = 0; i < 4; i++) {
      c = c + textureSample(t, s, v.uv + vec2(f32(i), 0.));
    }
  }
  return c;`),
      ),
    ).toEqual([sampleRefusal(`under ${UV}`, 'Hoist the call above the branch')]);
    // After a break out of a switch case, the rest of the case.
    expect(
      errorsOf(
        frag(`  let c = vec4(0., 0., 0., 0.);
  switch (i32(k)) {
    case 0: {
      if (v.uv.x > 0.5) { break; }
      c = textureSample(t, s, v.uv);
      break;
    }
    default: { }
  }
  return c;`),
      ),
    ).toEqual([
      sampleRefusal(
        `after a break out of the switch taken under ${UV}`,
        'Hoist the call above the break',
      ),
    ]);
    // Above a return taken in the loop, which the next iteration reaches after it.
    expect(
      errorsOf(
        frag(`  let c = vec4(0., 0., 0., 0.);
  for (let i: i32 = 0; i < 4; i++) {
    c = c + textureSample(t, s, v.uv + vec2(f32(i), 0.));
    if (v.uv.x > 0.5) { return c; }
  }
  return c;`),
      ),
    ).toEqual([
      sampleRefusal(
        `after a return taken inside a loop under ${UV}`,
        'Hoist the call above the loop',
      ),
    ]);
    // A screen-space derivative after a continue, whose remedy has no explicit-LOD form.
    expect(
      errorsOf(
        frag(`  let c = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (v.uv.x > 0.5) { continue; }
    c = c + dpdx(v.uv.y * f32(i));
  }
  return vec4(c, 0., 0., 1.);`),
      ),
    ).toEqual([
      `${TS_CODES.UNIFORMITY} dpdx() is reached in a loop where some invocations skip ahead by a continue taken under ${UV}, which WGSL's derivative_uniformity rule refuses: it differences neighbouring invocations, and one that did not run has no value to difference against. Hoist the call out of the loop and select from its result, or compute the quantity some other way — a screen-space derivative has no alternative form, or write @diagnostic("off", "derivative_uniformity") on the entry to take the module as written.`,
    ]);
  });

  it('follows a copy chain nested in a branch to its end, however many rounds that takes', () => {
    // The loop's fixpoint was bounded by the body's top-level length, one `if` here, and the
    // chain outran it: `a` stayed uniform. Tint refuses both, measured.
    const chain = (names: string[], barrierAbove: boolean): string => {
      const lets = names.map((n) => `  let ${n} = 0.;`).join('\n');
      const copies = names
        .slice(1)
        .map((n, i) => `      ${names[i]} = ${n};`)
        .join('\n');
      const top = barrierAbove
        ? '      workgroupBarrier();\n      if (a > 0.5) { break; }'
        : '      if (a > 0.5) { workgroupBarrier(); }';
      return kernel(`${lets}
  for (let i: i32 = 0; i < 4; i++) {
    if (k > 0.5) {
${top}
${copies}
      ${names[names.length - 1]} = f32(lid.x);
    }
  }`);
    };
    expect(errorsOf(chain(['a', 'b', 'c', 'd'], true))).toEqual([
      barrierRefusal(
        'workgroupBarrier',
        `in a loop some invocations leave by a break taken under ${LID}`,
        'Move it out of the loop',
        'break on',
      ),
    ]);
    expect(errorsOf(chain(['a', 'b', 'c', 'd', 'e', 'f'], false))).toEqual([branchedOnLid]);
  });
});

// ═══ The right side of `&&` and `||` (proposal 0008 §4, Rule 8.5) ═══
//
// It runs only where the left side lets it, which WGSL's analysis reads as a branch on the left
// side's value. Measured on Chromium 141: `v.uv.x > 0.5 && textureSample(…).x > 0.5` is
// "'textureSample' must only be called from uniform control flow"; with a uniform on the left
// it is accepted. The walk checked every call of an expression under one flow, so the first
// compiled with no diagnostic.
describe('a call on the right of && or ||', () => {
  it('refuses a sample right of a fragment input, and takes one right of a uniform', () => {
    const cond = (left: string): string =>
      frag(`  if (${left} && textureSample(t, s, v.uv).x > 0.5) { return vec4(1., 0., 0., 1.); }
  return vec4(0., 0., 0., 1.);`);
    expect(errorsOf(cond('v.uv.x > 0.5'))).toEqual([
      sampleRefusal(
        `on the right of an && or || whose left side reads ${UV}`,
        'Hoist the call above the && or ||',
      ),
    ]);
    expect(compiled(cond('k > 0.5')).wgsl).toContain('textureSample(t, s,');
  });
});

// ═══ `arrayLength`, the size of the bound buffer ═══
//
// `out.length` on a runtime-sized `read_write` storage array lowers to `arrayLength(&out)`,
// which reads no element. Measured on Chromium 141: a barrier under `if (arrayLength(&o) > 4u)`
// is accepted, and so is one in a loop it bounds, and a `textureSample` under a branch on a
// helper that returns it; the same under `o[0]` is refused. The walk joined the argument and
// read it as a `read_write` read, so all three were refused.
describe('the length of a read_write storage array', () => {
  const kernel = (body: string): string =>
    `declare const out: storage<array<u32>, "read_write">;
@compute([64]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
${body}
}`;
  it.each([
    ['under a branch on it', '  if (out.length > 4) { workgroupBarrier(); }'],
    ['in a loop it bounds', '  for (let i: u32 = 0; i < out.length; i++) { workgroupBarrier(); }'],
  ])('is one value for the dispatch: a barrier %s compiles', (_what, body) => {
    expect(compiled(kernel(body)).wgsl).toContain('workgroupBarrier();');
  });

  it('is one value through a helper that returns it, and an element is not', () => {
    const sampled = (read: string): string =>
      `declare const buf: storage<array<u32>, "read_write">
function n(): u32 { return ${read}; }
${frag(`  if (n() > 4) { return textureSample(t, s, v.uv); }
  return vec4(0., 0., 0., 1.);`)}`;
    expect(compiled(sampled('buf.length')).wgsl).toContain('textureSample(t, s,');
    expect(errorsOf(sampled('buf[0]'))).toEqual([
      sampleRefusal(
        'under n(…), which reads memory the invocations share',
        'Hoist the call above the branch',
      ),
    ]);
  });

  it('is not an element, which still varies', () => {
    expect(errorsOf(kernel('  if (out[0] > 4) { workgroupBarrier(); }'))).toEqual([
      barrierRefusal(
        'workgroupBarrier',
        'under "out" (a read_write storage buffer)',
        'Move it out of the branch',
        'branch on',
      ),
    ]);
  });
});
