// Verifies: Rule 3.2 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { hostFace } from './host-face.js';

describe('function lexical shadowing (#429)', () => {
  it('a top-level noise local shadows the module uniform', () => {
    const r = compile(`"use typeshade";
interface Frame { resolution: vec2; }
declare const u: uniform<Frame>;
function noise(p: vec2): f32 { const u: vec2 = p; return u.x; }
export const fs = fragment(function fs(): vec4 { return vec4(noise(vec2(3., 4.)), 0., 0., 1.); });
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.module.funcs.find((fn) => fn.name === 'noise')!.body[0]).toMatchObject({
      s: 'let',
      name: 'u_1',
    });
    expect(r.eval('fs')).toEqual([3, 0, 0, 1]);
  });

  it.each([
    'const x: f32 = 10.;',
    'interface Frame { value: f32; } declare const x: uniform<Frame>;',
    'declare const x: override<f32>;',
    'let x: f32 = 10.;',
  ])('parameters and locals shadow %s', (moduleValue) => {
    const r = compile(`"use typeshade";
${moduleValue}
function param(x: f32): f32 { return x + 1.; }
function local(): f32 { const x = 3.; return x; }
export const fs = fragment(function fs(): vec4 { return vec4(param(2.) + local(), 0., 0., 1.); });
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.module.funcs.find((fn) => fn.name === 'param')!.params[0]!.name).toBe('x');
    expect(r.wgsl).toContain('fn param(x: f32)');
    expect(r.eval('fs')).toEqual([6, 0, 0, 1]);
  });

  it('a closure captures the local that shadows a uniform', () => {
    const r = compile(`"use typeshade";
declare const u: uniform<f32>;
export function f(): f32 {
  let u = 3.;
  function add(): f32 { u = u + 2.; return u; }
  return add() + u;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(10);
  });

  it('a mutable parameter shadow keeps its input and shared closure copy distinct', () => {
    const r = compile(`"use typeshade";
const u: f32 = 20.;
const u_1: f32 = 40.;
export function f(u: f32): f32 {
  function add(): f32 { u = u + 2.; return u; }
  u = u + 1.;
  return add() + u;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f', [3])).toBe(12);
    expect(r.module.funcs.find((fn) => fn.name === 'f')!.params[0]!.name).toBe('u');
  });

  it('a receiver input may shadow a module value named self_', () => {
    const r = compile(`"use typeshade";
const self_: f32 = 99.;
class Value { y: f32 = 2.; constructor(public x: f32) {} read(): f32 { const get = (): f32 => this.x; return get(); } add(): f32 { this.x = this.x + this.y; return this.x; } }
export function f(): f32 { let value = new Value(3.); return value.read() + value.add(); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(8);
  });

  it('constructors and methods may shadow module names', () => {
    const r = compile(`"use typeshade";
const x: f32 = 99.;
class Value { x: f32; constructor(x: f32) { this.x = x; } add(x: f32): f32 { return this.x + x; } }
export function f(): f32 { return new Value(3.).add(4.); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(7);
  });

  it('the editor resolves a local and parameter ahead of the module uniform', () => {
    const source = `"use typeshade";
interface Frame { value: f32; }
declare const u: uniform<Frame>;
function param(u: f32): f32 { return u; }
export function f(): f32 { const u = vec2(3., 4.); return param(u.x); }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('shadow.shade.ts', source);
    expect(service.getDiagnostics('shadow.shade.ts')).toEqual([]);
    expect(
      service.getHover(
        'shadow.shade.ts',
        service.positionAt('shadow.shade.ts', source.indexOf('u = vec2')),
      )?.contents,
    ).toContain('u: vec2');
    expect(
      service.getHover(
        'shadow.shade.ts',
        service.positionAt('shadow.shade.ts', source.indexOf('u: f32')),
      )?.contents,
    ).toContain('u: f32');
  });

  it.each([
    'export function f(x: f32): f32 { const x = 2.; return x; }',
    'export function f(): f32 { const x = 1.; const x = 2.; return x; }',
    'export function f(x: f32, x: f32): f32 { return x; }',
  ])('still refuses a duplicate in the same frame: %s', (body) => {
    const r = compile('"use typeshade";\n' + body);
    expect(r.diagnostics.some((d) => d.code === 'TS8023')).toBe(true);
    expect(r.wgsl).toBeUndefined();
  });

  it.each(['eval', 'arguments'])('still refuses strict-mode identifier %s', (name) => {
    const r = compile(`"use typeshade"; export function f(${name}: f32): f32 { return ${name}; }`);
    expect(r.diagnostics.some((d) => d.code === 'TS8068')).toBe(true);
  });
});

describe('a read of a static field, an enum member or a namespace constant in a function that has a parameter or a local named like the name the module emits for it (#999)', () => {
  // The module emits `Voice.OFFSET` as the constant `Voice_OFFSET`, `E.A` as `E_A` and `Ns.K` as
  // `Ns_K`. A parameter may share that name (Rule 3.2, change 0039), and the author's read of the
  // field is still the field: the IR tells a `param` from a `constref`. WGSL and GLSL print both
  // as the bare name, so the writers respell a helper's parameter where it would hide a constant
  // its function reads, as they do for a builtin its function calls (Proposal 0070, D-C10-1). The
  // oracle keeps the authored names.
  const CASES: readonly {
    name: string;
    source: string;
    args: unknown[];
    value: number;
    wgsl: readonly string[];
    glsl: readonly string[];
  }[] = [
    {
      name: 'a static field',
      source: `"use typeshade";
class Voice {
  static OFFSET: u32 = 1;
}
function g(Voice_OFFSET: u32): f32 {
  return f32(Voice_OFFSET) + f32(Voice.OFFSET);
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(7), 0., 0., 1.);
});
`,
      args: [7],
      value: 8,
      wgsl: [
        'const Voice_OFFSET: u32 = 1u;',
        'fn g(Voice_OFFSET_: u32) -> f32 {',
        'return (f32(Voice_OFFSET_) + f32(Voice_OFFSET));',
      ],
      glsl: [
        'const uint Voice_OFFSET = 1u;',
        'float g(uint Voice_OFFSET_) {',
        'return (float(Voice_OFFSET_) + float(Voice_OFFSET));',
      ],
    },
    {
      name: 'a static field, with the parameter written to',
      source: `"use typeshade";
class Voice {
  static OFFSET: u32 = 1;
}
function g(Voice_OFFSET: u32): f32 {
  Voice_OFFSET = Voice_OFFSET + 1;
  return f32(Voice_OFFSET) + f32(Voice.OFFSET);
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(7), 0., 0., 1.);
});
`,
      args: [7],
      value: 9,
      wgsl: [
        'const Voice_OFFSET: u32 = 1u;',
        'fn g(Voice_OFFSET_: u32) -> f32 {',
        'var Voice_OFFSET_1: u32 = Voice_OFFSET_;',
        'return (f32(Voice_OFFSET_1) + f32(Voice_OFFSET));',
      ],
      glsl: [
        'const uint Voice_OFFSET = 1u;',
        'float g(uint Voice_OFFSET_) {',
        'uint Voice_OFFSET_1 = Voice_OFFSET_;',
        'return (float(Voice_OFFSET_1) + float(Voice_OFFSET));',
      ],
    },
    {
      name: 'this in a static member',
      source: `"use typeshade";
class Voice {
  static OFFSET: u32 = 1;
  static at(Voice_OFFSET: u32): f32 {
    return f32(Voice_OFFSET) + f32(this.OFFSET);
  }
}
export const fs = fragment(function fs(): vec4 {
  return vec4(Voice.at(7), 0., 0., 1.);
});
`,
      args: [7],
      value: 8,
      wgsl: [
        'fn Voice_at(Voice_OFFSET_: u32) -> f32 {',
        'return (f32(Voice_OFFSET_) + f32(Voice_OFFSET));',
      ],
      glsl: [
        'float Voice_at(uint Voice_OFFSET_) {',
        'return (float(Voice_OFFSET_) + float(Voice_OFFSET));',
      ],
    },
    {
      name: 'a static field that is a vector',
      source: `"use typeshade";
class Voice {
  static ORIGIN: vec2 = vec2(1., 2.);
}
function g(Voice_ORIGIN: vec2): f32 {
  return Voice_ORIGIN.x + Voice.ORIGIN.y;
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(vec2(10., 20.)), 0., 0., 1.);
});
`,
      args: [[10, 20]],
      value: 12,
      wgsl: [
        'const Voice_ORIGIN: vec2<f32> = vec2<f32>(1.0, 2.0);',
        'fn g(Voice_ORIGIN_: vec2<f32>) -> f32 {',
        'return (Voice_ORIGIN_.x + Voice_ORIGIN.y);',
      ],
      glsl: [
        'const vec2 Voice_ORIGIN = vec2(1.0, 2.0);',
        'float g(vec2 Voice_ORIGIN_) {',
        'return (Voice_ORIGIN_.x + Voice_ORIGIN.y);',
      ],
    },
    {
      name: 'an enum member',
      source: `"use typeshade";
enum E {
  A = 3,
}
function g(E_A: f32): f32 {
  return E_A + f32(E.A);
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(10.), 0., 0., 1.);
});
`,
      args: [10],
      value: 13,
      wgsl: ['const E_A: i32 = 3;', 'fn g(E_A_: f32) -> f32 {', 'return (E_A_ + f32(E_A));'],
      glsl: ['const int E_A = 3;', 'float g(float E_A_) {', 'return (E_A_ + float(E_A));'],
    },
    {
      name: 'a namespace constant',
      source: `"use typeshade";
namespace Ns {
  export const K: f32 = 3.;
}
function g(Ns_K: f32): f32 {
  return Ns_K + Ns.K;
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(10.), 0., 0., 1.);
});
`,
      args: [10],
      value: 13,
      wgsl: ['const Ns_K: f32 = 3.0;', 'fn g(Ns_K_: f32) -> f32 {', 'return (Ns_K_ + Ns_K);'],
      glsl: ['const float Ns_K = 3.0;', 'float g(float Ns_K_) {', 'return (Ns_K_ + Ns_K);'],
    },
  ];

  it.each(CASES)('$name: legal in both halves, and read as the field on every target', (c) => {
    const r = compile(c.source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', c.source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    for (const text of c.wgsl) expect(r.wgsl).toContain(text);
    for (const text of c.glsl) expect(r.glsl!.fragment).toContain(text);
    // The oracle reads the parameter once and the constant once, and the CPU codegen and the
    // debugger read the IR as it does.
    const fn = c.source.includes('static at') ? 'Voice_at' : 'g';
    const args = c.args as never[];
    expect(r.eval(fn, args)).toBe(c.value);
    expect(compileModuleJs(r.module).fns[fn]!(...args)).toBe(c.value);
    const stepped = startDebugSession(r.module, fn, args);
    stepped.continue();
    expect(stepped.done).toBe(true);
    expect(stepped.result).toBe(c.value);
  });

  it('a local of that name is a fresh name in the text, and the field is still the constant', () => {
    const source = `"use typeshade";
class Voice {
  static OFFSET: u32 = 1;
}
function g(): f32 {
  const Voice_OFFSET: u32 = 5;
  return f32(Voice_OFFSET) + f32(Voice.OFFSET);
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(), 0., 0., 1.);
});
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    expect(r.wgsl).toContain('const Voice_OFFSET: u32 = 1u;');
    expect(r.wgsl).toContain('f32(Voice_OFFSET)');
    expect(r.eval('g')).toBe(6);
  });

  describe('where the text cannot tell the parameter from the field, the read stays refused as it was', () => {
    // A module variable is read as a `varref`, which the late rename takes for the parameter's own
    // when the function has one of that name, and an entry's parameter is the plan's, not the
    // helper pass's. Reading the field there would give text that reads the parameter, so these
    // keep the refusal they had, until the writers can tell the two apart.
    const refused = `TS8022 "Voice" has no static field`;
    const messages = (source: string): string[] =>
      compile(source, { fileName: 'm.shade.ts' })
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => `${d.code} ${d.message}`);
    const edited = (source: string): string[] => {
      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', source);
      return service
        .getDiagnostics('m.shade.ts')
        .filter((d) => d.severity === 'error')
        .map((d) => `${String(d.code)} ${d.message}`);
    };

    it('a static field the file writes, in a function with a parameter of that name', () => {
      const source = `"use typeshade";
class Voice {
  static count: u32 = 0;
  static bump(): void {
    Voice.count += 1;
  }
}
function g(Voice_count: u32): f32 {
  return f32(Voice_count) + f32(Voice.count);
}
export const fs = fragment(function fs(): vec4 {
  return vec4(g(7), 0., 0., 1.);
});
`;
      const said = [`${refused} "count".`];
      expect(messages(source)).toEqual(said);
      expect(edited(source)).toEqual(said);
    });

    it('a static field that nothing writes, in an entry with a parameter of that name', () => {
      const source = `"use typeshade";
class Voice {
  static OFFSET: f32 = 1.;
}
export const fs = fragment(function fs(Voice_OFFSET: location<0, f32>): vec4 {
  return vec4(Voice_OFFSET + Voice.OFFSET, 0., 0., 1.);
});
`;
      const said = [`${refused} "OFFSET".`];
      expect(messages(source)).toEqual(said);
      expect(edited(source)).toEqual(said);
    });
  });
});

describe('a call of a function in a function that has a parameter or a local named like the name the module emits for it (#1010)', () => {
  // The module emits `Voice.shift(3)` as the call `Voice_shift(3u)`, `Ns.f(3)` as `Ns_f(3u)`, the
  // instance `pick<u32>` as `pick_u32`, a local function `bump` of `g` as `g_bump` and the copy of
  // `apply` made for `inc` as `apply_inc`. A parameter or a local may have that name (Rule 3.2,
  // change 0039), and the author's call is still the function: the IR tells a `param` from a call.
  // WGSL and GLSL print a call by the bare name, so a parameter of that name in the function would
  // be called instead, and the program would not compile. The writers respell a parameter or a
  // local that hides a function its function calls, as they do for a builtin (Proposal 0070,
  // D-C10-1) and for a constant (#999). The oracle keeps the authored names.
  const FS = (arg: string) => `export const fs = fragment(function fs(): vec4 {
  return vec4(f32(g(${arg})), 0., 0., 1.);
});
`;
  const CASES: readonly {
    name: string;
    source: string;
    args: unknown[];
    value: number;
    wgsl: readonly string[];
    glsl: readonly string[];
  }[] = [
    {
      name: 'a static function',
      source: `"use typeshade";
class Voice {
  static shift(k: u32): u32 {
    return k + 1;
  }
}
function g(Voice_shift: u32): u32 {
  return Voice.shift(3) + Voice_shift;
}
${FS('7')}`,
      args: [7],
      value: 11,
      wgsl: [
        'fn Voice_shift(k: u32) -> u32 {',
        'fn g(Voice_shift_: u32) -> u32 {',
        'return (Voice_shift(3u) + Voice_shift_);',
      ],
      glsl: [
        'uint Voice_shift(uint k) {',
        'uint g(uint Voice_shift_) {',
        'return (Voice_shift(3u) + Voice_shift_);',
      ],
    },
    {
      name: 'a static function, with the parameter written to',
      source: `"use typeshade";
class Voice {
  static shift(k: u32): u32 {
    return k + 1;
  }
}
function g(Voice_shift: u32): u32 {
  Voice_shift = Voice_shift + 1;
  return Voice.shift(3) + Voice_shift;
}
${FS('7')}`,
      args: [7],
      value: 12,
      wgsl: [
        'fn g(Voice_shift_: u32) -> u32 {',
        'var Voice_shift_1: u32 = Voice_shift_;',
        'return (Voice_shift(3u) + Voice_shift_1);',
      ],
      glsl: [
        'uint g(uint Voice_shift_) {',
        'uint Voice_shift_1 = Voice_shift_;',
        'return (Voice_shift(3u) + Voice_shift_1);',
      ],
    },
    {
      name: 'a function of a namespace',
      source: `"use typeshade";
namespace Ns {
  export function f(k: u32): u32 {
    return k + 1;
  }
}
function g(Ns_f: u32): u32 {
  return Ns.f(3) + Ns_f;
}
${FS('7')}`,
      args: [7],
      value: 11,
      wgsl: ['fn Ns_f(k: u32) -> u32 {', 'fn g(Ns_f_: u32) -> u32 {', 'return (Ns_f(3u) + Ns_f_);'],
      glsl: ['uint Ns_f(uint k) {', 'uint g(uint Ns_f_) {', 'return (Ns_f(3u) + Ns_f_);'],
    },
    {
      name: 'a function a namespace declares as a constant',
      source: `"use typeshade";
namespace Ns {
  export const f = (k: u32): u32 => k + 1;
}
function g(Ns_f: u32): u32 {
  return Ns.f(3) + Ns_f;
}
${FS('7')}`,
      args: [7],
      value: 11,
      wgsl: ['fn Ns_f(k: u32) -> u32 {', 'fn g(Ns_f_: u32) -> u32 {', 'return (Ns_f(3u) + Ns_f_);'],
      glsl: ['uint Ns_f(uint k) {', 'uint g(uint Ns_f_) {', 'return (Ns_f(3u) + Ns_f_);'],
    },
    {
      name: 'an instance of a generic function',
      source: `"use typeshade";
function pick<T>(x: T): T {
  return x;
}
function g(pick_u32: u32): u32 {
  return pick<u32>(3) + pick_u32;
}
${FS('7')}`,
      args: [7],
      value: 10,
      wgsl: [
        'fn pick_u32(x: u32) -> u32 {',
        'fn g(pick_u32_: u32) -> u32 {',
        'return (pick_u32(3u) + pick_u32_);',
      ],
      glsl: [
        'uint pick_u32(uint x) {',
        'uint g(uint pick_u32_) {',
        'return (pick_u32(3u) + pick_u32_);',
      ],
    },
    {
      name: 'a local function',
      source: `"use typeshade";
function g(g_bump: u32): u32 {
  function bump(x: u32): u32 {
    return x + 1;
  }
  return bump(3) + g_bump;
}
${FS('7')}`,
      args: [7],
      value: 11,
      wgsl: [
        'fn g_bump(x: u32) -> u32 {',
        'fn g(g_bump_: u32) -> u32 {',
        'return (g_bump(3u) + g_bump_);',
      ],
      glsl: ['uint g_bump(uint x) {', 'uint g(uint g_bump_) {', 'return (g_bump(3u) + g_bump_);'],
    },
    {
      name: 'the copy of a function that takes a function',
      source: `"use typeshade";
function inc(x: u32): u32 {
  return x + 1;
}
function apply(f: (x: u32) => u32, x: u32): u32 {
  return f(x);
}
function g(apply_inc: u32): u32 {
  return apply(inc, 3) + apply_inc;
}
${FS('7')}`,
      args: [7],
      value: 11,
      wgsl: [
        'fn apply_inc(x: u32) -> u32 {',
        'fn g(apply_inc_: u32) -> u32 {',
        'return (apply_inc(3u) + apply_inc_);',
      ],
      glsl: [
        'uint apply_inc(uint x) {',
        'uint g(uint apply_inc_) {',
        'return (apply_inc(3u) + apply_inc_);',
      ],
    },
    {
      name: 'a local of that name, which the optimizer cannot fold',
      source: `"use typeshade";
class Voice {
  static shift(k: u32): u32 {
    return k + 1;
  }
}
function g(a: u32): u32 {
  const Voice_shift: u32 = a + 5;
  return Voice.shift(3) + Voice_shift;
}
${FS('7')}`,
      args: [7],
      value: 16,
      wgsl: [
        'fn g(a: u32) -> u32 {',
        'let Voice_shift_ = (a + 5u);',
        'return (Voice_shift(3u) + Voice_shift_);',
      ],
      glsl: [
        'uint g(uint a) {',
        'uint Voice_shift_ = (a + 5u);',
        'return (Voice_shift(3u) + Voice_shift_);',
      ],
    },
  ];

  it.each(CASES)('$name: legal in both halves, and a call of the function on every target', (c) => {
    const r = compile(c.source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', c.source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    for (const text of c.wgsl) expect(r.wgsl, text).toContain(text);
    for (const text of c.glsl) expect(r.glsl!.fragment, text).toContain(text);
    // The oracle reads the parameter once and calls the function once, and the CPU codegen and
    // the debugger read the IR as it does.
    const args = c.args as never[];
    expect(r.eval('g', args)).toBe(c.value);
    expect(compileModuleJs(r.module).fns['g']!(...args)).toBe(c.value);
    const stepped = startDebugSession(r.module, 'g', args);
    stepped.continue();
    expect(stepped.done).toBe(true);
    expect(stepped.result).toBe(c.value);
  });

  it('keeps the name of a parameter in a function that does not call the function', () => {
    const source = `"use typeshade";
class Voice {
  static shift(k: u32): u32 {
    return k + 1;
  }
}
function g(Voice_shift: u32): u32 {
  return Voice_shift + 1;
}
export const fs = fragment(function fs(): vec4 {
  return vec4(f32(g(7) + Voice.shift(1)), 0., 0., 1.);
});
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn g(Voice_shift: u32) -> u32 {');
    expect(r.glsl!.fragment).toContain('uint g(uint Voice_shift) {');
    expect(r.eval('g', [7])).toBe(8);
  });

  it('respells the parameter of an entry that calls a function of that name, in WGSL and in GLSL', () => {
    // The parameter of an entry is the spelling plan's, not the helper pass's. In GLSL it is a
    // global `in`, which a function of its name would define twice, whether the entry calls the
    // function or not.
    const source = `"use typeshade";
class Voice {
  static shift(k: f32): f32 {
    return k + 1.;
  }
}
export const fs = fragment(function fs(Voice_shift: location<0, f32>): vec4 {
  return vec4(Voice.shift(3.) + Voice_shift, 0., 0., 1.);
});
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    expect(r.wgsl).toContain('fn Voice_shift(k: f32) -> f32 {');
    expect(r.wgsl).toContain('fn fs(@location(0) Voice_shift_: f32) -> @location(0) vec4<f32> {');
    expect(r.wgsl).toContain('return vec4<f32>((Voice_shift(3.0) + Voice_shift_), 0.0, 0.0, 1.0);');
    expect(r.glsl!.fragment).toContain('float Voice_shift(float k) {');
    expect(r.glsl!.fragment).toContain('in float Voice_shift_;');
    expect(r.glsl!.fragment).toContain(
      '_ret = vec4((Voice_shift(3.0) + Voice_shift_), 0.0, 0.0, 1.0);',
    );
    expect(r.eval('fs', [2])).toEqual([6, 0, 0, 1]);
  });

  it('keeps the name of a parameter of a kernel function, which the entry reads from its uniform', () => {
    // The program of the issue. `f` is a kernel function, and its scalar parameter is a field of
    // the uniform of the call, so the call of the function and the field do not meet.
    const source = `"use typeshade";
class Voice {
  static shift(k: u32): u32 {
    return k + 1;
  }
}
export function f(out: array<u32>, Voice_shift: u32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = Voice.shift(3) + Voice_shift;
  }
}
`;
    expect(compile(source, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    const face = hostFace(source, { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    const wgsl = kernel?.kind === 'kernel' ? kernel.face.gpu?.wgsl : undefined;
    expect(wgsl).toContain('Voice_shift: u32,');
    expect(wgsl).toContain('fn Voice_shift(k: u32) -> u32 {');
    expect(wgsl).toContain('out[i] = (Voice_shift(3u) + f_args.Voice_shift);');
  });
});
