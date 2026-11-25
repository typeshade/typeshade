// Verifies: Rule 7.9
import { describe, expect, it } from 'vitest';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { mapChildren } from '../../core/ir/visit.js';
import type { Expr } from '../../core/ir/nodes.js';
import { f32T, boolT } from '../../core/ir/types.js';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import ts from 'typescript';
import type { ModuleDecl, Stmt } from '../../core/ir/nodes.js';
import { cloneIr } from './context.js';
import { sequenceEffects } from './sequence.js';
import { isOrderedSelect, markOrderedSelect } from './sequence/ordered-select.js';

const RNG = `"use typeshade";
class Rng {
  state: u32;
  constructor(seed: u32) {
    this.state = seed;
  }
  bits(): u32 {
    this.state = this.state * 747796405 + 2891336453;
    return this.state >> 8;
  }
  next(): f32 {
    return f32(this.bits()) / 16777216.;
  }
}
`;

const draws = (seed: number, n: number): number[] => {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
    out.push((s >>> 8) / 16777216);
  }
  return out;
};

const fragment = (body: string, extra = ''): string =>
  `${RNG}${extra}@fragment export function fs(uv: location<0, vec2>): vec4 {\n  let rng = new Rng(u32(uv.x * 1000.))\n${body}\n}\n`;

function agree(src: string, args: readonly unknown[]): unknown {
  const r = bothTake(src).result;
  const oracle = r.eval('fs', args);
  expect(compileModuleJs(r.module).fns['fs']!(...(args as never[]))).toEqual(oracle);
  const s = startDebugSession(r.module, 'fs', args as never[]);
  s.continue();
  expect(s.result).toEqual(oracle);
  return oracle;
}

const near = (got: unknown, want: readonly number[]): void => {
  const g = got as number[];
  expect(g).toHaveLength(want.length);
  want.forEach((w, i) => expect(g[i]).toBeCloseTo(w, 6));
};

const A = fragment(
  '  const m = vec2(uv.y) > vec2(0.5)\n  const v = select(vec2(rng.next(), 0.), vec2(rng.next(), 1.), m)\n  return vec4(v.x, v.y, 0., 1.)',
);
const B = fragment(
  '  const v = select(rng.next(), rng.next(), uv.y > 0.5)\n  return vec4(v, 0., 0., 1.)',
);
const C = fragment(
  '  const v = select(rng.next(), 5., rng.next() > 2.)\n  return vec4(v, 0., 0., 1.)',
);
const D2 = fragment(
  '  const x = select(rng.next(), 5., uv.y > 0.5)\n  return vec4(x, rng.next(), 0., 1.)',
);
const PURE = fragment('  const hit = uv.y > 0.5\n  return vec4(select(0., 1., hit), 0., 0., 1.)');
const FOR_UPDATE = fragment(
  '  let s = 0.\n  for (let i = 0; i < 3; i++, s = select(rng.next(), rng.next(), uv.y > 0.5)) {\n    s += 0.\n  }\n  return vec4(s, 0., 0., 1.)',
);
const PROGRAMS = { A, B, C, D2, PURE, FOR_UPDATE };

const [a, b] = draws(500, 2);

describe('an explicit select evaluates f, t, c in the order written', () => {
  it('A: a vector condition, f then t then c', () => {
    near(agree(A, [[0.5, 0.25]]), [a!, 0, 0, 1]);
    near(agree(A, [[0.5, 0.75]]), [b!, 1, 0, 1]);
  });

  it('B: both arms run, two calls in each target', () => {
    const r = bothTake(B).result;
    expect(r.wgsl!.match(/Rng_next\(&rng\)/g)).toHaveLength(2);
    expect(r.glsl!.fragment.match(/Rng_next\(rng\)/g)).toHaveLength(2);
    near(agree(B, [[0.5, 0.25]]), [a!, 0, 0, 1]);
    near(agree(B, [[0.5, 0.75]]), [b!, 0, 0, 1]);
  });

  it('C: the condition runs last', () => {
    near(agree(C, [[0.5, 0.25]]), [a!, 0, 0, 1]);
  });

  it('D2: the first arm runs whichever value the condition picks', () => {
    near(agree(D2, [[0.5, 0.75]]), [5, b!, 0, 1]);
    near(agree(D2, [[0.5, 0.25]]), [a!, b!, 0, 1]);
  });
});

describe('what stays as it is', () => {
  it('an arm of ?: runs only when it is chosen', () => {
    const src = fragment(
      '  const x = uv.y > 0.5 ? rng.next() : 0.\n  return vec4(x, rng.next(), 0., 1.)',
    );
    const r = bothTake(src).result;
    expect(r.wgsl).toContain(
      '  var _seq0: f32;\n  if ((uv.y > 0.5)) {\n    _seq0 = Rng_next(&rng);\n  } else {\n    _seq0 = 0.0;\n  }\n  let x = _seq0;',
    );
    expect(r.wgsl).not.toContain('select(');
    near(agree(src, [[0.5, 0.75]]), [a!, b!, 0, 1]);
    near(agree(src, [[0.5, 0.25]]), [0, a!, 0, 1]);
  });

  it('a select of pure arguments compiles to the text of today', () => {
    const r = bothTake(PURE).result;
    expect(r.wgsl).toContain(
      '  let hit = (uv.y > 0.5);\n  return vec4<f32>(select(0.0, 1.0, hit), 0.0, 0.0, 1.0);',
    );
    expect(r.glsl!.fragment).toContain(
      '  bool hit = (uv.y > 0.5);\n  _ret = vec4(mix(0.0, 1.0, hit), 0.0, 0.0, 1.0);',
    );
  });

  it('?? with a call that writes in the right operand stays an if', () => {
    const src = fragment(
      '  const v = opt(uv.y) ?? rng.next()\n  return vec4(v, rng.next(), 0., 1.)',
      'function opt(k: f32): f32 | undefined { if (k < 0.5) { return undefined; } return k; }\n',
    );
    const r = bothTake(src).result;
    expect(r.wgsl).toContain(
      '  var _seq0: f32;\n  if (_opt.present) {\n    _seq0 = _opt.value;\n  } else {\n    _seq0 = Rng_next(&rng);\n  }\n  let v = _seq0;',
    );
    near(agree(src, [[0.5, 0.75]]), [0.75, a!, 0, 1]);
    near(agree(src, [[0.5, 0.25]]), [a!, b!, 0, 1]);
  });

  it('??= with a call that writes stays under an if on both targets', () => {
    const src = fragment(
      '  let v = opt(uv.y)\n  v ??= rng.next()\n  return vec4(v ?? 0., 0., 0., 1.)',
      'function opt(k: f32): f32 | undefined { if (k < 0.5) { return undefined; } return k; }\n',
    );
    const r = bothTake(src).result;
    expect(r.wgsl).toContain('  if ((v.present == false)) {\n    let _seq0 = Rng_next(&rng);');
    expect(r.glsl!.fragment).toContain(
      '  if ((v.present == false)) {\n    float _seq0 = Rng_next(rng);',
    );
    near(agree(src, [[0.5, 0.75]]), [0.75, 0, 0, 1]);
    near(agree(src, [[0.5, 0.25]]), [a!, 0, 0, 1]);
  });

  it('a select stays refused as a statement and as the right side of _ =', () => {
    bothRefuse(
      fragment(
        '  const c = uv.y > 0.5\n  select(rng.next(), rng.next(), c)\n  return vec4(0., 0., 0., 1.)',
      ),
      'TS8099',
      '"select(rng.next(), rng.next(), c)" builds a value and drops it. Only a function call may stand alone as a statement; assign the value or remove the line.',
    );
    bothRefuse(
      fragment(
        '  const c = uv.y > 0.5\n  _ = select(rng.next(), rng.next(), c)\n  return vec4(0., 0., 0., 1.)',
      ),
      'TS8099',
      '"_ = ..." drops the result of a call. "select(rng.next(), rng.next(), c)" is not one, so there is nothing to drop; remove the line.',
    );
  });
});

const markedSelects = (root: unknown): number => {
  const seen = new Set<unknown>();
  const walk = (node: unknown): number => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return 0;
    seen.add(node);
    const marked = Object.prototype.hasOwnProperty.call(node, '__orderedSelect');
    let n = marked ? 1 : 0;
    for (const v of Object.values(node)) n += walk(v);
    return n;
  };
  return walk(root);
};

describe('no ordered marker survives sequencing', () => {
  for (const [name, src] of Object.entries(PROGRAMS)) {
    it(`${name}: the IR holds no marked select`, () => {
      const r = bothTake(src).result;
      expect(r.module.funcs.length).toBeGreaterThan(0);
      expect(markedSelects(r.module)).toBe(0);
    });
  }
});

describe('a select in the update of a for loop', () => {
  const d = draws(500, 6);

  it('runs f then t on every update, whichever value c picks', () => {
    near(agree(FOR_UPDATE, [[0.5, 0.25]]), [d[4]!, 0, 0, 1]);
    near(agree(FOR_UPDATE, [[0.5, 0.75]]), [d[5]!, 0, 0, 1]);
    expect(bothTake(FOR_UPDATE).result.wgsl).not.toContain('} else {\n    _seq0 = Rng_next');
  });
});

describe('the ordered marker of a select', () => {
  const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
  const picked: Expr = markOrderedSelect({
    op: 'select',
    type: f32T,
    cond: { op: 'lit', type: boolT, value: true },
    ifTrue: lit(1),
    ifFalse: lit(0),
  });

  it('is found by the walker of this file, so a zero count means no marker', () => {
    expect(markedSelects({ body: [picked] })).toBe(1);
    expect(markedSelects({ body: [{ ...picked, ifTrue: lit(2) }] })).toBe(1);
  });

  it('survives an object spread and the child map of the IR visitors', () => {
    expect(isOrderedSelect({ ...picked })).toBe(true);
    expect(isOrderedSelect(mapChildren(picked, (c) => c))).toBe(true);
  });

  it('survives the deep copy the front end makes of a statement', () => {
    expect(isOrderedSelect(cloneIr(picked))).toBe(true);
  });

  it('is not carried by an unmarked select', () => {
    const plain: Expr = {
      op: 'select',
      type: f32T,
      cond: { op: 'lit', type: boolT, value: true },
      ifTrue: lit(1),
      ifFalse: lit(0),
    };
    expect(isOrderedSelect(plain)).toBe(false);
    expect(markedSelects({ body: [plain] })).toBe(0);
  });
});

describe('a select with a vector condition and no marker', () => {
  it('never becomes an if on its condition, and its call is bound ahead', () => {
    const f32v2 = { kind: 'vec', n: 2, elem: 'f32' } as const;
    const boolv2 = { kind: 'vec', n: 2, elem: 'bool' } as const;
    const writes = {
      op: 'call',
      type: f32T,
      fn: 'atomicAdd',
      args: [
        { op: 'varref', type: f32T, name: 'g' },
        { op: 'lit', type: f32T, value: 1 },
      ],
    };
    const arm = (e: unknown): unknown => ({ op: 'construct', type: f32v2, args: [e, e] });
    const pick = {
      op: 'select',
      type: f32v2,
      cond: { op: 'varref', type: boolv2, name: 'm' },
      ifTrue: arm({ op: 'lit', type: f32T, value: 0 }),
      ifFalse: arm(writes),
    };
    const m = {
      funcs: [{ name: 'f', params: [], body: [{ s: 'let', name: 'x', type: f32v2, expr: pick }] }],
      consts: [],
      bindings: [],
      structs: [],
    } as unknown as ModuleDecl;
    sequenceEffects(m, ts.createSourceFile('a.ts', '', ts.ScriptTarget.Latest), []);
    const body: readonly Stmt[] = m.funcs[0]!.body;
    expect(body.some((s) => s.s === 'if')).toBe(false);
    expect(body[0]!.s).toBe('let');
    expect(body).toHaveLength(2);
  });
});

describe('the editor says what select does', () => {
  it('the hover on select says all arguments are evaluated, in that order', () => {
    const hover = bothTake(B).hover('select');
    expect(hover).toContain('all evaluated, in that order');
    expect(hover).toContain('Write `cond ? trueValue : falseValue` to evaluate one arm.');
  });
});
