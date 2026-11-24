import { describe, expect, it } from 'vitest';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import { f32, f32T, fn, module, type ModuleDecl } from '../ir/index.js';
import { ValidationError } from '../passes/validate.js';
import { stampSpans } from '../testing/stamp-spans.js';
import { startDebugSession } from './session.js';

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: 's.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  };
}

const ONE_STATEMENT = `"use typeshade";
export function f(a: f32): f32 {
  return a * 2.;
}
`;

const TWO_STATEMENTS = `"use typeshade";
export function f(a: f32): f32 {
  const b = a * 2.;
  return b;
}
`;

describe('the entry stop and the first breakpoint', () => {
  it('stopOnEntry: false runs to the end when no breakpoint is armed', () => {
    const s = startDebugSession(compiled(TWO_STATEMENTS), 'f', [3], { stopOnEntry: false });
    expect(s.pause).toBeUndefined();
    expect(s.done).toBe(true);
    expect(s.result).toBe(6);
  });

  it('stopOnEntry: false still stops on a breakpoint armed on the first statement', () => {
    const s = startDebugSession(compiled(TWO_STATEMENTS), 'f', [3], {
      stopOnEntry: false,
      breakpoints: [{ line: 2 }],
    });
    expect(s.pause?.reason).toBe('breakpoint');
    expect(s.pause?.span.line).toBe(2);
  });

  it('stopOnEntry: false stops on the first statement of a one-statement entry', () => {
    const s = startDebugSession(compiled(ONE_STATEMENT), 'f', [3], {
      stopOnEntry: false,
      breakpoints: [{ line: 2 }],
    });
    expect(s.pause?.reason).toBe('breakpoint');
    s.continue();
    expect(s.done).toBe(true);
  });
});

describe('a parameter the invocation does not supply', () => {
  const STRUCT_PARAM = `"use typeshade";

class Light {
  gain: f32;
}

export function f(l: Light, a: f32): f32 {
  const b = a;
  return b;
}
`;

  it('reads as an empty object when it is a struct', () => {
    const s = startDebugSession(compiled(STRUCT_PARAM), 'f', []);
    expect(s.pause?.frames[0]?.locals.get('l')).toEqual({});
    expect(s.pause?.frames[0]?.locals.get('a')).toBe(0);
  });
});

describe('the module is validated before it runs', () => {
  it('a module that fails a core rule is rejected with a ValidationError', () => {
    const m = module({
      funcs: [fn('g', {}, f32T, () => f32(0)), fn('g', {}, f32T, () => f32(0))],
    });
    expect(() => startDebugSession(m, 'g')).toThrow(ValidationError);
  });
});

describe('a watch resolves a name the way the run does', () => {
  const SHADOWING = `"use typeshade";

class Uniforms {
  gain: f32;
}

declare const u: uniform<Uniforms>;

export function fs(u: f32): f32 {
  const g = u * 2.;
  return g;
}
`;

  it('a local shadows a binding of the same name', () => {
    const s = startDebugSession(compiled(SHADOWING), 'fs', [5], {
      bindings: { u: { gain: 3 } },
    });
    const answer = s.evaluate('u');
    expect(answer.value).toBe(5);
    expect(answer.type).toEqual(f32T);
  });
});

describe('a watch that throws leaves the run as it was', () => {
  const STUBBED: ModuleDecl = stampSpans({
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      {
        name: 'helper',
        params: [{ name: 'y', type: f32T }],
        ret: f32T,
        body: [{ s: 'return', expr: { op: 'param', type: f32T, name: 'y' } }],
      },
      {
        name: 'fs',
        params: [{ name: 'x', type: f32T }],
        ret: f32T,
        body: [
          { s: 'let', name: 'a', expr: { op: 'param', type: f32T, name: 'x' } },
          {
            s: 'let',
            name: 'b',
            expr: {
              op: 'call',
              type: f32T,
              fn: 'helper',
              args: [{ op: 'varref', type: f32T, name: 'a' }],
            },
          },
          { s: 'return', expr: { op: 'varref', type: f32T, name: 'b' } },
        ],
      },
    ],
  });

  it('shows no extra frame at the next stop after a refused watch', () => {
    const s = startDebugSession(STUBBED, 'fs', [2]);
    expect(() => s.evaluate('dpdx(x)')).toThrow(/GPU-only/);
    s.stepIn();
    expect(s.pause?.frames.map((f) => f.fnName)).toEqual(['fs']);
    s.stepIn();
    expect(s.pause?.frames.map((f) => f.fnName)).toEqual(['helper', 'fs']);
  });
});
