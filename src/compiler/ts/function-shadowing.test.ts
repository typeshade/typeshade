// Verifies: Rule 3.2 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';

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

  describe('where the oracle cannot tell the parameter from the variable, the read stays refused as it was', () => {
    // A module variable is a `varref`, and the IR holds a name once in a function: the oracle, the
    // code generator and the debugger look a `param` and a `varref` up by name in one environment,
    // and the optimizer's inliner substitutes by name. Beside a parameter `Voice_count`, a read of
    // the variable reads the parameter (7 + 7 = 14 for `g(7)` where the field holds 1), whatever the
    // writers print. So these keep the refusal they had, until the IR names the two apart.
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

    it('a static field the file writes, in an entry with a parameter of that name', () => {
      const source = `"use typeshade";
class Voice {
  static count: f32 = 0.;
  static bump(): void {
    Voice.count += 1.;
  }
}
export const fs = fragment(function fs(Voice_count: location<0, f32>): vec4 {
  Voice.bump();
  return vec4(Voice_count + Voice.count, 0., 0., 1.);
});
`;
      const said = [`${refused} "count".`];
      expect(messages(source)).toEqual(said);
      expect(edited(source)).toEqual(said);
    });
  });
});

describe('a read of a static field, an enum member or a namespace constant in an entry that has a parameter named like the name the module emits for it (#1009)', () => {
  // An entry's parameters are the spelling plan's: `sanitizeVariableNames` leaves them, and the
  // host sees them. So the plan gives the constant a fresh spelling where an entry reads it under
  // the name of one of its own parameters, and the parameter keeps its name. WGSL would print the
  // parameter for the constant, and GLSL ES 3.00 declares an entry's inputs at module scope,
  // beside the constant, which it declares twice. The oracle keeps the authored names, and its
  // `constref` is no parameter (Rule 3.2).
  const CASES: readonly {
    name: string;
    source: string;
    args: unknown[];
    value: number[];
    wgsl: readonly string[];
    glsl: readonly string[];
  }[] = [
    {
      name: 'a static field',
      source: `"use typeshade";
class Voice {
  static OFFSET: f32 = 1.;
}
export const fs = fragment(function fs(Voice_OFFSET: location<0, f32>): vec4 {
  return vec4(Voice_OFFSET + Voice.OFFSET, 0., 0., 1.);
});
`,
      args: [3],
      value: [4, 0, 0, 1],
      wgsl: [
        'const Voice_OFFSET_: f32 = 1.0;',
        'fn fs(@location(0) Voice_OFFSET: f32)',
        'vec4<f32>((Voice_OFFSET + Voice_OFFSET_), 0.0, 0.0, 1.0)',
      ],
      glsl: [
        'const float Voice_OFFSET_ = 1.0;',
        'in float Voice_OFFSET;',
        'vec4((Voice_OFFSET + Voice_OFFSET_), 0.0, 0.0, 1.0)',
      ],
    },
    {
      name: 'a static field that is a vector',
      source: `"use typeshade";
class Voice {
  static ORIGIN: vec2 = vec2(1., 2.);
}
export const fs = fragment(function fs(Voice_ORIGIN: location<0, vec2>): vec4 {
  return vec4(Voice_ORIGIN + Voice.ORIGIN, 0., 1.);
});
`,
      args: [[10, 20]],
      value: [11, 22, 0, 1],
      wgsl: [
        'const Voice_ORIGIN_: vec2<f32> = vec2<f32>(1.0, 2.0);',
        'fn fs(@location(0) Voice_ORIGIN: vec2<f32>)',
        '(Voice_ORIGIN + Voice_ORIGIN_)',
      ],
      glsl: [
        'const vec2 Voice_ORIGIN_ = vec2(1.0, 2.0);',
        'in vec2 Voice_ORIGIN;',
        '(Voice_ORIGIN + Voice_ORIGIN_)',
      ],
    },
    {
      name: 'an enum member',
      source: `"use typeshade";
enum E {
  A = 3,
}
export const fs = fragment(function fs(E_A: location<0, f32>): vec4 {
  return vec4(E_A + f32(E.A), 0., 0., 1.);
});
`,
      args: [10],
      value: [13, 0, 0, 1],
      wgsl: [
        'const E_A_: i32 = 3;',
        'fn fs(@location(0) E_A: f32)',
        'vec4<f32>((E_A + f32(E_A_)), 0.0, 0.0, 1.0)',
      ],
      glsl: ['const int E_A_ = 3;', 'in float E_A;', 'vec4((E_A + float(E_A_)), 0.0, 0.0, 1.0)'],
    },
    {
      name: 'a namespace constant',
      source: `"use typeshade";
namespace Ns {
  export const K: f32 = 3.;
}
export const fs = fragment(function fs(Ns_K: location<0, f32>): vec4 {
  return vec4(Ns_K + Ns.K, 0., 0., 1.);
});
`,
      args: [10],
      value: [13, 0, 0, 1],
      wgsl: [
        'const Ns_K_: f32 = 3.0;',
        'fn fs(@location(0) Ns_K: f32)',
        'vec4<f32>((Ns_K + Ns_K_), 0.0, 0.0, 1.0)',
      ],
      glsl: ['const float Ns_K_ = 3.0;', 'in float Ns_K;', 'vec4((Ns_K + Ns_K_), 0.0, 0.0, 1.0)'],
    },
    {
      name: 'a static field read by the entry and by a helper whose parameter has the name',
      source: `"use typeshade";
class Voice {
  static OFFSET: f32 = 1.;
}
function g(Voice_OFFSET: f32): f32 {
  return Voice_OFFSET + Voice.OFFSET;
}
export const fs = fragment(function fs(Voice_OFFSET: location<0, f32>): vec4 {
  return vec4(g(Voice_OFFSET) + Voice.OFFSET, 0., 0., 1.);
});
`,
      args: [3],
      value: [5, 0, 0, 1],
      wgsl: [
        'const Voice_OFFSET_: f32 = 1.0;',
        'fn fs(@location(0) Voice_OFFSET: f32)',
        '(g(Voice_OFFSET) + Voice_OFFSET_)',
      ],
      glsl: [
        'const float Voice_OFFSET_ = 1.0;',
        'in float Voice_OFFSET;',
        '(g(Voice_OFFSET) + Voice_OFFSET_)',
      ],
    },
  ];

  it.each(CASES)('$name: legal in both halves, and read as the constant on every target', (c) => {
    const r = compile(c.source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', c.source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    for (const text of c.wgsl) expect(r.wgsl).toContain(text);
    for (const text of c.glsl) expect(r.glsl!.fragment).toContain(text);
    // The oracle reads the parameter once and the constant once, and the CPU codegen and the
    // debugger read the IR as it does.
    const args = c.args as never[];
    expect(r.eval('fs', args)).toEqual(c.value);
    expect(compileModuleJs(r.module).fns.fs!(...args)).toEqual(c.value);
    const stepped = startDebugSession(r.module, 'fs', args);
    stepped.continue();
    expect(stepped.done).toBe(true);
    expect(stepped.result).toEqual(c.value);
  });

  it('a compute entry and a vertex entry get the same spelling, and one entry that does not read the constant keeps it', () => {
    const source = `"use typeshade";
class Voice {
  static OFFSET: u32 = 1;
}
declare const data: storage<array<u32>, "read_write">;
export const fill = compute([4], function fill(Voice_OFFSET: builtin<"global_invocation_id", vec3u>) {
  data[Voice_OFFSET.x] = Voice_OFFSET.x + Voice.OFFSET;
});
export const vs = vertex(function vs(Voice_OFFSET: location<0, vec2>): vec4 {
  return vec4(Voice_OFFSET + vec2(f32(Voice.OFFSET)), 0., 1.);
});
export const idle = compute([4], function idle(Voice_OFFSET: builtin<"global_invocation_id", vec3u>) {
  data[Voice_OFFSET.x] = 0;
});
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    // One constant, one spelling, whichever entry reads it; every entry keeps its own parameter.
    expect(r.wgsl).toContain('const Voice_OFFSET_: u32 = 1u;');
    expect(r.wgsl).not.toContain('const Voice_OFFSET:');
    expect(r.wgsl).toContain('fn fill(@builtin(global_invocation_id) Voice_OFFSET: vec3<u32>)');
    expect(r.wgsl).toContain('data[Voice_OFFSET.x] = (Voice_OFFSET.x + Voice_OFFSET_);');
    expect(r.wgsl).toContain('fn vs(@location(0) Voice_OFFSET: vec2<f32>)');
    expect(r.wgsl).toContain('fn idle(@builtin(global_invocation_id) Voice_OFFSET: vec3<u32>)');
    expect(r.glsl!.vertex).toContain('const uint Voice_OFFSET_ = 1u;');
    expect(r.glsl!.vertex).toContain('in vec2 Voice_OFFSET;');
  });
});
