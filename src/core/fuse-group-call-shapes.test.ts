import { describe, expect, it } from 'vitest';
import { groupCalls, onLaterTier, type GroupCall } from './fuse-group.js';
import type { FuseArray, FuseLoop, KernelFace, KernelParam } from './host-kernel.js';
import type { Tier } from './tiers.js';

const f32s = { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } } as const;

const arrayParam = (name: string, writes: boolean): KernelParam => ({
  name,
  k: 'array',
  layout: f32s,
  writes,
  s: 'array<f32>',
});

const loopOf = (arrays: readonly FuseArray[], more: Partial<FuseLoop> = {}): FuseLoop => ({
  entry: 'k_loop0',
  wg: 64,
  arrays,
  reduces: false,
  scatters: false,
  continues: false,
  iterates: 'k_loop0',
  iteration: 2,
  ...more,
});

function faceOf(
  name: string,
  params: readonly KernelParam[],
  loop: FuseLoop,
  options: { readonly loops?: 'none' | 'one'; readonly gpu?: false } = {},
): KernelFace {
  const base = { name, fn: name, params, result: { k: 'void', s: 'void' } } as const;
  const fuse = { origin: 'ops.shade.ts', facts: [loop], ir: { version: '0', module: {} } };
  if (options.gpu === false) return { ...base, noGpu: 'it runs on the CPU, test', fuse };
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
      loops:
        options.loops === 'none'
          ? []
          : [
              {
                entry: loop.entry,
                range: `${name}__range0`,
                cop: '<',
                step: 1,
                writes: [],
                checks: [],
                wg: loop.wg,
              },
            ],
    },
    fuse,
  };
}

const at = (param: string, access: FuseArray['access'], more: Partial<FuseArray> = {}) => ({
  param,
  access,
  atI: true,
  ...more,
});

const call = (
  k: KernelFace,
  arrays: readonly object[],
  range: GroupCall['range'] | 'none' = { start: 0, n: 100 },
  tier: Tier = 'webgpu',
): GroupCall => {
  let next = 0;
  return {
    k,
    arrays: k.params.map((p) => (p.k === 'array' ? arrays[next++] : undefined)),
    range: range === 'none' ? undefined : range,
    tier,
  };
};

const [t, u, v] = [{ id: 't' }, { id: 'u' }, { id: 'v' }];

const producer = faceOf('produce', [arrayParam('out', true)], loopOf([at('out', 'write')]));

const reader = (name: string, atI: boolean) =>
  faceOf(
    name,
    [arrayParam('dst', true), arrayParam('x', false)],
    loopOf([
      at('dst', 'write'),
      at('x', 'read', { atI, ...(atI ? {} : { first: { text: 'x[i - 1]', line: 4 } }) }),
    ]),
  );

describe('a call that takes a Map or a Set', () => {
  it('stands apart, in the words of the fact', () => {
    const base = faceOf('count', [arrayParam('out', true)], loopOf([at('out', 'write')]));
    const withSet: KernelFace = {
      ...base,
      params: [
        ...base.params,
        { name: 's', k: 'collection', key: 'u32', writes: false, s: 'Set<u32>' },
      ],
    };
    const groups = groupCalls([call(producer, [u]), call(withSet, [t, {}])], 8);
    expect(groups.map((g) => g.why)).toEqual([
      undefined,
      'produce and count run as two dispatches because count takes a Map or a Set',
    ]);
  });
});

describe('one array as two parameters of one call', () => {
  const twice = (first: FuseArray, second: FuseArray) =>
    faceOf(
      'twice',
      [arrayParam('p', first.access !== 'read'), arrayParam('q', second.access !== 'read')],
      loopOf([first, second]),
    );
  const whyOf = (k: KernelFace, next: KernelFace) =>
    groupCalls([call(k, [t, t]), call(next, [v, t])], 8).map((g) => g.why)[1];

  it('writes it when either parameter writes it', () => {
    const k = twice(at('p', 'read'), at('q', 'write'));
    const next = reader('next', false);
    expect(whyOf(k, next)).toBe(
      'twice and next run as two dispatches because next reads `x[i - 1]` (line 4)',
    );
  });

  it('reads it when either parameter reads it, in either order of the parameters', () => {
    const [readsFirst, readsSecond] = [
      faceOf('twice', [arrayParam('p', false), arrayParam('q', false)], loopOf([at('p', 'read')])),
      faceOf('twice', [arrayParam('p', false), arrayParam('q', false)], loopOf([at('q', 'read')])),
    ];
    for (const k of [readsFirst, readsSecond])
      expect(groupCalls([call(k, [t, t]), call(producer, [t])], 8).map((g) => g.why)[1]).toBe(
        'twice and produce run as two dispatches because produce writes an array twice reads',
      );
  });

  it('is named without an index when either parameter is', () => {
    const k = faceOf(
      'twice',
      [arrayParam('p', true), arrayParam('q', false)],
      loopOf([at('p', 'write'), at('q', 'read')], {
        bare: [{ param: 'q', first: { text: 'q.length' } }],
      }),
    );
    const groups = groupCalls(
      [call(k, [t, t]), call(reader('next', true), [v, t])],
      8,
      new Set([t]),
    );
    expect(groups.map((g) => g.calls)).toEqual([[0, 1]]);
    expect(groups[0]!.contracted).toEqual([]);
  });

  it('is at the counter only when both parameters are', () => {
    const k = twice(
      at('p', 'write'),
      at('q', 'write', { atI: false, first: { text: 't[i + 1]', line: 7 } }),
    );
    const next = reader('next', true);
    expect(whyOf(k, next)).toBe(
      'twice and next run as two dispatches because twice writes `t[i + 1]` (line 7)',
    );
  });
});

describe('a function with no loop', () => {
  const noLoop = faceOf('setup', [arrayParam('out', true)], loopOf([at('out', 'write')]), {
    loops: 'none',
  });

  it('is not a function that runs on the CPU, which says nothing on the CPU tier', () => {
    const groups = groupCalls([call(producer, [u]), call(noLoop, [t], 'none', 'cpu')], 8);
    expect(groups.map((g) => g.why)).toEqual([undefined, undefined]);
  });

  it('has no range, and stands apart with the reason of a function that runs on the CPU', () => {
    const groups = groupCalls([call(producer, [u]), call(noLoop, [t], 'none')], 8);
    expect(groups.map((g) => g.why)).toEqual([
      undefined,
      'produce and setup run as two dispatches because setup runs on the CPU, unknown',
    ]);
  });

  it('steps by one, as the group does', () => {
    const groups = groupCalls([call(producer, [u]), call(noLoop, [t])], 8);
    expect(groups.map((g) => g.calls)).toEqual([[0, 1]]);
  });
});

describe('a function that declares its size and runs on the CPU', () => {
  it('declares none to the planner', () => {
    const k = faceOf(
      'prefix',
      [arrayParam('out', true)],
      loopOf([at('out', 'write')], { declared: true }),
      { gpu: false },
    );
    const groups = groupCalls([call(k, [t], 'none', 'cpu'), call(producer, [u])], 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
  });
});

describe('onLaterTier', () => {
  it('words the call, its tier and each earlier reason joined by a semicolon', () => {
    expect(onLaterTier('b', 'cpu', ['x', 'y'])).toBe('b runs on the CPU, x; y');
    expect(onLaterTier('b', 'webgl2', ['x'])).toBe('b runs on WebGL2, x');
  });
});
