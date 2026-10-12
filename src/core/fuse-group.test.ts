// The planner of the fuse scope (change 0058, steps 3 and 4): which recorded calls become one
// dispatch, what the report says of each call that does not, and which scratch arrays a fused
// group holds as locals. The faces here are built by hand, with the facts the compiler would write
// (`KernelFace.fuse`), so that each of F1 to F5 and each condition of a contraction is accepted and
// refused on its own, and every reason is read as the report words it. The planner reads facts
// and analyzes no IR; what the compiler writes is `src/compiler/ts/host-kernel.test.ts`, and the
// fused module built for a group the planner settles is `src/core/fuse-entry.test.ts`.
//
// It carries no rule tag yet: the rule it verifies is written by a later step of the change,
// which tags this file then (`reqs/README.md`).

import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  DEFAULT_STORAGE_BUFFERS,
  groupCalls,
  WEBGL2_APART,
  type GroupCall,
} from './fuse-group.js';
import type { FuseArray, FuseLoop, KernelFace, KernelParam } from './host-kernel.js';
import type { Tier } from './tiers.js';

// ─── faces by hand ───────────────────────────────────────────────────────────────────────────

interface FaceSpec {
  /** The array parameters in order, with what the loop does to each. */
  readonly arrays: readonly (FuseArray & { readonly s?: string })[];
  /** Value parameters, after the arrays. */
  readonly values?: readonly string[];
  /** The loop's facts, over the defaults. */
  readonly loop?: Partial<FuseLoop>;
  /** The loop's step. */
  readonly step?: number;
  /** No fuse record: a module built without `typeshade({ fuse: true })`. */
  readonly noFuse?: true;
  /** The function runs on the CPU, for this reason. */
  readonly noGpu?: string;
  /** Several loops: the number of facts. */
  readonly loops?: number;
}

const f32s = { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } } as const;

function face(name: string, spec: FaceSpec): KernelFace {
  const params: KernelParam[] = [
    ...spec.arrays.map((a): KernelParam => ({
      name: a.param,
      k: 'array',
      layout: f32s,
      writes: a.access !== 'read',
      s: a.s ?? 'array<f32>',
    })),
    ...(spec.values ?? []).map((v): KernelParam => ({
      name: v,
      k: 'value',
      type: { k: 'num', t: 'f32', s: 'f32' },
    })),
  ];
  const entry = `${name}_loop0`;
  const loop: FuseLoop = {
    entry,
    wg: 64,
    arrays: spec.arrays.map(({ s: _s, ...a }) => a),
    reduces: false,
    scatters: false,
    continues: false,
    iterates: entry,
    iteration: 2,
    ...spec.loop,
  };
  const base = { name, fn: name, params, result: { k: 'void', s: 'void' } } as const;
  if (spec.noGpu !== undefined) return { ...base, noGpu: spec.noGpu };
  return {
    ...base,
    gpu: {
      wgsl: '',
      args: {
        name: `${name}_args`,
        group: 0,
        binding: 0,
        space: 'uniform',
        writes: false,
        layout: { k: 'o', f: [], sz: 16 },
        s: `${name}_Args`,
      },
      arrays: [],
      loops: [
        {
          entry,
          range: `${name}__range0`,
          cop: '<',
          step: spec.step ?? 1,
          writes: [],
          checks: [],
          wg: 64,
        },
      ],
    },
    ...(spec.noFuse === true
      ? {}
      : {
          fuse: {
            origin: 'ops.shade.ts',
            facts: Array.from({ length: spec.loops ?? 1 }, () => loop),
            ir: { version: '0', module: {} },
          },
        }),
  };
}

type Fact = Partial<FuseArray> & { readonly s?: string };
const read = (param: string, more: Fact = {}): FuseArray & { s?: string } => ({
  param,
  access: 'read',
  atI: true,
  ...more,
});
const write = (param: string, more: Fact = {}): FuseArray & { s?: string } => ({
  param,
  access: 'write',
  atI: true,
  ...more,
});

// The operations of the report's own examples, as the compiler would describe them.
const add = face('add', { arrays: [write('out'), read('a'), read('b')] });
const mul = face('mul', { arrays: [write('out'), read('a'), read('b')] });
const relu = face('relu', { arrays: [write('out'), read('x')] });
const blur = face('blur', {
  arrays: [write('out'), read('t', { atI: false, first: { text: 't[i - 1]', line: 9 } })],
});
const total = face('total', { arrays: [read('xs')], loop: { reduces: true } });

// ─── calls by hand ───────────────────────────────────────────────────────────────────────────

/** An array, known by identity. */
const arr = (id: string): { id: string } => ({ id });

/** A call of `k` over the arrays given for its array parameters, in order. */
function call(
  k: KernelFace,
  arrays: readonly object[],
  options: {
    range?: GroupCall['range'];
    tier?: Tier;
  } = {},
): GroupCall {
  let next = 0;
  return {
    k,
    arrays: k.params.map((p) => (p.k === 'array' ? arrays[next++] : undefined)),
    range:
      'range' in options ? options.range : k.gpu === undefined ? undefined : { start: 0, n: 100 },
    tier: options.tier ?? 'webgpu',
  };
}

const [a, b, c, t, u, v, w, out] = ['a', 'b', 'c', 't', 'u', 'v', 'w', 'out'].map(arr) as [
  object,
  object,
  object,
  object,
  object,
  object,
  object,
  object,
];

/** The groups of `calls` as the names of the kernel functions in each, every `why`, and the
 *  scratch arrays each group holds as locals, by their ids. `scratch` are the plan's scratch
 *  arrays. */
function plan(
  calls: readonly GroupCall[],
  limit = DEFAULT_STORAGE_BUFFERS,
  scratch: readonly object[] = [],
) {
  const groups = groupCalls(calls, limit, new Set(scratch));
  return {
    names: groups.map((g) => g.calls.map((i) => calls[i]!.k.name)),
    fused: groups.map((g) => g.fused),
    why: groups.map((g) => g.why),
    contracted: groups.map((g) => g.contracted.map((a) => (a as { id: string }).id)),
  };
}

describe('a chain that the facts allow is one group', () => {
  it('fuses add, mul and relu, whose arrays meet only at the index', () => {
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])]);
    expect(p.names).toEqual([['add', 'mul', 'relu']]);
    expect(p.fused).toEqual([true]);
    expect(p.why).toEqual([undefined]);
  });

  it('has the first call of a scope in a group with nothing to stand apart from, whatever it is', () => {
    const p = plan([call(total, [t])]);
    expect(p.names).toEqual([['total']]);
    expect(p.fused).toEqual([false]);
    expect(p.why).toEqual([undefined]);
    expect(plan([])).toEqual({ names: [], fused: [], why: [], contracted: [] });
  });

  it('lets two calls read one array', () => {
    // `add` and `mul` both read `a`, and neither reads what the other writes.
    const p = plan([call(add, [t, a, b]), call(mul, [u, a, c])]);
    expect(p.names).toEqual([['add', 'mul']]);
  });
});

describe('F1: the function lowers, was built for fusion, has one loop that maps', () => {
  it.each([
    [
      'a function built without typeshade({ fuse: true })',
      face('mul', { arrays: [write('out'), read('a'), read('b')], noFuse: true }),
      'add and mul run as two dispatches because mul was built without typeshade({ fuse: true })',
    ],
    [
      'a function with two loops',
      face('twice', { arrays: [write('out'), read('a'), read('b')], loops: 2 }),
      'add and twice run as two dispatches because twice has more than one loop',
    ],
    [
      'a loop that reduces',
      face('dot', { arrays: [write('out'), read('a'), read('b')], loop: { reduces: true } }),
      'add and dot run as two dispatches because dot reduces',
    ],
    [
      'a loop that scatters',
      face('hist', { arrays: [write('out'), read('a'), read('b')], loop: { scatters: true } }),
      'add and hist run as two dispatches because hist scatters',
    ],
    [
      'a loop that continues',
      face('skip', { arrays: [write('out'), read('a'), read('b')], loop: { continues: true } }),
      'add and skip run as two dispatches because skip has a loop with a `continue`',
    ],
  ])('keeps %s apart, and says so in the words of the fact', (_what, k, why) => {
    const p = plan([call(add, [t, a, b]), call(k, [u, t, c])]);
    expect(p.names).toEqual([['add'], [k.name]]);
    expect(p.fused).toEqual([false, false]);
    expect(p.why).toEqual([undefined, why]);
  });

  it('keeps a function that runs on the CPU apart, with the reason its face gives', () => {
    const prefix = face('prefix', {
      arrays: [write('out')],
      noGpu: 'a loop of it runs on the CPU (TS8070)',
    });
    // On a device the call runs on the CPU tier because its function does.
    const p = plan([call(add, [t, a, b]), call(prefix, [t], { tier: 'cpu' })]);
    expect(p.why).toEqual([
      undefined,
      'prefix runs on the CPU, a loop of it runs on the CPU (TS8070)',
    ]);
    // The call after it is on WebGPU, and the reason names the call before. The first group of a
    // scope has no group before it to stand apart from.
    const q = plan([call(prefix, [t], { tier: 'cpu' }), call(relu, [out, u])]);
    expect(q.why).toEqual([undefined, 'relu runs apart from prefix, which runs on the CPU']);
  });

  it('keeps a call whose loop runs no iteration apart', () => {
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c], { range: { start: 0, n: 0 } })]);
    expect(p.why).toEqual([
      undefined,
      'add and mul run as two dispatches because mul has a loop that runs no iteration',
    ]);
  });

  it('starts a group at the call that fails, and the next call joins that group', () => {
    const p = plan([
      call(add, [t, a, b]),
      call(mul, [u, t, c]),
      call(total, [u]),
      call(relu, [out, v]),
      call(relu, [w, out]),
    ]);
    expect(p.names).toEqual([['add', 'mul'], ['total'], ['relu', 'relu']]);
    expect(p.fused).toEqual([true, false, true]);
    expect(p.why).toEqual([
      undefined,
      'mul and total run as two dispatches because total reduces',
      // `relu` cannot join `total` either: the group it would join does not map.
      'total and relu run as two dispatches because total reduces',
    ]);
  });
});

describe('F2: the same start, trip count and step', () => {
  const at = (start: number, n: number) => ({ range: { start, n } });

  it('joins calls that run the same range, from any start', () => {
    expect(plan([call(add, [t, a, b], at(3, 40)), call(mul, [u, t, c], at(3, 40))]).names).toEqual([
      ['add', 'mul'],
    ]);
  });

  it('refuses a different trip count, and says what each count is', () => {
    const p = plan([call(add, [t, a, b], at(0, 100)), call(mul, [u, t, c], at(0, 99))]);
    expect(p.names).toEqual([['add'], ['mul']]);
    expect(p.why).toEqual([
      undefined,
      'add and mul run as two dispatches because the trip counts differ (100 and 99)',
    ]);
  });

  it('refuses a different start', () => {
    const p = plan([call(add, [t, a, b], at(0, 100)), call(mul, [u, t, c], at(1, 100))]);
    expect(p.why[1]).toBe(
      'add and mul run as two dispatches because the loops start at different indices (0 and 1)',
    );
  });

  it('refuses a different step', () => {
    const odd = face('odd', { arrays: [write('out'), read('a'), read('b')], step: 2 });
    const p = plan([call(add, [t, a, b]), call(odd, [u, t, c])]);
    expect(p.why[1]).toBe(
      'add and odd run as two dispatches because the loops step by different amounts (1 and 2)',
    );
  });

  it('holds the whole group to one range, not the last call to the one before', () => {
    // Three calls of the same range, then a fourth that matches none of them.
    const p = plan([
      call(add, [t, a, b], at(0, 8)),
      call(mul, [u, a, b], at(0, 8)),
      call(relu, [v, c], at(0, 8)),
      call(relu, [w, c], at(0, 9)),
    ]);
    expect(p.names).toEqual([['add', 'mul', 'relu'], ['relu']]);
    expect(p.why[1]).toBe(
      'relu and relu run as two dispatches because the trip counts differ (8 and 9)',
    );
  });
});

describe('F3: what a call reads of an array another wrote, both at exactly i', () => {
  it('refuses a read that is not at i, in the words of the author and the line', () => {
    const p = plan([call(mul, [t, a, b]), call(blur, [out, t])]);
    expect(p.names).toEqual([['mul'], ['blur']]);
    expect(p.why).toEqual([
      undefined,
      'mul and blur run as two dispatches because blur reads `t[i - 1]` (line 9)',
    ]);
  });

  it('words a read with no line by the fact alone', () => {
    const k = face('shift', {
      arrays: [write('out'), read('t', { atI: false, first: { text: 't[i + 1]' } })],
    });
    expect(plan([call(mul, [t, a, b]), call(k, [out, t])]).why[1]).toBe(
      'mul and shift run as two dispatches because shift reads `t[i + 1]`',
    );
  });

  it('names the parameter when the fact has no words', () => {
    const k = face('shift', { arrays: [write('out'), read('t', { atI: false })] });
    expect(plan([call(mul, [t, a, b]), call(k, [out, t])]).why[1]).toBe(
      "mul and shift run as two dispatches because shift reads `t` other than at its loop's counter",
    );
  });

  it('refuses a write that is not at i when a later call reads the array', () => {
    const stride = face('stride', {
      arrays: [write('out', { atI: false, first: { text: 'out[2 * i]', line: 4 } }), read('x')],
    });
    const p = plan([call(stride, [t, a]), call(relu, [out, t])]);
    expect(p.names).toEqual([['stride'], ['relu']]);
    expect(p.why[1]).toBe(
      'stride and relu run as two dispatches because stride writes `out[2 * i]` (line 4)',
    );
    // A write that is not at i is no obstacle to a call that does not touch the array.
    expect(plan([call(stride, [t, a]), call(relu, [out, b])]).names).toEqual([['stride', 'relu']]);
  });

  it('puts a read that is not at i before a write that is not, when both are wrong', () => {
    const stride = face('stride', {
      arrays: [write('out', { atI: false, first: { text: 'out[2 * i]', line: 4 } }), read('x')],
    });
    const p = plan([call(stride, [t, a]), call(blur, [out, t])]);
    expect(p.why[1]).toBe(
      'stride and blur run as two dispatches because blur reads `t[i - 1]` (line 9)',
    );
  });

  it('accepts a read that is not at i of an array no call in the group wrote', () => {
    // `blur` reads `t[i - 1]`, but nothing before it wrote `t`; `blur` is only second in line.
    expect(plan([call(add, [u, a, b]), call(blur, [out, t])]).names).toEqual([['add', 'blur']]);
  });

  it('holds the new call to EVERY call of the group, not to the last one', () => {
    // `blur` shares no array with `mul`, the last call, but reads what `add`, the first, wrote.
    const p = plan([call(add, [t, a, b]), call(mul, [u, a, c]), call(blur, [out, t])]);
    expect(p.names).toEqual([['add', 'mul'], ['blur']]);
    expect(p.why[1]).toBe(
      'add and blur run as two dispatches because blur reads `t[i - 1]` (line 9)',
    );
  });

  it('lets a call read at i an array that a call of the group wrote at i', () => {
    expect(plan([call(add, [t, a, b]), call(relu, [out, t])]).names).toEqual([['add', 'relu']]);
  });
});

describe('F4: no array a call writes is one a call in the group reads or writes', () => {
  it('refuses a write to an array a call of the group reads', () => {
    // `relu` writes `a`, which `add` read.
    const p = plan([call(add, [t, a, b]), call(relu, [a, c])]);
    expect(p.names).toEqual([['add'], ['relu']]);
    expect(p.why[1]).toBe(
      'add and relu run as two dispatches because relu writes an array add reads',
    );
  });

  it('refuses a write to an array a call of the group wrote', () => {
    const p = plan([call(add, [t, a, b]), call(mul, [t, a, c])]);
    expect(p.why[1]).toBe(
      'add and mul run as two dispatches because mul writes an array add also writes',
    );
  });

  it('refuses an in-place call that reads and writes an array another wrote', () => {
    const bump = face('bump', { arrays: [{ param: 'xs', access: 'readwrite', atI: true }] });
    const p = plan([call(add, [t, a, b]), call(bump, [t])]);
    expect(p.names).toEqual([['add'], ['bump']]);
    expect(p.why[1]).toBe(
      'add and bump run as two dispatches because bump writes an array add also writes',
    );
  });

  it('holds the new call to every call of the group', () => {
    // `add` reads `a`; `mul`, the last call, does not; `relu` writes `a`.
    const p = plan([call(add, [t, a, b]), call(mul, [u, b, c]), call(relu, [a, v])]);
    expect(p.names).toEqual([['add', 'mul'], ['relu']]);
    expect(p.why[1]).toBe(
      'add and relu run as two dispatches because relu writes an array add reads',
    );
  });

  it('does not count an array a call only measures as one it reads', () => {
    // `size` has the array as a parameter and names only its length: no fact of its loop.
    const size = face('size', { arrays: [write('out')] });
    const measures: KernelFace = {
      ...face('measures', { arrays: [write('out')] }),
      params: [
        { name: 'out', k: 'array', layout: f32s, writes: true, s: 'array<f32>' },
        { name: 'n', k: 'array', layout: f32s, writes: false, s: 'array<f32>' },
      ],
    };
    // `n` is bound, not in `arrays`: it has no read or write, so `size` may write it afterwards.
    const p = plan([call(measures, [t, a]), call(size, [a])]);
    expect(p.names).toEqual([['measures', 'size']]);
  });

  it('refuses one array as two types, since the fused module binds it once', () => {
    const wide = face('wide', {
      arrays: [write('out', { s: 'array<vec2<f32>>' }), read('x', { s: 'array<vec2<f32>>' })],
    });
    // `t` is `array<f32>` to `add` and `array<vec2<f32>>` to `wide`: the same bytes, two types.
    const p = plan([call(add, [t, a, b]), call(wide, [out, t])]);
    expect(p.names).toEqual([['add'], ['wide']]);
    expect(p.why[1]).toBe(
      'add and wide run as two dispatches because they see one array as array<f32> in add and array<vec2<f32>> in wide',
    );
    // Two arrays that are not one are no conflict.
    expect(plan([call(add, [t, a, b]), call(wide, [out, u])]).names).toEqual([['add', 'wide']]);
  });
});

describe('F5: the distinct arrays of the group fit the storage buffers of a dispatch', () => {
  it('counts each distinct array once, and the device limit is 8 by default', () => {
    // add: t a b (3). mul: u t c (adds u, c). relu: out u (adds out). 6 distinct arrays.
    const calls = [call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])];
    expect(plan(calls, 6).names).toEqual([['add', 'mul', 'relu']]);
    expect(DEFAULT_STORAGE_BUFFERS).toBe(8);
  });

  it('starts a group where the next call would bind one buffer too many', () => {
    const calls = [call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])];
    const p = plan(calls, 5);
    expect(p.names).toEqual([['add', 'mul'], ['relu']]);
    expect(p.why).toEqual([
      undefined,
      'mul and relu run as two dispatches because one dispatch would bind 6 storage buffers, and the device allows 5',
    ]);
  });

  it('counts the arrays a call binds and does not touch', () => {
    // `add` binds t, a and b. `plain` binds u and t: four arrays, which the limit of 4 allows.
    const plain = face('plain', { arrays: [write('out'), read('x')] });
    expect(plan([call(add, [t, a, b]), call(plain, [u, t])], 4).names).toEqual([['add', 'plain']]);
    // One more parameter, an array it never reads, is bound all the same: five arrays.
    const bound: KernelFace = {
      ...plain,
      params: [
        ...plain.params,
        { name: 'y', k: 'array', layout: f32s, writes: false, s: 'array<f32>' },
      ],
    };
    const p = plan([call(add, [t, a, b]), call(bound, [u, t, c])], 4);
    expect(p.names).toEqual([['add'], ['plain']]);
    expect(p.why[1]).toBe(
      'add and plain run as two dispatches because one dispatch would bind 5 storage buffers, and the device allows 4',
    );
  });

  it('splits a long chain at the limit, and the next group counts from its own first call', () => {
    const chain = [
      call(add, [t, a, b]),
      call(mul, [u, t, c]),
      call(relu, [v, u]),
      call(relu, [w, v]),
    ];
    const p = plan(chain, 5);
    expect(p.names).toEqual([
      ['add', 'mul'],
      ['relu', 'relu'],
    ]);
  });
});

describe('F5 and a scratch array the entry holds as a local', () => {
  // add: t a b. mul: u t c. relu: out u. Six distinct arrays; `t` and `u` are scratch.
  const chain = () => [call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])];

  it('counts no contracted scratch array: six arrays bind four buffers', () => {
    expect(plan(chain(), 4, [t, u]).names).toEqual([['add', 'mul', 'relu']]);
    // The same calls with no scratch array bind six, and a limit of five splits them.
    const apart = plan(chain(), 5);
    expect(apart.names).toEqual([['add', 'mul'], ['relu']]);
    expect(apart.why[1]).toBe(
      'mul and relu run as two dispatches because one dispatch would bind 6 storage buffers, and the device allows 5',
    );
  });

  it('counts a scratch array as a buffer until the last call that names it is in the group', () => {
    // With a limit of 3, `mul` cannot join `add`: `t` is a buffer there, as `relu` has not come,
    // and the dispatch binds a, b, u and c. In the group of `mul`, `u` is a local once `relu`
    // is in, and the dispatch binds t, c and out.
    const p = plan(chain(), 3, [t, u]);
    expect(p.names).toEqual([['add'], ['mul', 'relu']]);
    expect(p.why).toEqual([
      undefined,
      'add and mul run as two dispatches because one dispatch would bind 4 storage buffers, and the device allows 3',
    ]);
    expect(p.contracted).toEqual([[], ['u']]);
  });

  it('says in the reason how many buffers the dispatch binds, not how many arrays it reaches', () => {
    // Five arrays are reached when `mul` joins `add`, and `t` is a local: four are bound.
    const p = plan(chain(), 3, [t]);
    expect(p.why[1]).toBe(
      'add and mul run as two dispatches because one dispatch would bind 4 storage buffers, and the device allows 3',
    );
  });

  it('counts an array that is not scratch, whatever the facts', () => {
    // `resident()` arrays are never contracted: the host may read them after the scope.
    const p = plan(chain(), 4, []);
    expect(p.names).toEqual([['add'], ['mul', 'relu']]);
    expect(p.contracted).toEqual([[], []]);
  });
});

describe('a scratch array the entry holds as a local', () => {
  it('is contracted when every call that names it is in the group', () => {
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])], 8, [t, u]);
    expect(p.names).toEqual([['add', 'mul', 'relu']]);
    expect(p.contracted).toEqual([['t', 'u']]);
  });

  it('is contracted when the group is the pair that writes and reads it', () => {
    const p = plan([call(add, [t, a, b]), call(relu, [out, t])], 8, [t]);
    expect(p.contracted).toEqual([['t']]);
  });

  it('is contracted when several calls read it', () => {
    // t is read by `mul` and by the second `add`.
    const p = plan(
      [call(add, [t, a, b]), call(mul, [u, t, c]), call(add, [v, t, u]), call(relu, [out, v])],
      8,
      [t, u, v],
    );
    expect(p.names).toEqual([['add', 'mul', 'add', 'relu']]);
    expect(p.contracted).toEqual([['t', 'u', 'v']]);
  });

  it('is contracted when a call updates it in place', () => {
    const bump = face('bump', { arrays: [{ param: 'xs', access: 'readwrite', atI: true }] });
    const p = plan([call(bump, [t]), call(relu, [out, t])], 8, [t]);
    expect(p.names).toEqual([['bump', 'relu']]);
    expect(p.contracted).toEqual([['t']]);
  });

  it('is never contracted when it is not scratch', () => {
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c]), call(relu, [out, u])]);
    expect(p.names).toEqual([['add', 'mul', 'relu']]);
    expect(p.contracted).toEqual([[]]);
  });

  it('stays a buffer when a call of a later group names it', () => {
    // `blur` reads `u[i - 1]`, so it starts a group, and `u` is its input: `u` is real in the
    // group of `mul`, and `t` is a local there.
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c]), call(blur, [out, u])], 8, [t, u]);
    expect(p.names).toEqual([['add', 'mul'], ['blur']]);
    expect(p.contracted).toEqual([['t'], []]);
  });

  it('stays a buffer when a call of an earlier group names it', () => {
    // `total` reduces and ends the group before it; `relu` runs in the next, and reads `t`.
    const p = plan([call(add, [t, a, b]), call(total, [t]), call(relu, [out, t])], 8, [t]);
    expect(p.names).toEqual([['add'], ['total'], ['relu']]);
    expect(p.contracted).toEqual([[], [], []]);
  });

  it('stays a buffer when a call of the group names it without an index', () => {
    const lenscale = face('lenscale', {
      arrays: [write('out'), read('x')],
      loop: { bare: [{ param: 'x', first: { text: 'x.length', line: 5 } }] },
    });
    // The calls still fuse: the array is real in the entry, and the planner counts it.
    const p = plan([call(add, [t, a, b]), call(lenscale, [out, t])], 8, [t]);
    expect(p.names).toEqual([['add', 'lenscale']]);
    expect(p.contracted).toEqual([[]]);
    // The call that writes it may name it too.
    const sized = face('sized', {
      arrays: [write('out')],
      loop: { bare: [{ param: 'out', first: { text: 'out.length' } }] },
    });
    expect(plan([call(sized, [t]), call(relu, [out, t])], 8, [t]).contracted).toEqual([[]]);
  });

  it('stays a buffer when a call only measures it', () => {
    // `measure` has the array as a parameter and no element fact of it, only the bare one.
    const measure = face('measure', {
      arrays: [write('out')],
      loop: { bare: [{ param: 'shape', first: { text: 'shape.length' } }] },
    });
    const withShape: KernelFace = {
      ...measure,
      params: [
        ...measure.params,
        { name: 'shape', k: 'array', layout: f32s, writes: false, s: 'array<f32>' },
      ],
    };
    const p = plan([call(add, [t, a, b]), call(withShape, [out, t])], 8, [t]);
    expect(p.names).toEqual([['add', 'measure']]);
    expect(p.contracted).toEqual([[]]);
  });

  it('stays a buffer when no call of the group writes it', () => {
    // It holds zeros the whole plan, and the plan makes it a zeroed buffer.
    const p = plan([call(add, [t, a, b]), call(mul, [u, t, c])], 8, [c]);
    expect(p.names).toEqual([['add', 'mul']]);
    expect(p.contracted).toEqual([[]]);
  });

  it('stays a buffer when an access is not at i', () => {
    // A write at `out[2 * i]` read at `i`: the planner refuses to fuse the pair, so no group holds
    // both, and neither group may hold `t`.
    const stride = face('stride', {
      arrays: [write('out', { atI: false, first: { text: 'out[2 * i]', line: 4 } }), read('x')],
    });
    const p = plan([call(stride, [t, a]), call(relu, [out, t])], 8, [t]);
    expect(p.names).toEqual([['stride'], ['relu']]);
    expect(p.contracted).toEqual([[], []]);
  });

  it('is held by no call that runs apart on WebGL2 or the CPU tier', () => {
    const p = plan(
      [call(add, [t, a, b], { tier: 'webgl2' }), call(relu, [out, t], { tier: 'webgl2' })],
      8,
      [t],
    );
    expect(p.fused).toEqual([false, false]);
    expect(p.contracted).toEqual([[], []]);
  });

  it('names no array for a group of one call', () => {
    const p = plan([call(add, [t, a, b])], 8, [t]);
    expect(p.contracted).toEqual([[]]);
  });

  it('is decided for each group on its own: two scratch arrays, two groups', () => {
    // `t` is private to the first group, `v` to the second.
    const p = plan(
      [
        call(add, [t, a, b]),
        call(relu, [u, t]),
        call(total, [u]),
        call(add, [v, a, b]),
        call(relu, [out, v]),
      ],
      8,
      [t, v],
    );
    expect(p.names).toEqual([['add', 'relu'], ['total'], ['add', 'relu']]);
    expect(p.contracted).toEqual([['t'], [], ['v']]);
  });
});

describe('the tier', () => {
  it('runs the calls of WebGL2 apart, and says so of each group after the first', () => {
    const p = plan([
      call(add, [t, a, b], { tier: 'webgl2' }),
      call(mul, [u, t, c], { tier: 'webgl2' }),
      call(relu, [out, u], { tier: 'webgl2' }),
    ]);
    expect(p.names).toEqual([['add'], ['mul'], ['relu']]);
    expect(p.why).toEqual([undefined, WEBGL2_APART, WEBGL2_APART]);
    expect(WEBGL2_APART).toBe('WebGL2 runs the calls apart');
  });

  it('never fuses on the CPU tier, and says nothing of it', () => {
    const p = plan([
      call(add, [t, a, b], { tier: 'cpu' }),
      call(mul, [u, t, c], { tier: 'cpu' }),
      call(relu, [out, u], { tier: 'cpu' }),
    ]);
    expect(p.names).toEqual([['add'], ['mul'], ['relu']]);
    expect(p.fused).toEqual([false, false, false]);
    expect(p.why).toEqual([undefined, undefined, undefined]);
  });

  it('fuses the calls on WebGPU and leaves the ones on another tier where they are', () => {
    const p = plan([
      call(add, [t, a, b]),
      call(mul, [u, t, c]),
      call(relu, [v, u], { tier: 'webgl2' }),
      call(relu, [w, a]),
      call(mul, [out, w, b]),
    ]);
    expect(p.names).toEqual([['add', 'mul'], ['relu'], ['relu', 'mul']]);
    expect(p.why[1]).toBe(WEBGL2_APART);
    // The call after the one on WebGL2 is on WebGPU: it cannot join, and the reason names the call.
    expect(p.why[2]).toBe('relu runs apart from relu, which runs on WebGL2');
  });
});

describe('the report of a plan in the author words', () => {
  it('words the example of the proposal as one line', () => {
    const p = plan([call(mul, [t, a, b]), call(blur, [out, t])]);
    expect(p.why[1]).toBe(
      'mul and blur run as two dispatches because blur reads `t[i - 1]` (line 9)',
    );
  });

  it('breaks a long chain at each refusal and starts the next group there', () => {
    const p = plan([
      call(add, [t, a, b]),
      call(mul, [u, t, c]),
      call(blur, [v, u]),
      call(relu, [w, v]),
      call(relu, [out, w]),
    ]);
    expect(p.names).toEqual([
      ['add', 'mul'],
      ['blur', 'relu', 'relu'],
    ]);
    expect(p.fused).toEqual([true, true]);
    expect(p.why).toEqual([
      undefined,
      'mul and blur run as two dispatches because blur reads `t[i - 1]` (line 9)',
    ]);
  });
});

describe('the slots of a group', () => {
  it('gives each distinct array one slot, in the order the calls reach them', () => {
    const { slots, arrays } = assignSlots([
      call(add, [t, a, b]),
      call(mul, [u, t, a]),
      call(relu, [out, u]),
    ]);
    // add: out=t:0 a:1 b:2. mul: out=u:3, a=t:0, b=a:1. relu: out:4, x=u:3.
    expect(slots).toEqual([
      [0, 1, 2],
      [3, 0, 1],
      [4, 3],
    ]);
    expect(arrays).toEqual([t, a, b, u, out]);
  });

  it('leaves a value parameter without a slot', () => {
    const scale = face('scale', { arrays: [write('out'), read('x')], values: ['k'] });
    const { slots } = assignSlots([call(scale, [t, a])]);
    expect(slots).toEqual([[0, 1, undefined]]);
  });
});
