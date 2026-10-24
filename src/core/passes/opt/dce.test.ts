import { describe, it, expect } from 'vitest';
import { dce } from './index.js';
import {
  module,
  fn,
  f32,
  f32T,
  boolT,
  i32T,
  u32T,
  voidT,
  type Expr,
  type FuncDecl,
  type ShaderType,
  type Stmt,
  type ModuleDecl,
} from '../../ir/index.js';
import { emitModule } from '../../backends/wgsl.js';
import { compileModule } from '../../oracle.js';
import { fixpoint } from './optimize.js';
import { compileModuleJs } from '../../cpu-codegen.js';
import { generateModule } from '../../testing/random-ir.js';
import { drawnFunction } from '../../testing/draw-harness.js';
import { emitGlslModule } from '../../backends/glsl.js';
import { compile } from '../../../compiler/ts/compile.js';
import { eachStmtExpr } from '../../ir/visit.js';

// P2 — dead-code elimination: drop a local let/var whose name is never read.
// Scope: function-local bindings only (module bindings/varyings are IO/layout
// contracts, deferred to the resource model). A fn containing a raw Stmt is
// skipped (raw WGSL may reference a name DCE cannot see).
describe('optimize — dead-code elimination', () => {
  it('removes an unused let binding', () => {
    const m = module({
      funcs: [
        fn('k', { x: f32T }, f32T, ({ x }, b) => {
          b.let('dead', f32(99)); // never read
          b.ret(x.mul(2));
        }),
      ],
    });
    const wgsl = emitModule(dce(m));
    expect(wgsl).not.toContain('dead');
    expect(wgsl).not.toContain('99');
  });

  it('keeps a used let binding', () => {
    const m = module({
      funcs: [
        fn('k', { x: f32T }, f32T, ({ x }, b) => {
          const t = b.let('t', x.mul(2));
          b.ret(t.add(1));
        }),
      ],
    });
    expect(emitModule(dce(m))).toContain('t');
  });

  it('preserves oracle value-equality', () => {
    const m = module({
      funcs: [
        fn('k', { x: f32T }, f32T, ({ x }, b) => {
          b.let('dead', f32(99));
          b.ret(x.mul(2));
        }),
      ],
    });
    expect(compileModule(dce(m)).fns.k(5)).toBe(compileModule(m).fns.k(5));
  });

  it('skips a fn containing a raw Stmt (raw may reference the "dead" name)', () => {
    const m: ModuleDecl = module({
      funcs: [
        {
          name: 'rawfn',
          params: [],
          ret: f32T,
          body: [
            { s: 'let', name: 'maybe_used', expr: { op: 'lit', type: f32T, value: 1 } } as Stmt,
            { s: 'raw', wgsl: 'return maybe_used;' } as Stmt,
          ],
        },
      ],
    });
    // maybe_used is read only inside the raw string -> must NOT be dropped.
    expect(emitModule(dce(m))).toContain('maybe_used');
  });
});

describe('unread private scalar self-stores', () => {
  const selfStores = (type: ShaderType): Stmt[] => [
    { s: 'var', name: 'dead', type, init: lit(1, type) },
    { s: 'assignOp', target: ref('dead', type), bop: '+', expr: lit(2, type) },
    {
      s: 'assignOp',
      target: ref('dead', type),
      bop: '*',
      expr: { op: 'binop', bop: '+', type, a: ref('dead', type), b: lit(1, type) },
    },
    {
      s: 'assign',
      target: ref('dead', type),
      expr: { op: 'binop', bop: '+', type, a: ref('dead', type), b: lit(1, type) },
    },
  ];

  it('drops pure implicit and explicit self-reads without changing an independent result', () => {
    for (const type of [f32T, i32T, u32T]) {
      const m = module({
        funcs: [simpleFn('main', [...selfStores(type), { s: 'return', expr: lit(7) }])],
      });
      for (const out of [dce(m), fixpoint(m, [dce])]) {
        expect(bodyOf(out)).toEqual([{ s: 'return', expr: lit(7) }]);
        expect(compileModuleJs(out, { precision: 'f32' }).fns.main!()).toBe(
          compileModuleJs(m, { precision: 'f32' }).fns.main!(),
        );
      }
    }
    const truth: Expr = { op: 'lit', type: boolT, value: true };
    const m = module({
      funcs: [
        simpleFn('main', [
          { s: 'var', name: 'dead', type: boolT, init: truth },
          {
            s: 'assign',
            target: ref('dead', boolT),
            expr: { op: 'logical', lop: '||', type: boolT, a: ref('dead', boolT), b: truth },
          },
          { s: 'return', expr: lit(7) },
        ]),
      ],
    });
    for (const out of [dce(m), fixpoint(m, [dce])])
      expect(bodyOf(out)).toEqual([{ s: 'return', expr: lit(7) }]);
  });

  it('never erases a root collected before or after the self-store', () => {
    const compare: Expr = {
      op: 'compare',
      cop: '<',
      type: boolT,
      a: ref('dead', i32T),
      b: lit(10, i32T),
    };
    const header: Extract<Stmt, { s: 'for' }> = {
      s: 'for',
      init: { s: 'var', name: 'i', type: i32T, init: lit(0, i32T) },
      cond: compare,
      update: { s: 'assignOp', target: ref('i', i32T), bop: '+', expr: lit(1, i32T) },
      body: [],
    };
    const roots: Stmt[] = [
      { s: 'return', expr: ref('dead', i32T) },
      {
        s: 'if',
        arms: [
          { cond: compare, body: [] },
          { cond: compare, body: [] },
        ],
        elseBody: [],
      },
      { s: 'switch', scrut: ref('dead', i32T), cases: [], defaultBody: [] },
      header,
      {
        ...header,
        cond: { op: 'lit', type: boolT, value: false },
        init: { s: 'assign', target: ref('dead', i32T), expr: lit(0, i32T) },
      },
      {
        ...header,
        cond: { op: 'lit', type: boolT, value: false },
        update: { s: 'assignOp', target: ref('dead', i32T), bop: '+', expr: lit(1, i32T) },
      },
      { s: 'assign', target: ref('global', i32T), expr: ref('dead', i32T) },
      { s: 'call', expr: call('unknown', [ref('dead', i32T)], voidT) },
      {
        s: 'assign',
        target: {
          op: 'index',
          type: i32T,
          base: ref('a', { kind: 'array', elem: i32T, size: 2 }),
          idx: ref('dead', i32T),
        },
        expr: lit(1, i32T),
      },
    ];
    for (const root of roots)
      for (const before of [false, true]) {
        const stores = selfStores(i32T);
        const body = before ? [stores[0]!, root, ...stores.slice(1)] : [...stores, root];
        const m = module({ funcs: [{ ...simpleFn('main', body), ret: i32T }] });
        for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(body);
      }
  });

  it('blocks the whole candidate when any direct or compound RHS is opaque or effectful', () => {
    const effects = [
      call('unknown', [], u32T),
      call('atomicLoad', [ref('counter', { kind: 'atomic', elem: 'u32' })], u32T),
      call('workgroupUniformLoad', [ref('workgroup', u32T)], u32T),
    ];
    const leaves: FuncDecl[] = [
      { ...simpleFn('leaf', [{ s: 'return', expr: effects[1]! }]), ret: u32T },
      { ...simpleFn('leaf', [{ s: 'raw', wgsl: 'return 1u;', glsl: 'return 1u;' }]), ret: u32T },
      { ...simpleFn('leaf', [{ s: 'discard' }, { s: 'return', expr: lit(1, u32T) }]), ret: u32T },
      {
        ...simpleFn('leaf', [
          { s: 'assign', target: ref('global', u32T), expr: lit(1, u32T) },
          { s: 'return', expr: lit(1, u32T) },
        ]),
        ret: u32T,
      },
      {
        ...simpleFn(
          'leaf',
          [{ s: 'return', expr: lit(1, u32T) }],
          [{ name: 'p', type: u32T, mode: 'inout' }],
        ),
        ret: u32T,
      },
    ];
    const fixtures = effects.map((effect) => ({ effect, funcs: [] as FuncDecl[] }));
    for (const leaf of leaves)
      fixtures.push({
        effect: call('wrapper', [ref('dead', u32T)], u32T),
        funcs: [
          leaf,
          {
            ...simpleFn(
              'wrapper',
              [
                {
                  s: 'return',
                  expr: call('leaf', leaf.params.length ? [ref('p', u32T)] : [], u32T),
                },
              ],
              [
                {
                  name: 'p',
                  type: u32T,
                  ...(leaf.params.length ? { mode: 'inout' as const } : {}),
                },
              ],
            ),
            ret: u32T,
          },
        ],
      });
    for (const { effect, funcs } of fixtures)
      for (const place of ['init', 'assign', 'assignOp'] as const) {
        const stores = selfStores(u32T);
        const unsafe: Stmt =
          place === 'init'
            ? { s: 'var', name: 'dead', type: u32T, init: effect }
            : place === 'assign'
              ? { s: 'assign', target: ref('dead', u32T), expr: effect }
              : { s: 'assignOp', target: ref('dead', u32T), bop: '+', expr: effect };
        const body: Stmt[] = [
          ...(place === 'init' ? [unsafe, ...stores.slice(1)] : [...stores, unsafe]),
          { s: 'return', expr: lit(7) },
        ];
        const m = module({ funcs: [...funcs, simpleFn('main', body)] });
        for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(body);
      }
  });

  it('keeps cross-variable cycles, aggregate stores and parameter stores conservative', () => {
    const vector: ShaderType = { kind: 'vec', n: 2, elem: 'f32' };
    const body: Stmt[] = [
      { s: 'var', name: 'a', type: f32T, init: lit(1) },
      { s: 'var', name: 'b', type: f32T, init: lit(2) },
      { s: 'assignOp', target: ref('a'), bop: '+', expr: ref('b') },
      { s: 'assignOp', target: ref('b'), bop: '+', expr: ref('a') },
      { s: 'var', name: 'v', type: vector },
      {
        s: 'assignOp',
        target: { op: 'member', type: f32T, base: ref('v', vector), field: 'x' },
        bop: '+',
        expr: lit(1),
      },
      { s: 'assignOp', target: { op: 'param', type: f32T, name: 'p' }, bop: '+', expr: lit(1) },
      { s: 'return', expr: lit(7) },
    ];
    const m = module({
      funcs: [simpleFn('main', body, [{ name: 'p', type: f32T, mode: 'inout' }])],
    });
    for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(body);
  });

  it('removes seed 44 f5 private self-stores while retaining all loop headers and f32 answers', () => {
    const generated = generateModule(44, { exact: true });
    const out = fixpoint(generated.module, [dce]);
    expect(JSON.stringify(bodyOf(out, 'f5'))).not.toContain('"name":"g9"');
    const loops = (m: ModuleDecl): Extract<Stmt, { s: 'for' }>[] => {
      const found: Extract<Stmt, { s: 'for' }>[] = [];
      const scan = (s: Stmt): void => {
        if (s.s === 'for') found.push(s);
        eachStmtExpr(s, () => {}, scan);
      };
      for (const s of bodyOf(m, 'f5')) scan(s);
      return found;
    };
    const originalLoops = loops(generated.module),
      cleanedLoops = loops(out);
    expect(cleanedLoops).toHaveLength(originalLoops.length);
    for (const [i, loop] of originalLoops.entries()) {
      expect(cleanedLoops[i]!.init).toBe(loop.init);
      expect(cleanedLoops[i]!.cond).toBe(loop.cond);
      expect(cleanedLoops[i]!.update).toBe(loop.update);
    }
    const before = compileModuleJs(generated.module, { precision: 'f32' });
    const after = compileModuleJs(out, { precision: 'f32' });
    for (const vector of [
      [0.5, 1000, -1, 1],
      [-0, 0, 0.5, 3.5],
      [-1000, 0.125, 2, -0.25],
    ])
      for (const signed of [-2147483648, -1, 0, 1, 2147483647])
        for (const unsigned of [0, 1, 2147483648, 4294967295]) {
          const input = [vector, signed, unsigned];
          expect(after.fns.f5!(...structuredClone(input))).toEqual(
            before.fns.f5!(...structuredClone(input)),
          );
        }
    const glsl = emitGlslModule(drawnFunction(generated.module, 'f5', 16, 8).module, 'fragment');
    expect(glsl).toContain('vec3 f5(');
    expect(glsl).not.toMatch(/\b(?:float g9|g9\s*[+*]=)/);
  });
});

const lit = (value: number, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value });
const ref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
const call = (name: string, args: Expr[] = [], type: ShaderType = f32T): Expr => ({
  op: 'call',
  fn: name,
  args,
  type,
});
const simpleFn = (name: string, body: Stmt[], params: FuncDecl['params'] = []): FuncDecl => ({
  name,
  params,
  ret: f32T,
  body,
});
const deadStoreBody = (value: Expr): Stmt[] => [
  { s: 'var', name: 'dead', type: f32T, init: lit(1) },
  { s: 'assign', target: ref('dead'), expr: value },
  { s: 'return', expr: lit(7) },
];
const bodyOf = (m: ModuleDecl, name = 'main') => m.funcs.find((f) => f.name === name)!.body;

describe('unread scalar direct stores', () => {
  it('drops a pure store and its declaration, including pure helper calls in function views', () => {
    const m = module({
      funcs: [
        simpleFn('pure', [{ s: 'return', expr: lit(2) }]),
        simpleFn('main', deadStoreBody(call('pure'))),
      ],
    });
    for (const out of [dce(m), fixpoint(m, [dce])]) {
      expect(bodyOf(out)).toEqual([{ s: 'return', expr: lit(7) }]);
      expect(compileModuleJs(out, { precision: 'f32' }).fns.main!()).toBe(7);
    }
  });

  it('keeps unknown, raw and recursive callees, transitively and in standalone DCE', () => {
    for (const leaf of [
      simpleFn('leaf', [
        { s: 'call', expr: call('unknown', [], voidT) },
        { s: 'return', expr: lit(1) },
      ]),
      simpleFn('leaf', [{ s: 'raw', wgsl: 'return 1.;', glsl: 'return 1.;' }]),
      simpleFn('leaf', [{ s: 'return', expr: call('leaf') }]),
    ]) {
      const m = module({
        funcs: [
          leaf,
          simpleFn('wrapper', [{ s: 'return', expr: call('leaf') }]),
          simpleFn('main', deadStoreBody(call('wrapper'))),
        ],
      });
      for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(bodyOf(m));
    }
  });

  it('keeps helpers that discard, directly or transitively from nested statements and headers', () => {
    const truth: Expr = { op: 'lit', type: boolT, value: true };
    const discard: Stmt = { s: 'discard' };
    const bodies: Stmt[][] = [
      [discard],
      [
        {
          s: 'if',
          arms: [
            { cond: truth, body: [] },
            { cond: truth, body: [discard] },
          ],
          elseBody: [],
        },
      ],
      [{ s: 'if', arms: [{ cond: truth, body: [] }], elseBody: [discard] }],
      [
        {
          s: 'switch',
          scrut: lit(0, u32T),
          cases: [{ values: [0], body: [discard] }],
          defaultBody: [],
        },
      ],
      [{ s: 'switch', scrut: lit(0, u32T), cases: [], defaultBody: [discard] }],
      [
        {
          s: 'for',
          init: { s: 'var', name: 'i', type: u32T, init: lit(0, u32T) },
          cond: truth,
          update: { s: 'assign', target: ref('i', u32T), expr: lit(1, u32T) },
          body: [discard],
        },
      ],
      // The effect proof visits every IR statement slot, even conservative header shapes.
      [{ s: 'for', init: discard, cond: truth, update: discard, body: [] }],
    ];
    for (const body of bodies)
      for (const name of ['leaf', 'wrapper']) {
        const m = module({
          funcs: [
            simpleFn('leaf', [...body, { s: 'return', expr: lit(1) }]),
            simpleFn('wrapper', [{ s: 'return', expr: call('leaf') }]),
            simpleFn('main', [
              ...deadStoreBody(call(name)).slice(0, -1),
              { s: 'call', expr: call(name) },
              { s: 'return', expr: lit(7) },
            ]),
          ],
        });
        for (const out of [dce(m), fixpoint(m, [dce])]) {
          expect(bodyOf(out)).toEqual(bodyOf(m));
          expect(JSON.stringify(bodyOf(out, 'leaf'))).toContain('"s":"discard"');
        }
      }
  });

  it('keeps transitive read and synchronisation wrappers even when they write no roots', () => {
    const collection: ShaderType = { kind: 'collection', key: 'u32' };
    const operations = [
      call('atomicLoad', [ref('counter', { kind: 'atomic', elem: 'u32' })], u32T),
      call('collectionHas', [ref('set', collection), lit(1, u32T)], boolT),
      call('collectionSize', [ref('set', collection)], u32T),
      call('workgroupBarrier', [], voidT),
      call('workgroupUniformLoad', [ref('flag')]),
    ];
    for (const operation of operations) {
      const m = module({
        funcs: [
          simpleFn('leaf', [
            { s: 'call', expr: operation },
            { s: 'return', expr: lit(1) },
          ]),
          simpleFn('wrapper', [{ s: 'return', expr: call('leaf') }]),
          simpleFn('main', deadStoreBody(call('wrapper'))),
        ],
      });
      for (const out of [dce(m), fixpoint(m, [dce])]) {
        expect(bodyOf(out)).toEqual(bodyOf(m));
        expect(bodyOf(out, 'leaf')[0]).toEqual({ s: 'call', expr: operation });
      }
    }
  });

  it('keeps a real atomicLoad wrapper through the full optimizer', () => {
    const result = compile(`"use typeshade";
declare const bins: storage<array<atomic<u32>>, "read_write">;
function peek(): u32 { return atomicLoad(bins[0]); }
function wrap(): u32 { return peek(); }
@compute([1, 1, 1])
export function main(): void {
  let dead: u32 = 0;
  dead = wrap();
}
`);
    expect(result.diagnostics).toEqual([]);
    const out = fixpoint(result.module);
    expect(JSON.stringify(bodyOf(out))).toContain('wrap');
    expect(JSON.stringify(bodyOf(out, 'peek'))).toContain('atomicLoad');
  });

  it('keeps inout calls, module writes, compound stores, aggregate places and lvalue effects', () => {
    const vector: ShaderType = { kind: 'vec', n: 2, elem: 'f32' };
    const array: ShaderType = { kind: 'array', elem: f32T, size: 2 };
    const stmts: Stmt[] = [
      { s: 'var', name: 'dead', type: f32T, init: lit(1) },
      { s: 'call', expr: call('touch', [ref('dead')]) },
      { s: 'assignOp', target: ref('dead'), expr: lit(2), bop: '+' },
      { s: 'var', name: 'v', type: vector },
      {
        s: 'assign',
        target: { op: 'member', base: ref('v', vector), field: 'x', type: f32T },
        expr: lit(2),
      },
      { s: 'var', name: 'a', type: array },
      {
        s: 'assign',
        target: { op: 'index', base: ref('a', array), idx: call('index', [], u32T), type: f32T },
        expr: lit(2),
      },
      { s: 'assign', target: ref('global'), expr: lit(3) },
      { s: 'assign', target: { op: 'param', name: 'p', type: f32T }, expr: lit(4) },
      { s: 'return', expr: lit(7) },
    ];
    const m = module({
      funcs: [
        simpleFn(
          'touch',
          [{ s: 'return', expr: lit(1) }],
          [{ name: 'p', type: f32T, mode: 'inout' }],
        ),
        simpleFn('main', stmts, [{ name: 'p', type: f32T, mode: 'inout' }]),
      ],
    });
    for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(stmts);
  });

  it('keeps header references and effects in nested conditions, for init and update', () => {
    const stmts: Stmt[] = [
      { s: 'var', name: 'dead', type: f32T, init: lit(1) },
      {
        s: 'for',
        init: { s: 'assign', target: ref('dead'), expr: call('unknown') },
        cond: { op: 'lit', type: boolT, value: false },
        update: { s: 'assign', target: ref('dead'), expr: call('unknown') },
        body: [
          {
            s: 'if',
            arms: [
              {
                cond: call('unknown', [], boolT),
                body: [{ s: 'assign', target: ref('dead'), expr: lit(2) }],
              },
              { cond: call('unknown', [], boolT), body: [{ s: 'return', expr: ref('dead') }] },
            ],
          },
        ],
      },
      { s: 'return', expr: lit(7) },
    ];
    const m = module({ funcs: [simpleFn('main', stmts)] });
    for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(stmts);
  });

  it('finds opaque calls inside helper else-if, switch-default and for-header expressions', () => {
    const effect = call('atomicLoad', [ref('counter', { kind: 'atomic', elem: 'u32' })], u32T);
    const truth: Expr = { op: 'lit', type: boolT, value: true };
    const compare: Expr = { op: 'compare', cop: '==', a: effect, b: lit(0, u32T), type: boolT };
    const cases: Stmt[][] = [
      [
        {
          s: 'if',
          arms: [
            { cond: truth, body: [] },
            { cond: compare, body: [] },
          ],
          elseBody: [],
        },
      ],
      [{ s: 'switch', scrut: lit(0, u32T), cases: [], defaultBody: [{ s: 'call', expr: effect }] }],
      [
        {
          s: 'for',
          init: { s: 'var', name: 'i', type: u32T, init: effect },
          cond: truth,
          update: { s: 'assign', target: ref('i', u32T), expr: effect },
          body: [],
        },
      ],
      [
        {
          s: 'for',
          init: { s: 'raw', wgsl: 'external()', glsl: 'external()' },
          cond: truth,
          update: { s: 'call', expr: call('unknown', [], voidT) },
          body: [],
        },
      ],
    ];
    for (const body of cases) {
      const m = module({
        funcs: [
          simpleFn('leaf', [...body, { s: 'return', expr: lit(1) }]),
          simpleFn('wrapper', [{ s: 'return', expr: call('leaf') }]),
          simpleFn('main', deadStoreBody(call('wrapper'))),
        ],
      });
      for (const out of [dce(m), fixpoint(m, [dce])]) expect(bodyOf(out)).toEqual(bodyOf(m));
    }
  });

  it('removes the seed 1 f4 dead helper chain while preserving f32 oracle bits', () => {
    const generated = generateModule(1, { exact: true });
    const out = fixpoint(generated.module, [dce]);
    const before = compileModuleJs(generated.module, { precision: 'f32' });
    const after = compileModuleJs(out, { precision: 'f32' });
    for (const x of [-1000, -0.5, -0, 0, 0.5, 3.5, 1000]) {
      const input = [x, [x, 0.5, -1000]];
      expect(after.fns.f4!(...structuredClone(input))).toEqual(
        before.fns.f4!(...structuredClone(input)),
      );
    }
    const glsl = emitGlslModule(drawnFunction(generated.module, 'f4', 16, 8).module, 'fragment');
    expect(glsl).toContain('vec3 f4(');
    expect(glsl).not.toMatch(/\b(?:int f1|float f2|vec4 f3)\(/);
    expect(JSON.stringify(bodyOf(out, 'f4'))).not.toContain('"fn":"f3"');
  });
});
