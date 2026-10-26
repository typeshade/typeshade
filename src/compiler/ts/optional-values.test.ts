// Verifies: Rule 7.10, Rule 8.18, Rule 8.19, Rule 8.21, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// An optional value, `T | undefined` (proposal 0088). The compiler lowers each one to a value
// and a presence flag, follows TypeScript's narrowing of a local or a parameter, and refuses an
// un-narrowed read with its own TS8003 sentence where TypeScript reports TS18048 (Rule 12.7).
// Every program here is read twice, by `compile()` and by the language service over the ambient
// library (CLAUDE.md, "A test reads both halves"), and the values run on the CPU oracle and the
// CPU codegen, present and absent, as the proposal's functional validation asks.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** A program with a fragment entry that reads `call`, so the GLSL ES 3.00 fragment, which
 *  carries only what its entry reaches, holds the functions under test. */
const program = (body: string, call = '0.'): string => `"use typeshade";
${body}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(uv, ${call}, 1.);
}
`;

const errorsOf = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** Everything the editor reports on `source`: TypeScript's share and the compiler's alike. */
function editorOf(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('/optional/a.ts', source);
  return service
    .getDiagnostics('/optional/a.ts')
    .map((d) => `${d.source} ${String(d.code)} ${d.message}`);
}

/** The compiler's sentences in the editor's list, without TypeScript's own share. */
const editorCompilerSentences = (source: string): string[] =>
  editorOf(source)
    .filter((d) => d.startsWith('typeshade '))
    .map((d) => d.slice('typeshade '.length));

/** Both halves take the program: `compile()` has no error, and the editor has nothing to say. */
function bothAccept(source: string): ReturnType<typeof compile> {
  const r = compile(source);
  expect(r.diagnostics).toEqual([]);
  expect(editorOf(source)).toEqual([]);
  return r;
}

/** Both halves refuse the program with exactly `sentences`, the compiler's, and the editor
 *  shows no TypeScript TS18048 or TS2532 beside them (Rule 12.7). */
function bothRefuse(source: string, sentences: readonly string[]): void {
  expect(errorsOf(source)).toEqual(sentences);
  const editor = editorOf(source);
  expect(editorCompilerSentences(source)).toEqual(sentences);
  expect(editor.filter((d) => /^typescript (18048|2532) /.test(d))).toEqual([]);
}

/** The CPU oracle and the CPU codegen of a compiled module, held to one answer. */
function cpu(r: ReturnType<typeof compile>): (fn: string, ...args: unknown[]) => unknown {
  const oracle = compileModule(r.module).fns;
  const js = compileModuleJs(r.module).fns;
  return (fn, ...args) => {
    const a = oracle[fn]!(...args);
    const b = js[fn]!(...args);
    expect(b, `${fn}(${JSON.stringify(args)}): the CPU codegen disagrees with the oracle`).toEqual(
      a,
    );
    return a;
  };
}

const present = (value: unknown): { value: unknown; present: boolean } => ({
  value,
  present: true,
});
const absent = (value: unknown): { value: unknown; present: boolean } => ({
  value,
  present: false,
});

// ─── (a) Each allowed position, for each element kind ───

describe('each allowed position holds an optional of each element kind (Rule 7.10, Rule 8.19)', () => {
  /** `[kind, the type, the value `opt` builds from `k`, the WGSL struct name, an f32 the entry
   *  reads from `opt(uv.x)`, the CPU value at k = 3, its zero, a fallback the CPU passes]` */
  const KINDS: readonly (readonly [
    string,
    string,
    string,
    string,
    string,
    unknown,
    unknown,
    unknown,
  ])[] = [
    ['f32', 'f32', 'k', '_opt_f32_', 'opt(uv.x) ?? 0.', 3, 0, 1],
    ['i32', 'i32', 'i32(k)', '_opt_i32_', 'f32(opt(uv.x) ?? 0)', 3, 0, 1],
    ['bool', 'bool', 'k > 0.', '_opt_bool_', '(opt(uv.x) ?? false) ? 1. : 0.', true, false, true],
    ['vec2', 'vec2', 'vec2(k, k)', '_opt_vec2_f32_', 'opt(uv.x)?.x ?? 0.', [3, 3], [0, 0], [1, 1]],
    [
      'array<f32, 2>',
      'array<f32, 2>',
      'array<f32, 2>(k, k)',
      '_opt_array_f32_2_',
      'opt(uv.x)?.[0] ?? 0.',
      [3, 3],
      [0, 0],
      [1, 1],
    ],
    [
      'a struct',
      'P',
      '{ x: k, y: k }',
      '_opt_P_',
      'opt(uv.x)?.x ?? 0.',
      { x: 3, y: 3 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    [
      'mat2x2<f32>',
      'mat2x2<f32>',
      'mat2(k, 0., 0., k)',
      '_opt_mat2x2_f32_',
      '(opt(uv.x)?.[0] ?? vec2(0.)).x',
      [3, 0, 0, 3],
      [0, 0, 0, 0],
      [1, 0, 0, 1],
    ],
  ];

  for (const [kind, type, value, struct, call, at3, zero, fallback] of KINDS) {
    it(`${kind}: a result, an inferred result, a parameter, a local and a callback result`, () => {
      const source = program(
        `class P { x: f32; y: f32; }
export function opt(k: f32): ${type} | undefined { if (k < 0.) { return undefined; } return ${value}; }
export function inferred(k: f32) { if (k < 0.) { return undefined; } return ${value}; }
export function pick(v: ${type} | undefined, d: ${type}): ${type} { return v ?? d; }
export function local(k: f32, d: ${type}): ${type} { let v: ${type} | undefined; if (k > 0.) { v = ${value}; } return v ?? d; }
function cb(f: (x: f32) => ${type} | undefined, x: f32, d: ${type}): ${type} { return f(x) ?? d; }
export function viaCb(x: f32, d: ${type}): ${type} { return cb(opt, x, d); }`,
        call,
      );
      const r = bothAccept(source);
      // WGSL: the internal struct, the present and absent constructions, and the pick.
      expect(r.wgsl).toContain(`struct ${struct} {\n  value: `);
      expect(r.wgsl).toContain(`, false);`);
      expect(r.wgsl).toContain(`, true);`);
      expect(r.wgsl).toContain(`fn opt(k: f32) -> ${struct} {`);
      expect(r.wgsl).toContain(`fn inferred(k: f32) -> ${struct} {`);
      expect(r.wgsl).toContain(`fn pick(v: ${struct}, d: `);
      expect(r.wgsl).toMatch(/select\([^\n]*v\.present\)|if \(v\.present\) \{/);
      expect(r.wgsl).toContain(`var v: ${struct} = ${struct}(`);
      // GLSL ES 3.00 emits the same struct for the fragment stage.
      expect(r.glsl?.fragment).toContain(`struct ${struct} {`);
      expect(r.glsl?.fragment).toContain(`${struct} opt(float k) {`);
      // The CPU oracle and the CPU codegen: one value, present and absent, through each form.
      const run = cpu(r);
      expect(run('opt', 3)).toEqual(present(at3));
      expect(run('opt', -3)).toEqual(absent(zero));
      expect(run('inferred', 3)).toEqual(present(at3));
      expect(run('inferred', -3)).toEqual(absent(zero));
      expect(run('pick', present(at3), fallback)).toEqual(at3);
      expect(run('pick', absent(zero), fallback)).toEqual(fallback);
      expect(run('local', 3, fallback)).toEqual(at3);
      expect(run('local', -3, fallback)).toEqual(fallback);
      expect(run('viaCb', 3, fallback)).toEqual(at3);
      expect(run('viaCb', -3, fallback)).toEqual(fallback);
    });
  }

  it('an integer literal on the right of ?? takes the i32 of the left', () => {
    const r = bothAccept(
      program(
        `export function pick(v: i32 | undefined): i32 { return v ?? 1; }`,
        'f32(pick(undefined))',
      ),
    );
    expect(r.wgsl).toContain('return select(1, v.value, v.present);');
    expect(r.glsl?.fragment).toContain('return (v.present ? v.value : 1);');
    const run = cpu(r);
    expect(run('pick', present(4))).toBe(4);
    expect(run('pick', absent(0))).toBe(1);
  });

  it('a let declared with no initializer starts absent, and `?? d` reads d', () => {
    const r = bothAccept(
      program(`export function run(): f32 { let v: f32 | undefined; return v ?? 7.; }`),
    );
    expect(r.wgsl).toContain('var v: _opt_f32_ = _opt_f32_(0.0, false);');
    expect(cpu(r)('run')).toBe(7);
  });
});

// ─── (b) `??` evaluates its right side only when the left is absent ───

describe('v ?? d evaluates d only when v is absent (Rule 7.9, Rule 7.10)', () => {
  const source = program(
    `let counter: f32 = 0.;
function bump(): f32 { counter = counter + 1.; return counter; }
export function lazy(v: f32 | undefined): f32 { return (v ?? bump()) + counter * 100.; }`,
    'lazy(undefined)',
  );

  it('lowers a writing right side through an if, not a select', () => {
    const r = bothAccept(source);
    expect(r.wgsl).toContain('if (v.present) {');
    expect(r.wgsl).toContain('_seq0 = bump();');
    expect(r.wgsl).not.toContain('select(bump()');
    expect(r.glsl?.fragment).toContain('if (v.present) {');
  });

  it('runs the right side on the CPU only for an absent left', () => {
    const run = cpu(compile(source));
    // Present: the value, and the counter still 0.
    expect(run('lazy', present(5))).toBe(5);
    // Absent: bump ran once, so the result is 1 and the counter reads 1.
    expect(run('lazy', absent(0))).toBe(101);
  });
});

// ─── (c) The narrowing forms the compiler follows ───

describe('the compiler follows the narrowing forms TypeScript follows (Rule 7.10, Rule 12.7)', () => {
  /** `[name, body, the CPU calls to make and their answers]` */
  const FORMS: readonly (readonly [string, string, readonly (readonly [unknown[], unknown])[]])[] =
    [
      [
        '=== undefined in an if',
        `export function run(v: f32 | undefined): f32 { if (v === undefined) { return -1.; } return v * 2.; }`,
        [
          [[present(2)], 4],
          [[absent(0)], -1],
        ],
      ],
      [
        'undefined === v, the operands reversed',
        `export function run(v: f32 | undefined): f32 { if (undefined === v) { return -1.; } return v; }`,
        [
          [[present(2)], 2],
          [[absent(0)], -1],
        ],
      ],
      [
        '!== undefined in a ternary',
        `export function run(v: f32 | undefined): f32 { return v !== undefined ? v : -1.; }`,
        [
          [[present(2)], 2],
          [[absent(0)], -1],
        ],
      ],
      [
        '== undefined and != undefined, the loose spellings',
        `export function run(v: f32 | undefined): f32 { if (undefined == v) { return -1.; } if (v != undefined) { return v; } return -2.; }`,
        [
          [[present(2)], 2],
          [[absent(0)], -1],
        ],
      ],
      [
        '!(v === undefined)',
        `export function run(v: f32 | undefined): f32 { if (!(v === undefined)) { return v; } return -1.; }`,
        [
          [[present(2)], 2],
          [[absent(0)], -1],
        ],
      ],
      [
        '!(v !== undefined)',
        `export function run(v: f32 | undefined): f32 { if (!(v !== undefined)) { return -1.; } return v; }`,
        [
          [[present(2)], 2],
          [[absent(0)], -1],
        ],
      ],
      [
        'the right of &&',
        `export function run(v: f32 | undefined): bool { return v !== undefined && v > 1.; }`,
        [
          [[present(2)], true],
          [[present(0)], false],
          [[absent(0)], false],
        ],
      ],
      [
        'the right of ||',
        `export function run(v: f32 | undefined): bool { return v === undefined || v > 1.; }`,
        [
          [[present(2)], true],
          [[present(0)], false],
          [[absent(0)], true],
        ],
      ],
      [
        'a while condition',
        `export function run(v: f32 | undefined): f32 { let s = 0.; while (v !== undefined && s < v) { s = s + 1.; } return s; }`,
        [
          [[present(3)], 3],
          [[absent(0)], 0],
        ],
      ],
      [
        'an early break',
        `export function run(v: f32 | undefined): f32 { let s = 0.; for (let i = 0; i < 4; i++) { if (v === undefined) { break; } s = s + v; } return s; }`,
        [
          [[present(2)], 8],
          [[absent(0)], 0],
        ],
      ],
      [
        'an early continue',
        `export function run(v: f32 | undefined): f32 { let s = 0.; for (let i = 0; i < 4; i++) { if (v === undefined) { continue; } s = s + v; } return s; }`,
        [
          [[present(2)], 8],
          [[absent(0)], 0],
        ],
      ],
      [
        'an assignment of a value',
        `export function run(k: f32): f32 { let v: f32 | undefined; v = k; return v + 1.; }`,
        [[[2], 3]],
      ],
      [
        'an assignment of undefined',
        `export function run(k: f32): f32 { let v: f32 | undefined = k; v = undefined; return v ?? -1.; }`,
        [[[2], -1]],
      ],
      [
        'an initializer',
        `export function run(k: f32): f32 { let v: f32 | undefined = k; return v * 2.; }`,
        [[[2], 4]],
      ],
      [
        'an assignment from a narrowed optional',
        `export function run(w: f32 | undefined): f32 { if (w === undefined) { return 0.; } let v: f32 | undefined = w; return v; }`,
        [
          [[present(2)], 2],
          [[absent(0)], 0],
        ],
      ],
      [
        '??=',
        `export function run(v: f32 | undefined): f32 { v ??= 3.; return v + 1.; }`,
        [
          [[present(2)], 3],
          [[absent(0)], 4],
        ],
      ],
      [
        'a const an arrow function captures keeps its narrowing',
        `export function run(v: f32 | undefined): f32 { if (v !== undefined) { const w = v; const g = (k: f32): f32 => w * k; return g(2.); } return 0.; }`,
        [
          [[present(3)], 6],
          [[absent(0)], 0],
        ],
      ],
      [
        'a parameter nothing assigns after the closure keeps its narrowing',
        `export function run(v: f32 | undefined): f32 { if (v !== undefined) { const g = (k: f32): f32 => v * k; return g(2.); } return 0.; }`,
        [
          [[present(3)], 6],
          [[absent(0)], 0],
        ],
      ],
      [
        'a const alias of an optional is one too, and narrows',
        `export function run(v: f32 | undefined): f32 { const w = v; if (w === undefined) { return -1.; } return w; }`,
        [
          [[present(4)], 4],
          [[absent(0)], -1],
        ],
      ],
      [
        'a loop that reassigns through ??',
        `export function run(k: f32): f32 { let v: f32 | undefined; for (let i = 0; i < 3; i++) { v = (v ?? 0.) + k; } return v ?? -1.; }`,
        [[[2], 6]],
      ],
    ];

  for (const [name, body, calls] of FORMS) {
    it(`${name}: both halves accept, and the CPU agrees`, () => {
      const r = bothAccept(program(body));
      const run = cpu(r);
      for (const [args, answer] of calls) expect(run('run', ...args)).toEqual(answer);
    });
  }

  it('an early discard narrows for the compiler; TypeScript does not read discard as an exit', () => {
    const source = `"use typeshade";
@fragment
export function fs(@location(0) uv: vec2, @location(1) w: f32): vec4 {
  let v: f32 | undefined;
  if (uv.x > 0.5) { v = w; }
  if (v === undefined) { discard; }
  return vec4(v, 0., 0., 1.);
}
`;
    const r = compile(source);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('discard;');
    // Observed: the editor keeps TypeScript's TS2769 at `vec4(v, …)`, since a bare `discard;`
    // statement is no `return` to TypeScript's flow. The compiler's half is the proposal's;
    // the editor's half is the one that still disagrees, and this pins it so a closing of the
    // gap shows here.
    const editor = editorOf(source);
    expect(editor.filter((d) => d.startsWith('typeshade '))).toEqual([]);
    expect(editor.map((d) => d.split(' ').slice(0, 2).join(' '))).toEqual(['typescript 2769']);
  });

  it('a let assigned after the closure loses its narrowing in both halves, and the editor shows the compiler alone', () => {
    const source = program(`export function run(v: f32 | undefined): f32 {
  let w = v;
  if (w !== undefined) {
    const g = (k: f32): f32 => w * k;
    w = undefined;
    return g(2.);
  }
  return 0.;
}`);
    const sentence =
      'TS8003 "w" is "f32 | undefined" here, and "*" takes an f32. Test it first, ' +
      '"if (w !== undefined)", or give the absent case a value, "w ?? 0.".';
    expect(errorsOf(source)).toEqual([sentence]);
    expect(editorOf(source)).toEqual([`typeshade ${sentence}`]);
  });
});

// ─── (d) Each refused position and form, pinned to its sentence ───

describe('each refused position and form says one sentence, and nothing more at later uses', () => {
  const POSITION = (written: string, position: string, inner: string, field = false): string =>
    `TS8002 "${written}" holds a value and a flag saying whether it is there, which a local, a ` +
    `parameter or a function's result may hold; ${position} may not. Carry a bool ${
      field ? 'field' : 'value'
    } beside the value, "${inner}".`;
  const UNNARROWED = (
    name: string,
    type: string,
    takes: string,
    inner: string,
    zero: string,
  ): string =>
    `TS8003 "${name}" is "${type}" here, and ${takes} ${inner}. Test it first, ` +
    `"if (${name} !== undefined)", or give the absent case a value, "${name} ?? ${zero}".`;

  /** `[name, body, the sentences, as the compiler says them]` */
  const REFUSED: readonly (readonly [string, string, readonly string[]])[] = [
    [
      'a struct field',
      `class Q { f: f32 | undefined; }
export function run(): f32 { const q = new Q(); return 1.; }`,
      [POSITION('f32 | undefined', 'a struct field', 'f32', true)],
    ],
    [
      'an array element',
      `export function run(xs: array<f32 | undefined, 4>): f32 { return 1.; }`,
      [POSITION('f32 | undefined', 'an array element', 'f32')],
    ],
    [
      'a binding',
      `declare const u: uniform<f32 | undefined>;
export function run(): f32 { return 1.; }`,
      [POSITION('f32 | undefined', 'a binding', 'f32')],
    ],
    [
      'a module constant',
      `const K: f32 | undefined = 1.;
export function run(): f32 { return 1.; }`,
      [POSITION('f32 | undefined', 'a module constant', 'f32')],
    ],
    [
      'a module variable',
      `let g: f32 | undefined = 1.;
export function run(): f32 { return 1.; }`,
      [POSITION('f32 | undefined', 'a module variable', 'f32')],
    ],
    [
      "an entry point's parameter",
      `@fragment
export function fs2(@location(0) uv: vec2, @location(1) w: f32 | undefined): vec4 { return vec4(1.); }`,
      [POSITION('f32 | undefined', "an entry point's parameter", 'f32')],
    ],
    [
      "an entry point's result",
      `@fragment
export function fs2(@location(0) uv: vec2): vec4 | undefined { return vec4(1.); }`,
      [POSITION('vec4 | undefined', "an entry point's result", 'vec4')],
    ],
    [
      'a Map value',
      `export function kern(m: Map<u32, f32 | undefined>, xs: array<f32>): f32 { return xs[0]; }`,
      [POSITION('f32 | undefined', 'a Map value', 'f32')],
    ],
    [
      'f32 | null',
      `function f(x: f32 | null): f32 { return 0.; }`,
      [
        'TS8002 "f32 | null" names null, which a shader has no value for. Write "f32 | undefined": ' +
          'the compiler carries whether the value is there (Rule 7.10).',
      ],
    ],
    [
      'undefined alone as a type',
      `function f(x: undefined): f32 { return 0.; }`,
      [
        'TS8002 undefined alone is the absent value and no type. Write "T | undefined" for a value ' +
          'that may be absent: the compiler carries whether the value is there (Rule 7.10).',
      ],
    ],
    [
      'an optional texture',
      `function f(t: texture_2d<f32> | undefined, s: sampler): vec4 { return vec4(1.); }`,
      [
        'TS8002 "texture_2d<f32> | undefined" would hold a texture_2d<f32> and a flag saying ' +
          'whether it is there, and an optional holds what a function-scope struct field may: a ' +
          'scalar, a vector, a matrix, an array with a size or a struct.',
      ],
    ],
    [
      'an un-narrowed read under an operator',
      `export function run(v: f32 | undefined): f32 { return v * 2.; }`,
      [UNNARROWED('v', 'f32 | undefined', '"*" takes an', 'f32', '0.')],
    ],
    [
      'an un-narrowed read as an argument',
      `export function run(v: f32 | undefined): f32 { return sqrt(v); }`,
      [UNNARROWED('v', 'f32 | undefined', 'argument 1 of "sqrt" takes an', 'f32', '0.')],
    ],
    [
      'an un-narrowed read as a result',
      `export function run(v: f32 | undefined): f32 { return v; }`,
      [UNNARROWED('v', 'f32 | undefined', 'the result here is an', 'f32', '0.')],
    ],
    [
      'an un-narrowed read through .x',
      `export function run(v: vec2 | undefined): f32 { return v.x; }`,
      [UNNARROWED('v', 'vec2 | undefined', '".x" needs a', 'vec2', 'vec2()')],
    ],
    [
      'an un-narrowed read through an index',
      `export function run(v: array<f32, 2> | undefined): f32 { return v[0]; }`,
      [
        UNNARROWED(
          'v',
          'array<f32, 2> | undefined',
          'an index needs an',
          'array<f32, 2>',
          'array<f32, 2>()',
        ),
      ],
    ],
    [
      'an un-narrowed read as an index',
      `export function run(xs: array<f32, 2>, v: i32 | undefined): f32 { return xs[v]; }`,
      [UNNARROWED('v', 'i32 | undefined', 'an index is an', 'i32', '0')],
    ],
    [
      'an optional as a condition',
      `export function run(v: f32 | undefined): f32 { if (v) { return 1.; } return 0.; }`,
      ['TS8003 A condition is a bool, and "v" is "f32 | undefined". Write "v !== undefined".'],
    ],
    [
      'a bool optional as a condition names its own remedy',
      `export function run(v: bool | undefined): f32 { if (v) { return 1.; } return 0.; }`,
      [
        'TS8003 A condition is a bool, and "v" is "bool | undefined". Write "v === true", or ' +
          '"v ?? false".',
      ],
    ],
    [
      'v!',
      `export function run(v: f32 | undefined): f32 { return v!; }`,
      [
        'TS8003 "v!" asserts that "v" is there, which a shader cannot check. Test it, ' +
          '"if (v !== undefined)", or give the absent case a value, "v ?? 0.".',
      ],
    ],
    [
      'o?.m()',
      `class P { x: f32; len(): f32 { return this.x; } }
function point(k: f32): P | undefined { if (k < 0.) { return undefined; } return { x: k }; }
export function run(k: f32): f32 { const p = point(k); return p?.len() ?? -1.; }`,
      [
        'TS8099 "?." before a call tests a function value, and a shader has none. Test the object ' +
          'first, "if (p !== undefined)", and call it there.',
      ],
    ],
    [
      'undefined where no optional is expected',
      `export function run(x: f32): f32 { return undefined; }`,
      [
        'TS8003 "undefined" is the absent value of an optional type, "T | undefined", and nothing ' +
          'here declares one (Rule 7.10). Write it where a "T | undefined" is expected: a result, ' +
          'a local or a parameter declared so.',
      ],
    ],
    [
      'a bare return in an optional function',
      `export function run(v: f32 | undefined): f32 | undefined { if (v === undefined) { return; } return v; }`,
      [
        'TS8021 Function "run" returns f32 | undefined but has a bare "return". Write ' +
          '"return undefined;" for the absent case (Rule 7.10).',
      ],
    ],
    [
      'a function returning only undefined with no result type',
      `export function run(x: f32) { return undefined; }`,
      [
        'TS8021 "run" returns undefined and no value, so nothing says what its result is: write a ' +
          'result type, ": T | undefined", or return a value on another path (Rule 8.19).',
      ],
    ],
    [
      'x === undefined on a value that is always there',
      `export function run(x: f32): bool { return x === undefined; }`,
      [
        'TS8003 "x" is an f32, which is always there, so comparing it with undefined is never ' +
          'true. Declare it "f32 | undefined" if it may be absent, or drop the test.',
      ],
    ],
    [
      'typeof v === "undefined"',
      `export function run(v: f32 | undefined): f32 { if (typeof v === "undefined") { return 0.; } return v; }`,
      [
        'TS8099 "typeof v" has no shader form: a value\'s type is fixed where it is declared. Test ' +
          'an optional value with "v === undefined" or "v !== undefined".',
        UNNARROWED('v', 'f32 | undefined', 'the result here is an', 'f32', '0.'),
      ],
    ],
    [
      'an aliased condition',
      `export function run(v: f32 | undefined): f32 { const ok = v !== undefined; if (ok) { return v; } return 0.; }`,
      [UNNARROWED('v', 'f32 | undefined', 'the result here is an', 'f32', '0.')],
    ],
    [
      'a loop condition that reads a call twice',
      `function root(x: f32): f32 | undefined { if (x < 0.) { return undefined; } return sqrt(x); }
export function run(x: f32): f32 { let s = 0.; while ((root(x) ?? 0.) > s) { s = s + 1.; } return s; }`,
      [
        'TS8099 "root(x)" is read twice here, for its flag and its value, and runs once: take it ' +
          "in a const on a line of its own first, or, in a loop's condition, in a local the body " +
          'assigns.',
      ],
    ],
  ];

  for (const [name, body, sentences] of REFUSED) {
    it(`${name}: ${sentences[0]!.slice(0, 7)}, in both halves`, () => {
      bothRefuse(program(body), sentences);
    });
  }

  it('null alone as a type is refused by TS8002 in both halves', () => {
    // Observed: the sentence is the general "Unsupported type syntax", since TypeScript parses
    // `null` in a type as a literal type and not as the null keyword; the proposal names the
    // keyword sentence. The code and the count are what is pinned.
    const source = program(`function f(x: null): f32 { return 0.; }`);
    const errors = errorsOf(source);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^TS8002 /);
    expect(editorCompilerSentences(source)).toEqual(errors);
  });

  it('puts the sentence for a stray undefined on the return statement (Rule 12.4)', () => {
    const source = program(`export function run(x: f32): f32 { return undefined; }`);
    const d = compile(source).diagnostics;
    expect(d).toHaveLength(1);
    expect(d[0]!.start).toBe(source.indexOf('return undefined;'));
    expect(d[0]!.length).toBe('return undefined;'.length);
  });

  it('a mismatched comparison of an optional and another type is one sentence', () => {
    bothRefuse(
      program(`export function run(a: f32 | undefined, b: i32): bool { return a === b; }`),
      ['TS8003 Type mismatch in compare: f32 | undefined and i32.'],
    );
  });
});

// ─── (e) Equality ───

describe("equality with an optional gives ECMAScript's answer (Rule 7.10)", () => {
  const source =
    program(`export function eqVal(v: f32 | undefined, x: f32): bool { return v === x; }
export function neqVal(v: f32 | undefined, x: f32): bool { return v !== x; }
export function eqTwo(a: f32 | undefined, b: f32 | undefined): bool { return a === b; }
export function neqTwo(a: f32 | undefined, b: f32 | undefined): bool { return a !== b; }
export function eqVec(a: vec2 | undefined, b: vec2): vec2b { return a === b; }
export function allVec(a: vec2 | undefined, b: vec2): bool { return all(a === b); }
export function eqVecTwo(a: vec2 | undefined, b: vec2 | undefined): bool { return a === b; }`);

  it('lowers v === x to the flag and the value, and a vector to a vec of bool', () => {
    const r = bothAccept(source);
    expect(r.wgsl).toContain('return (v.present && (v.value == x));');
    expect(r.wgsl).toContain('return select(vec2<bool>(false, false), (a.value == b), a.present);');
    expect(r.wgsl).toContain('all(');
  });

  it('agrees on the CPU: both absent equal, present and absent unequal', () => {
    const run = cpu(compile(source));
    expect(run('eqVal', present(2), 2)).toBe(true);
    expect(run('eqVal', present(2), 3)).toBe(false);
    expect(run('eqVal', absent(0), 0)).toBe(false);
    expect(run('neqVal', absent(0), 0)).toBe(true);
    expect(run('eqTwo', absent(2), absent(0))).toBe(true);
    expect(run('eqTwo', present(2), absent(2))).toBe(false);
    expect(run('eqTwo', present(2), present(2))).toBe(true);
    expect(run('eqTwo', present(2), present(3))).toBe(false);
    expect(run('neqTwo', present(2), absent(2))).toBe(true);
    expect(run('eqVec', present([1, 3]), [1, 2])).toEqual([true, false]);
    expect(run('eqVec', absent([0, 0]), [0, 0])).toEqual([false, false]);
    expect(run('allVec', present([1, 2]), [1, 2])).toBe(true);
    expect(run('allVec', absent([0, 0]), [0, 0])).toBe(false);
    expect(run('eqVecTwo', absent([1, 2]), absent([0, 0]))).toBe(true);
    expect(run('eqVecTwo', present([1, 2]), present([1, 2]))).toBe(true);
    expect(run('eqVecTwo', present([1, 2]), absent([1, 2]))).toBe(false);
  });
});

// ─── (f) `?.` ───

describe('o?.f, o?.xy and o?.[i] give an optional of the member (Rule 7.10)', () => {
  const source = program(
    `class P { x: f32; y: f32; }
export function point(k: f32): P | undefined { if (k < 0.) { return undefined; } return { x: k, y: k * 2. }; }
export function field(k: f32): f32 { return point(k)?.y ?? -1.; }
export function viaLocal(k: f32): f32 { const p = point(k); const y = p?.y; return y ?? -1.; }
export function swz(q: vec2 | undefined): vec2 { return q?.yx ?? vec2(-1.); }
export function elem(xs: array<f32, 3> | undefined, i: i32): f32 { return xs?.[i] ?? -1.; }
export function chain(a: f32 | undefined, b: f32 | undefined): f32 { return a ?? b ?? -1.; }`,
    'elem(undefined, 0) + swz(undefined).x',
  );

  it('binds the object once and wraps the member with its flag', () => {
    const r = bothAccept(source);
    expect(r.wgsl).toContain('let _opt = point(k);');
    expect(r.wgsl).toContain('_opt_f32_(_opt.value.y, _opt.present)');
    expect(r.wgsl).toContain('_opt_vec2_f32_(q.value.yx, q.present)');
    expect(r.wgsl).toContain('_opt_f32_(xs.value[i], xs.present)');
    expect(r.glsl?.fragment).toContain('_opt_f32_(xs.value[i], xs.present)');
  });

  it('agrees on the CPU, present and absent', () => {
    const run = cpu(compile(source));
    expect(run('point', 2)).toEqual(present({ x: 2, y: 4 }));
    expect(run('field', 2)).toBe(4);
    expect(run('field', -2)).toBe(-1);
    expect(run('viaLocal', 2)).toBe(4);
    expect(run('viaLocal', -2)).toBe(-1);
    expect(run('swz', present([1, 2]))).toEqual([2, 1]);
    expect(run('swz', absent([0, 0]))).toEqual([-1, -1]);
    expect(run('elem', present([1, 2, 3]), 2)).toBe(3);
    expect(run('elem', absent([0, 0, 0]), 2)).toBe(-1);
    expect(run('chain', absent(0), present(2))).toBe(2);
    expect(run('chain', present(1), present(2))).toBe(1);
    expect(run('chain', absent(0), absent(0))).toBe(-1);
  });
});

// ─── (g) Rule 8.18: a function that returns T where T | undefined is taken ───

describe('a function-typed parameter with an optional result takes a function returning T (Rule 8.18)', () => {
  const source = program(`class Swarm {
  count: i32;
  each(f: (i: f32) => f32 | undefined): f32 {
    let s = 0.;
    for (let i = 0; i < 3; i++) { s = s + (f(f32(i)) ?? 0.); }
    return s;
  }
}
function plainF(x: f32): f32 { return x + 1.; }
function cb(f: (x: f32) => f32 | undefined, x: f32): f32 { return f(x) ?? -1.; }
export function viaNamed(x: f32): f32 { return cb(plainF, x); }
export function viaArrowTyped(x: f32): f32 { return cb((x: f32): f32 => x * 2., x); }
export function viaArrowUntyped(x: f32): f32 { return cb((x) => x * 3., x); }
export function viaArrowOpt(x: f32): f32 { return cb((x) => (x > 0. ? x : undefined), x); }
export function viaMethod(): f32 { const sw = new Swarm(); return sw.each((i: f32) => (i > 1. ? undefined : i)) + sw.each(plainF); }`);

  it('wraps the result of the copy as present', () => {
    const r = bothAccept(source);
    expect(r.wgsl).toContain('let _opt = _opt_f32_(plainF(x), true);');
    expect(r.wgsl).toContain('let _opt = _opt_f32_(viaArrowTyped_f(x), true);');
    expect(r.wgsl).toContain('return _opt_f32_((x * 3.0), true);');
    expect(r.wgsl).toContain('let _opt = _opt_f32_(plainF(f32(i)), true);');
    expect(r.wgsl).toContain('fn Swarm_each_plainF(self_: Swarm) -> f32 {');
  });

  it('agrees on the CPU', () => {
    const run = cpu(compile(source));
    expect(run('viaNamed', 3)).toBe(4);
    expect(run('viaArrowTyped', 3)).toBe(6);
    expect(run('viaArrowUntyped', 3)).toBe(9);
    expect(run('viaArrowOpt', 3)).toBe(3);
    expect(run('viaArrowOpt', -3)).toBe(-1);
    expect(run('viaMethod')).toBe(7);
  });
});

// ─── (h) Hover ───

describe('the editor hovers an optional as the compiler types it, `f32 | undefined` (Rule 12.7)', () => {
  const source = program(`export function hoverMe(v: f32 | undefined): f32 | undefined {
  let w: f32 | undefined = v;
  const c: f32 | undefined = w;
  return c;
}`);

  const hoverAt = (needle: string): string => {
    const service = createTypeshadeLanguageService();
    const uri = '/optional/hover.ts';
    service.openDocument(uri, source);
    expect(service.getDiagnostics(uri)).toEqual([]);
    return service.getHover(uri, service.positionAt(uri, source.indexOf(needle)))?.contents ?? '';
  };

  it('a parameter', () => {
    expect(hoverAt('v: f32 | undefined)')).toContain('(parameter) v: f32 | undefined');
  });
  it('a let and a const', () => {
    expect(hoverAt('w: f32 | undefined = v')).toContain('let w: f32 | undefined');
    expect(hoverAt('c: f32 | undefined = w')).toContain('const c: f32 | undefined');
  });
  it('a function and its result', () => {
    expect(hoverAt('hoverMe(')).toContain('function hoverMe(v: f32 | undefined): f32 | undefined');
  });
});
