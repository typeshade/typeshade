import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';
import { compileModule } from '../../../core/oracle.js';
import type { CpuValue } from '../../../core/cpu-runtime.js';

const present = (value: CpuValue): CpuValue => ({ value, present: true });
const absent = (value: CpuValue): CpuValue => ({ value, present: false });

const run = (halves: ReturnType<typeof bothTake>, fn: string, ...args: CpuValue[]): CpuValue =>
  compileModule(halves.result.module!).fns[fn]!(...args);

const compareTypes = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) compareTypes(item, found);
  } else if (node !== null && typeof node === 'object') {
    const n = node as { op?: string; cop?: string; type?: { kind: string; elem?: string } };
    if (n.op === 'compare' && n.cop === '==') {
      found.push(n.type?.kind === 'vec' ? `vec of ${String(n.type.elem)}` : String(n.type?.kind));
    }
    for (const value of Object.values(node)) compareTypes(value, found);
  }
  return found;
};

describe('an equality with a vector optional', () => {
  it('compares the components as a vector of bool, whichever operands are optional', () => {
    const halves = bothTake(`"use typeshade";
export function one(a: vec2 | undefined, b: vec2): vec2b { return a === b; }
export function two(a: vec2 | undefined, b: vec2 | undefined): bool { return a === b; }
`);
    expect(compareTypes(halves.result.module).filter((t) => t === 'vec of bool')).toHaveLength(2);
  });
});

describe('v ?? d', () => {
  it('gives d the struct of the position when two structs share a shape', () => {
    const halves = bothTake(`"use typeshade";
interface P { x: f32; y: f32 }
interface R { x: f32; y: f32 }
export function f(v: P | undefined): P { return v ?? { x: 1., y: 2. }; }
export function g(v: R | undefined): R { return v ?? { x: 3., y: 4. }; }
`);
    expect(run(halves, 'f', absent({ x: 0, y: 0 }))).toEqual({ x: 1, y: 2 });
    expect(run(halves, 'g', absent({ x: 0, y: 0 }))).toEqual({ x: 3, y: 4 });
  });

  it('keeps the result optional when d is an optional field path', () => {
    const halves = bothTake(`"use typeshade";
interface H { k?: f32 }
export function f(a: f32 | undefined, h: H): f32 | undefined { return a ?? h.k; }
`);
    expect(run(halves, 'f', absent(0), { k: present(7) })).toEqual(present(7));
    expect(run(halves, 'f', present(2), { k: present(7) })).toEqual(present(2));
  });

  it('reads the left operand as the value when it is never absent', () => {
    const halves = bothTake(`"use typeshade";
export function f(a: f32): f32 { return a ?? 1.; }
`);
    expect(run(halves, 'f', 4)).toBe(4);
  });
});

describe('a member path of a name', () => {
  it('is read as it is on the right of ??, and narrowed through parentheses', () => {
    const halves = bothTake(`"use typeshade";
interface H { k?: f32 }
export function chained(a: f32 | undefined, h: H): f32 { return a ?? h.k ?? 1.; }
export function narrowed(h: H): f32 { if ((h).k !== undefined) { return (h).k; } return 0.; }
`);
    expect(run(halves, 'chained', absent(0), { k: present(7) })).toBe(7);
    expect(run(halves, 'chained', absent(0), { k: absent(0) })).toBe(1);
    expect(run(halves, 'narrowed', { k: present(5) })).toBe(5);
  });
});

describe('v ??= d on an optional field', () => {
  it('assigns the field only when it is absent', () => {
    const halves = bothTake(`"use typeshade";
interface H { k?: f32 }
export function f(a: f32, h: H): f32 { let g: H = h; g.k ??= a; return g.k ?? 0.; }
`);
    expect(run(halves, 'f', 5, { k: absent(0) })).toBe(5);
    expect(run(halves, 'f', 5, { k: present(2) })).toBe(2);
  });
});

describe('an optional chain', () => {
  it('ends at a parenthesis, so the member of the parenthesised chain is un-narrowed', () => {
    bothRefuse(
      `"use typeshade";
interface Q { b: f32 }
interface P { a?: Q }
export function f(o: P | undefined): f32 { return (o?.a).b; }
`,
      'TS8003',
      '"(o?.a)" is "Q | undefined" here, and ".b" needs a Q. Test it first, "if (it !== undefined)", or give the absent case a value, "it ?? Q()".',
    );
  });

  it('reads as a plain member on a value that is always there', () => {
    const halves = bothTake(`"use typeshade";
export function f(p: vec2): f32 { return p?.x; }
`);
    expect(run(halves, 'f', [3, 4])).toBe(3);
  });
});

describe('the result a function with no result type has', () => {
  const resultOf = (body: string): string =>
    /fn f\([^)]*\) -> ([^ ]+) /.exec(compile(`"use typeshade";\n${body}\n`).wgsl ?? '')?.[1] ?? '';

  it('is the value when the closures of its body return an absent value', () => {
    const halves = bothTake(`"use typeshade";
export function f(a: f32) {
  const g = (x: f32): f32 | undefined => { return undefined; };
  return a;
}
export function k(a: f32): f32 { return f(a) + 1.; }
`);
    expect(run(halves, 'k', 1)).toBe(2);
  });

  it('is the value when the last statement is a block that returns', () => {
    const halves = bothTake(`"use typeshade";
export function f(a: f32) { if (a > 0.) { return a * 2.; } { return a; } }
export function k(a: f32): f32 { return f(a) + 1.; }
`);
    expect(run(halves, 'k', 1)).toBe(3);
  });

  it('is the value when the last statement is a discard', () => {
    const source = `function f(a: f32) { if (a > 0.) { return a; } discard; }
@fragment export function fs(uv: location<0, vec2>): vec4 { return vec4(f(uv.x) + 1., 0., 0., 1.); }`;
    expect(resultOf(source)).toBe('f32');
  });

  it('is optional when a switch without a default returns in each clause', () => {
    const halves = bothTake(`"use typeshade";
export function f(a: i32) { switch (a) { case 1: return 1.; case 2: return 2.; } }
export function k(a: i32): f32 { return f(a) ?? 0.; }
`);
    expect(run(halves, 'k', 3)).toBe(0);
    expect(run(halves, 'k', 2)).toBe(2);
  });

  it('is optional when only a loop returns, since a loop falls through', () => {
    const halves = bothTake(`"use typeshade";
export function f(a: f32) { for (let i = 0; i < 4; i++) { return a; } }
export function k(a: f32): f32 { return f(a) ?? 9.; }
`);
    expect(run(halves, 'k', 1)).toBe(1);
  });
});

describe('a widened optional', () => {
  it('runs the call it widens once', () => {
    const halves = bothTake(`"use typeshade";
function g(a: f32): f32 | undefined { return a > 0. ? a : undefined; }
function h(x: f32 | null | undefined): f32 { return x ?? 1.; }
export function f(a: f32): f32 { return h(g(a)); }
`);
    expect(halves.result.wgsl).toContain('h(_opt_widen_struct_opt_f32_(g(a)))');
    expect(run(halves, 'f', 3)).toBe(3);
    expect(run(halves, 'f', -3)).toBe(1);
  });
});

describe('the sentence of a return', () => {
  it('stands on the return statement, where TypeScript reports its TS2322', () => {
    const source = `"use typeshade";
export function f(v: f32 | undefined): f32 {
  return v;
}
`;
    const [d] = compile(source).diagnostics;
    expect(source.slice(d!.start, d!.start + d!.length)).toBe('return v;');
  });
});

describe('null as a value', () => {
  it('needs a position whose type includes null', () => {
    bothRefuse(
      `"use typeshade";
export function f(): f32 | undefined {
  return null;
}
`,
      'TS8003',
      '"null" needs a context whose type includes null (Rule 7.10).',
    );
  });
});
