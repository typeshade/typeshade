import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';
import { keepHelpers } from '../../../core/testing/keep-helpers.js';

const inFs = (body: string, pre = ''): string => `"use typeshade"
${pre}
@fragment export function fs(): vec4 {
${body}
}
`;

const signatures = (wgsl: string | undefined): string[] =>
  (wgsl ?? '')
    .split('\n')
    .filter((line) => line.startsWith('fn '))
    .map((line) => line.replace(/ \{$/, ''));

const ASYNC_REASON =
  'is async, and a shader function runs to completion in one call: there is no event loop to ' +
  'wait on. Remove "async" and each "await", and write its return type as f32.';

describe('a refused local function says its one sentence and nothing after it (Rule 12.4)', () => {
  it('a var is TS8013 once, and the call of it adds no unknown function', () => {
    bothRefuse(
      inFs('  var f = (x: f32): f32 => x * 2.;\n  return vec4(f(3.), 0., 0., 1.);'),
      'TS8013',
      '`var` is not allowed. Use `let` (mutable) or `const` (immutable).',
    );
  });

  it('an async function written as a value is TS8020 once, and a declaration is TS8013 once', () => {
    bothRefuse(
      inFs(
        '  const f = async (x: f32): Promise<f32> => x * 2.;\n  return vec4(f(3.), 0., 0., 1.);',
      ),
      'TS8020',
      `"f" ${ASYNC_REASON}`,
    );
    bothRefuse(
      inFs(
        '  async function f(x: f32): Promise<f32> { return x * 2.; }\n' +
          '  return vec4(f(3.), 0., 0., 1.);',
      ),
      'TS8013',
      `"f" ${ASYNC_REASON}`,
    );
  });

  it('a refused local function handed to an array method adds no refusal of the hand-over', () => {
    const handed = (declaration: string): string =>
      `"use typeshade"
const xs = array<f32, 2>(1., 2.);
@fragment export function fs(): vec4 {
  ${declaration}
  const m = xs.map(f);
  return vec4(m[0], 0., 0., 1.);
}
`;
    bothRefuse(
      handed('var f = (x: f32): f32 => x * 2.;'),
      'TS8013',
      '`var` is not allowed. Use `let` (mutable) or `const` (immutable).',
    );
    bothRefuse(
      handed('async function f(x: f32): Promise<f32> { return x * 2.; }'),
      'TS8013',
      `"f" ${ASYNC_REASON}`,
    );
  });

  it('a generator declaration is TS8013 once in the compiler, and the editor says it too', () => {
    const halves = bothHalves(
      inFs('  function* f(x: f32) { yield x; }\n  return vec4(f(3.), 0., 0., 1.);'),
    );
    expect(halves.compiler).toEqual([
      'typeshade TS8013: "f" is a generator, and a shader function runs to completion in one call: ' +
        'nothing suspends it at a "yield". Remove the "*" and return one value.',
    ]);
    expect(halves.editor).toContain(halves.compiler[0]);
  });

  it('a let or a typed const is TS8020 once, and the call of it adds nothing', () => {
    bothRefuse(
      inFs('  let f = (x: f32): f32 => x * 2.;\n  return vec4(f(3.), 0., 0., 1.);'),
      'TS8020',
      '"f" is a function, so it is declared with const; a "let" would let the name point at ' +
        'another one, which no shader value does.',
    );
    const typed = bothHalves(
      inFs('  const f: f32 = (x: f32): f32 => x * 2.;\n  return vec4(f(3.), 0., 0., 1.);'),
    );
    expect(typed.compiler).toEqual([
      'typeshade TS8020: "f" is a function; its types are written on its own parameters and ' +
        'after them, not as a type on the const.',
    ]);
    expect(typed.editor).toContain(typed.compiler[0]);
  });

  it('a parameter it cannot take is the one sentence, and the call adds nothing', () => {
    const halves = bothHalves(
      inFs('  const f = (x: string): f32 => 1.;\n  return vec4(f(1.), 0., 0., 1.);'),
    );
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('TS8002: A string has no GPU representation');
    const unannotated = bothHalves(
      inFs('  const f = (x) => x;\n  return vec4(f(1.), 0., 0., 1.);'),
    );
    expect(unannotated.compiler).toEqual([
      'typeshade TS8002: Parameter "x" requires a TypeShade type annotation.',
    ]);
  });
});

describe('a local function with no written result type infers it (Rule 8.19, change 0134)', () => {
  it('a recursive one is the one TS8031 in both halves, as the editor writes no type of its own', () => {
    const body = (decl: string): string =>
      `"use typeshade"\nexport function t(vi: u32): u32 {\n  ${decl}\n  return f(vi);\n}\n`;
    const sentence =
      'Recursive call: "t_f" -> "t_f". WGSL has no call stack, so a function must not take ' +
      'part in a call cycle.';
    bothRefuse(
      body('const f = (n: u32) => { if (n > 0) { return f(n - 1) + 1; } return 0; };'),
      'TS8031',
      sentence,
    );
    bothRefuse(
      body('function f(n: u32) { if (n > 0) { return f(n - 1) + 1; } return 0; }'),
      'TS8031',
      sentence,
    );
  });
});

describe('an optional parameter of a local function takes the absent value (change 0093)', () => {
  it(
    'a call that omits it passes the absent value, and one that writes it passes it present',
    keepHelpers(() => {
      const r = bothTake(
        inFs(
          '  const f = (x: f32, y?: f32): f32 => x + (y ?? 10.);\n' +
            '  return vec4(f(1.), f(1., 2.), 0., 1.);',
        ),
      ).result;
      expect(r.wgsl).toContain('fs_f(1.0, _opt_f32_(0.0, false))');
      expect(r.wgsl).toContain('fs_f(1.0, _opt_f32_(2.0, true))');
      expect(r.eval('fs', [])).toEqual([11, 3, 0, 1]);
    }),
  );
});

describe('what a local function captures is a parameter ahead of its own (Rule 8.17)', () => {
  it(
    'the callee captures pass on through each caller, after the caller own, to a fixed point',
    keepHelpers(() => {
      const r = bothTake(
        inFs(
          '  let v = 1.;\n  let w = 2.;\n' +
            '  const c = (): f32 => v;\n' +
            '  const b = (): f32 => c() + w;\n' +
            '  const a = (): f32 => b();\n' +
            '  v = 5.;\n  return vec4(a(), 0., 0., 1.);',
        ),
      ).result;
      expect(signatures(r.wgsl)).toEqual(
        expect.arrayContaining([
          'fn fs_c(v: f32) -> f32',
          'fn fs_b(w: f32, v: f32) -> f32',
          'fn fs_a(w: f32, v: f32) -> f32',
        ]),
      );
      expect(r.eval('fs', [])).toEqual([7, 0, 0, 1]);
    }),
  );

  it(
    'a caller declared before its callee still takes what the callee captures',
    keepHelpers(() => {
      const r = bothTake(
        inFs(
          '  let v = 1.;\n  let w = 2.;\n' +
            '  function a(): f32 { return b(); }\n' +
            '  function b(): f32 { return c() + w; }\n' +
            '  function c(): f32 { return v; }\n' +
            '  v = 5.;\n  return vec4(a(), 0., 0., 1.);',
        ),
      ).result;
      expect(signatures(r.wgsl)).toEqual(
        expect.arrayContaining([
          'fn fs_a(w: f32, v: f32) -> f32',
          'fn fs_b(w: f32, v: f32) -> f32',
          'fn fs_c(v: f32) -> f32',
        ]),
      );
      expect(r.eval('fs', [])).toEqual([7, 0, 0, 1]);
    }),
  );

  it(
    'the object of the method comes first, then each variable, and a local function that only hands it on takes it too',
    keepHelpers(() => {
      const r = bothTake(
        `"use typeshade"
class A {
  v: f32 = 1.;
  get(): f32 {
    const k = 2.;
    const g = (): f32 => this.v + k;
    function h(): f32 { return g(); }
    const f = (): f32 => h();
    return f();
  }
}
@fragment export function fs(): vec4 {
  const a = new A();
  return vec4(a.get(), 0., 0., 1.);
}
`,
      ).result;
      expect(signatures(r.wgsl)).toEqual(
        expect.arrayContaining([
          'fn A_get_g(self_: A, k: f32) -> f32',
          'fn A_get_h(self_: A, k: f32) -> f32',
          'fn A_get_f(self_: A, k: f32) -> f32',
        ]),
      );
      expect(r.eval('fs', [])).toEqual([3, 0, 0, 1]);
    }),
  );

  it(
    'a second variable of a taken name gets a numbered name, and a variable named self_ never takes the object name',
    keepHelpers(() => {
      const taken = bothTake(
        inFs(
          '  const x = 2.;\n  const f = (x_1: f32): f32 => x + x_1;\n  return vec4(f(1.), 0., 0., 1.);',
        ),
      ).result;
      expect(signatures(taken.wgsl)).toContain('fn fs_f(x: f32, x_1: f32) -> f32');
      const own = bothTake(
        `"use typeshade"
class A {
  v: f32 = 1.;
  get(): f32 {
    const self_ = 2.;
    const f = (): f32 => this.v + self_;
    return f();
  }
}
@fragment export function fs(): vec4 {
  const a = new A();
  return vec4(a.get(), 0., 0., 1.);
}
`,
      ).result;
      expect(signatures(own.wgsl)).toContain('fn A_get_f(self_: A, self__1: f32) -> f32');
      expect(own.eval('fs', [])).toEqual([3, 0, 0, 1]);
    }),
  );

  it(
    'a constant of no fixed type stays one inside the local function, so it takes the type its use asks',
    keepHelpers(() => {
      const r = bothTake(
        inFs(
          '  const k = 2;\n  const f = (x: f32): f32 => x * k;\n  return vec4(f(1.5), 0., 0., 1.);',
        ),
      ).result;
      expect(r.eval('fs', [])).toEqual([3, 0, 0, 1]);
    }),
  );

  it('a captured const keeps its value and its constancy, so a loop it decides is judged in the local function (Rule 7.5)', () => {
    bothRefuse(
      inFs(
        '  const go = true;\n' +
          '  const f = (): f32 => { let s = 0.; while (go) { s += 1.; } return s; };\n' +
          '  return vec4(f(), 0., 0., 1.);',
      ),
      'TS8007',
      'while (go) has no break or return in its body, so it never ends. Leave it with a break, or ' +
        'write the exit into the condition.',
    );
    bothRefuse(
      inFs(
        '  const n: i32 = 4;\n' +
          '  const f = (): f32 => { let s = 0.; for (let i = 0; i < n; i += 0) { s += 1.; } return s; };\n' +
          '  return vec4(f(), 0., 0., 1.);',
      ),
      'TS8007',
      'for step "i += 0" never advances "i": a step of 0 leaves it where it is.',
    );
  });

  it('a number whose type its uses decide takes it from the uses inside the local function (Rule 5.1)', () => {
    const program = (body: string): string =>
      `"use typeshade"\nexport function t(vi: u32): u32 {\n  let n = 0;\n${body}\n}\n`;
    const sum = bothTake(program('  const f = (): u32 => n + vi;\n  return f();')).result;
    expect(sum.eval('t', [5])).toBe(5);
    const read = bothTake(program('  const f = (): u32 => n;\n  n = 3;\n  return f();')).result;
    expect(read.eval('t', [5])).toBe(3);
  });
});

describe('a local function is declared in the body that writes it and in no body inside that one', () => {
  it(
    'an inner function of the name of an outer one is the inner body own',
    keepHelpers(() => {
      const r = bothTake(
        inFs(
          '  const f = (x: f32): f32 => x * 2.;\n' +
            '  const g = (): f32 => { const f = (y: f32): f32 => y + 1.; return f(10.); };\n' +
            '  return vec4(f(1.), g(), 0., 1.);',
        ),
      ).result;
      expect(signatures(r.wgsl)).toEqual(
        expect.arrayContaining([
          'fn fs_f(x: f32) -> f32',
          'fn fs_g() -> f32',
          'fn fs_g_f(y: f32) -> f32',
        ]),
      );
      expect(r.eval('fs', [])).toEqual([2, 11, 0, 1]);
    }),
  );
});

describe('a local function named like a value constructor is the function its name hands over (Rule 9.5)', () => {
  const read = (pre: string, body: string): number =>
    bothTake(`"use typeshade"\n${pre}\nexport function t(k: f32): f32 {\n${body}\n}\n`).result.eval(
      't',
      [1],
    ) as number;

  it('to an array method, to a function that takes a function, and to a fold', () => {
    expect(
      read(
        'const xs = array<f32, 2>(1., 2.);',
        '  const vec2 = (x: f32): f32 => x * 100.;\n  const m = xs.map(vec2);\n  return m[1] + k;',
      ),
    ).toBe(201);
    expect(
      read(
        'function twice(f: (x: f32) => f32, v: f32): f32 { return f(f(v)); }',
        '  const vec2 = (x: f32): f32 => x * 10.;\n  return twice(vec2, k);',
      ),
    ).toBe(100);
    expect(
      read(
        '',
        '  const vec2 = (a: f32, x: f32): f32 => a + x * 10.;\n' +
          '  return array<f32, 2>(1., 2.).reduce(vec2, 0.) + k;',
      ),
    ).toBe(31);
  });
});
