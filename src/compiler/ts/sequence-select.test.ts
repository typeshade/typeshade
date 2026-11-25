// Verifies: Rule 7.9
import { describe, expect, it } from 'vitest';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { bothTake } from '../../core/testing/both-halves.js';

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
const PROGRAMS = { A, B, C, D2, PURE };

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
});

const markedSelects = (root: unknown): number => {
  const seen = new Set<unknown>();
  const walk = (node: unknown): number => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return 0;
    seen.add(node);
    const marked =
      !Array.isArray(node) &&
      (node as { op?: unknown }).op === 'select' &&
      Object.prototype.hasOwnProperty.call(node, 'ordered');
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

describe('the editor says what select does', () => {
  it('the hover on select says all arguments are evaluated, in that order', () => {
    expect(bothTake(B).hover('select')).toContain('all evaluated, in that order');
  });
});
