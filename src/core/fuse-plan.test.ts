// The facts through a method (proposal 0110, D4). A chain of kernel functions whose loops call a
// member of a class on an element plans as the same chain written inline: the same groups, the
// same dispatches and the same scratch arrays held as locals, or the same reason where a fact
// fails. The planner reads the facts the compiler writes into each kernel function's face and
// analyzes no IR (`core/fuse-group.ts`), so this file compiles each chain's functions twice,
// once through the members of `Voice` and once with each member's body written into the loop,
// and plans both from their faces as the runtime plans them. One chain per form fuses and one
// stands apart: a method that changes its object, a method that reads it, a static function, and
// a method that hands a field to an `@inout` parameter. A reason that names an access names it
// as the author wrote it: the object a method is called on, or the field the inline form reads.
//
// Verifies: Rule 8.29 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { hostFace } from '../compiler/ts/host-face.js';
import { DEFAULT_STORAGE_BUFFERS, groupCalls, type GroupCall } from './fuse-group.js';
import type { KernelFace } from './host-kernel.js';

// ─── the two forms ───────────────────────────────────────────────────────────────────────────

const CLASS = `class Voice {
  phase!: f32;
  freq!: f32;
  tick(dt: f32): f32 {
    this.phase = this.phase + this.freq * dt;
    return this.phase;
  }
  level(): f32 {
    return this.phase * 0.5;
  }
  static mixOf(a: f32, b: f32): f32 {
    return a * 0.5 + b * 0.5;
  }
  bumpBy(d: f32): void {
    nudge(this.phase, d);
  }
}
function nudge(x: inout<f32>, d: f32): void {
  x = x + d;
}`;

/** Each kernel function: its parameters, its loop's bound, and its body through the members and
 *  inline. Every function is five lines, so a statement is on the same line in both forms. */
const FUNCTIONS: readonly (readonly [string, string, string, string, string])[] = [
  [
    'tickAll',
    'vs: array<Voice>, t: array<f32>, dt: f32',
    'vs.length',
    't[i] = vs[i].tick(dt);',
    'vs[i].phase = vs[i].phase + vs[i].freq * dt; t[i] = vs[i].phase;',
  ],
  [
    'levelAll',
    'u: array<f32>, vs: array<Voice>',
    'u.length',
    'u[i] = vs[i].level();',
    'u[i] = vs[i].phase * 0.5;',
  ],
  [
    'levelNext',
    'u: array<f32>, vs: array<Voice>',
    'u.length',
    'u[i] = vs[i + 1].level();',
    'u[i] = vs[i + 1].phase * 0.5;',
  ],
  [
    'mixAll',
    't: array<f32>, a: array<f32>, b: array<f32>',
    't.length',
    't[i] = Voice.mixOf(a[i], b[i]);',
    't[i] = a[i] * 0.5 + b[i] * 0.5;',
  ],
  [
    'bumpAll',
    'vs: array<Voice>, d: f32',
    'vs.length',
    'vs[i].bumpBy(d);',
    'nudge(vs[i].phase, d);',
  ],
  [
    'scale',
    'out: array<f32>, t: array<f32>',
    'out.length',
    'out[i] = t[i] * 2.;',
    'out[i] = t[i] * 2.;',
  ],
];

type Form = 'method' | 'inline';

function sourceOf(form: Form): string {
  const fns = FUNCTIONS.map(
    ([name, params, count, method, inline]) =>
      `export function ${name}(${params}) {\n  for (let i: u32 = 0; i < ${count}; i++) {\n    ${form === 'method' ? method : inline}\n  }\n}`,
  );
  return `"use typeshade";\n${CLASS}\n${fns.join('\n')}\n`;
}

/** The kernel faces of one form, by function, as the generated module carries them. */
function facesOf(form: Form): ReadonlyMap<string, KernelFace> {
  const g = hostFace(sourceOf(form), { fileName: `/app/${form}.shade.ts`, fuse: true });
  expect(g.diagnostics).toEqual([]);
  const faces = new Map<string, KernelFace>();
  for (const e of g.exports ?? []) if (e.kind === 'kernel') faces.set(e.name, e.face);
  return faces;
}

const FACES: Readonly<Record<Form, ReadonlyMap<string, KernelFace>>> = {
  method: facesOf('method'),
  inline: facesOf('inline'),
};

/** The one-based line of the statement that holds `text` in the source of `form`. */
const lineOf = (form: Form, text: string): number =>
  sourceOf(form)
    .split('\n')
    .findIndex((l) => l.includes(text)) + 1;

// ─── the chains ──────────────────────────────────────────────────────────────────────────────

/** An array of the chain, known by identity. */
class Arr {
  constructor(readonly id: string) {}
}
const [vs, t, u, out, a, b, t2, out2] = ['vs', 't', 'u', 'out', 'a', 'b', 't2', 'out2'].map(
  (id) => new Arr(id),
);

/** One call: the kernel function, its arguments in parameter order, and its trip count. */
interface Step {
  readonly fn: string;
  readonly args: readonly (Arr | number)[];
  readonly n?: number;
}
const N = 1000;

/** What the planner reads of a step: the face, each array parameter's array, the loop's range
 *  (every loop starts at 0 and runs over its arrays' length) and WebGPU. */
function groupCall(form: Form, s: Step): GroupCall {
  const k = FACES[form].get(s.fn)!;
  return {
    k,
    arrays: k.params.map((p, i) => (p.k === 'array' ? (s.args[i] as Arr) : undefined)),
    range: { start: 0, n: s.n ?? N },
    tier: 'webgpu',
  };
}

/** The plan of a chain in one form: each group's calls, whether it fused, why it stands apart,
 *  its workgroup and the scratch arrays it holds as locals; and the dispatches, one for a group of
 *  several calls and one for each loop of a call alone. */
function planOf(form: Form, steps: readonly Step[], scratch: readonly Arr[] = []) {
  const calls = steps.map((s) => groupCall(form, s));
  const groups = groupCalls(calls, DEFAULT_STORAGE_BUFFERS, new Set(scratch));
  return {
    groups: groups.map((g) => ({
      calls: g.calls,
      fused: g.fused,
      why: g.why,
      workgroupSize: g.workgroupSize,
      contracted: g.contracted.map((x) => (x as Arr).id),
    })),
    dispatches: groups.reduce(
      (n, g) => n + (g.fused ? 1 : (calls[g.calls[0]!]!.k.gpu?.loops.length ?? 0)),
      0,
    ),
  };
}

describe('a chain of methods plans as the same chain written inline (change 0110, D4)', () => {
  it('the faces carry the facts of the inline loops, a read at another index worded as written', () => {
    for (const [name] of FUNCTIONS) {
      const m = FACES.method.get(name)!;
      const i = FACES.inline.get(name)!;
      expect(m.noGpu, name).toBeUndefined();
      expect(i.noGpu, name).toBeUndefined();
      const facts = (k: KernelFace) =>
        k.fuse!.facts.map((f) => ({
          ...f,
          arrays: f.arrays.map(({ first, ...rest }) => ({ ...rest, line: first?.line })),
        }));
      expect(facts(m), name).toEqual(facts(i));
    }
    // The one access not at the counter: the object the method is called on, and the field the
    // inline loop reads, each at the line of its statement.
    const first = (form: Form) =>
      FACES[form].get('levelNext')!.fuse!.facts[0]!.arrays.find((x) => x.param === 'vs')!.first;
    expect(first('method')).toEqual({ text: 'vs[i + 1]', line: lineOf('method', 'vs[i + 1]') });
    expect(first('inline')).toEqual({
      text: 'vs[i + 1].phase',
      line: lineOf('inline', 'vs[i + 1]'),
    });
  });

  /** `[form, a chain that fuses, its scratch arrays, a chain that stands apart]`. */
  const CHAINS: readonly (readonly [string, Step[], Arr[], Step[]])[] = [
    [
      'a method that changes its object, on an element',
      [
        { fn: 'tickAll', args: [vs, t, 0.5] },
        { fn: 'scale', args: [out, t] },
      ],
      [t],
      [
        { fn: 'tickAll', args: [vs, t, 0.5] },
        { fn: 'tickAll', args: [vs, u, 0.5] },
      ],
    ],
    [
      'a method that reads its object',
      [
        { fn: 'tickAll', args: [vs, t, 0.5] },
        { fn: 'levelAll', args: [u, vs] },
      ],
      [],
      [
        { fn: 'tickAll', args: [vs, t, 0.5] },
        { fn: 'levelNext', args: [u, vs] },
      ],
    ],
    [
      'a static function',
      [
        { fn: 'mixAll', args: [t, a, b] },
        { fn: 'scale', args: [out, t] },
      ],
      [t],
      [
        { fn: 'mixAll', args: [t2, a, b] },
        { fn: 'scale', args: [out2, t2], n: N - 1 },
      ],
    ],
    [
      'a method that hands a field to an @inout parameter',
      [
        { fn: 'bumpAll', args: [vs, 0.25] },
        { fn: 'levelAll', args: [u, vs] },
      ],
      [],
      [
        { fn: 'bumpAll', args: [vs, 0.25] },
        { fn: 'tickAll', args: [vs, t, 0.5] },
      ],
    ],
  ];

  it.each(CHAINS)('%s: fuses as the inline chain does', (_, chain, scratch) => {
    const plan = planOf('method', chain, scratch);
    expect(plan).toEqual(planOf('inline', chain, scratch));
    expect(plan.groups.map((g) => g.calls)).toEqual([[0, 1]]);
    expect(plan.dispatches).toBe(1);
    expect(plan.groups[0]!.contracted).toEqual(scratch.map((x) => x.id));
  });

  it.each(CHAINS)('%s: stands apart as the inline chain does', (_, _fused, _scratch, apart) => {
    const method = planOf('method', apart);
    const inline = planOf('inline', apart);
    expect(method.groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(method.dispatches).toBe(2);
    const words = (p: typeof method) => p.groups.map(({ why: _why, ...g }) => g);
    expect(words(method)).toEqual(words(inline));
    if (apart[1]!.fn === 'levelNext') {
      // F3 names the access as written: through the object, and through the field.
      expect(method.groups[1]!.why).toBe(
        `tickAll and levelNext run as two dispatches because levelNext reads \`vs[i + 1]\` (line ${String(lineOf('method', 'vs[i + 1]'))})`,
      );
      expect(inline.groups[1]!.why).toBe(
        `tickAll and levelNext run as two dispatches because levelNext reads \`vs[i + 1].phase\` (line ${String(lineOf('inline', 'vs[i + 1]'))})`,
      );
    } else expect(method.groups[1]!.why).toBe(inline.groups[1]!.why);
  });

  it('says which fact fails, in the words of the inline chain', () => {
    expect(planOf('method', CHAINS[0]![3]).groups[1]!.why).toBe(
      'tickAll and tickAll run as two dispatches because tickAll writes an array tickAll also writes',
    );
    expect(planOf('method', CHAINS[2]![3]).groups[1]!.why).toBe(
      `mixAll and scale run as two dispatches because the trip counts differ (${String(N)} and ${String(N - 1)})`,
    );
    expect(planOf('method', CHAINS[3]![3]).groups[1]!.why).toBe(
      'bumpAll and tickAll run as two dispatches because tickAll writes an array bumpAll also writes',
    );
  });
});
