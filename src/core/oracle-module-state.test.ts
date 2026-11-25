import { describe, expect, it } from 'vitest';
import { bothTake } from './testing/both-halves.js';
import { compileModule } from './oracle.js';
import { f32T, voidT } from './ir/index.js';
import type { BindingDecl, Expr, FuncDecl, ModuleDecl, ModuleVarDecl, Stmt } from './ir/index.js';

const moduleOf = (body: string): ModuleDecl =>
  bothTake(`"use typeshade";\n${body}\n`).result.module;

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string): Expr => ({ op: 'varref', type: f32T, name });
const plus = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b });
const fnOf = (name: string, ret: FuncDecl['ret'], body: Stmt[]): FuncDecl => ({
  name,
  params: [],
  ret,
  body,
});
const irModule = (
  funcs: FuncDecl[],
  extra: { bindings?: BindingDecl[]; vars?: ModuleVarDecl[] },
): ModuleDecl => ({ consts: [], structs: [], bindings: [], funcs, ...extra });

const totalBinding: BindingDecl = {
  group: 0,
  binding: 0,
  name: 'total',
  space: 'storage',
  access: 'read_write',
  type: f32T,
};
const counterVar: ModuleVarDecl = { name: 'counter', space: 'private', type: f32T, init: lit(1) };

describe('oracle: atomicLoad writes nothing back', () => {
  it('a frozen array holds the loaded element and is not written', () => {
    const cpu = compileModule(
      moduleOf(`declare const xs: storage<array<atomic<u32>>, "read_write">;
export function load(): u32 { return atomicLoad(xs[0]); }`),
    );
    cpu.setBinding('xs', Object.freeze([5]) as unknown as number[]);
    expect(cpu.fns['load']!()).toBe(5);
  });
});

describe('oracle: a write to a module-level name that no local shadows', () => {
  const bump = fnOf('bump', voidT, [
    { s: 'assign', target: ref('total'), expr: plus(ref('total'), lit(1)) },
  ]);
  const read = fnOf('read', f32T, [{ s: 'return', expr: ref('total') }]);

  it('a binding written by one call is read by the next', () => {
    const cpu = compileModule(irModule([bump, read], { bindings: [totalBinding] }));
    cpu.setBinding('total', 10);
    cpu.fns['bump']!();
    cpu.fns['bump']!();
    expect(cpu.fns['read']!()).toBe(12);
  });

  it('a module variable written by one call is read by the next call of the same invocation', () => {
    const grow = fnOf('grow', voidT, [
      { s: 'assign', target: ref('counter'), expr: plus(ref('counter'), lit(1)) },
    ]);
    const twice = fnOf('twice', f32T, [
      { s: 'call', expr: { op: 'call', type: voidT, fn: 'grow', args: [] } },
      { s: 'call', expr: { op: 'call', type: voidT, fn: 'grow', args: [] } },
      { s: 'return', expr: ref('counter') },
    ]);
    const cpu = compileModule(irModule([grow, twice], { vars: [counterVar] }));
    expect(cpu.fns['twice']!()).toBe(3);
  });
});

describe('oracle: a local that shadows a module-level name is the frame own', () => {
  const shadowing = (name: string, kind: 'let' | 'var'): FuncDecl =>
    fnOf('shadow', f32T, [
      kind === 'let'
        ? { s: 'let', name, expr: lit(2) }
        : { s: 'var', name, type: f32T, init: lit(2) },
      { s: 'assign', target: ref(name), expr: lit(9) },
      { s: 'return', expr: ref(name) },
    ]);

  it.each(['let', 'var'] as const)('a %s over a binding keeps its own value', (kind) => {
    const cpu = compileModule(irModule([shadowing('total', kind)], { bindings: [totalBinding] }));
    cpu.setBinding('total', 100);
    expect(cpu.fns['shadow']!()).toBe(9);
    const after = compileModule(
      irModule(
        [shadowing('total', kind), fnOf('read', f32T, [{ s: 'return', expr: ref('total') }])],
        { bindings: [totalBinding] },
      ),
    );
    after.setBinding('total', 100);
    after.fns['shadow']!();
    expect(after.fns['read']!()).toBe(100);
  });

  it.each(['let', 'var'] as const)('a %s over a module variable keeps its own value', (kind) => {
    const cpu = compileModule(
      irModule(
        [shadowing('counter', kind), fnOf('read', f32T, [{ s: 'return', expr: ref('counter') }])],
        { vars: [counterVar] },
      ),
    );
    expect(cpu.fns['shadow']!()).toBe(9);
    expect(cpu.fns['read']!()).toBe(1);
  });
});

describe('oracle: overrides', () => {
  const source = `const SCALE: override<f32> = 2.;
export function run(x: f32): f32 { return x * SCALE; }`;

  it('an override reads as its default', () => {
    expect(compileModule(moduleOf(source)).fns['run']!(3)).toBe(6);
  });

  it('opts.overrides replaces the default', () => {
    expect(compileModule(moduleOf(source), { overrides: { SCALE: 5 } }).fns['run']!(3)).toBe(15);
  });

  it('opts.overrides of another name leaves the default', () => {
    expect(compileModule(moduleOf(source), { overrides: { OTHER: 5 } }).fns['run']!(3)).toBe(6);
  });

  it('opts.overrides sizes a workgroup array', () => {
    const cpu = compileModule(
      moduleOf(`const N: override<u32> = 2;
let tile: workgroup<array<f32, N>>;
export function get(i: u32): f32 { return tile[i]; }`),
      { overrides: { N: 6 } },
    );
    expect(cpu.fns['get']!(5)).toBe(0);
  });
});

describe('oracle: module variables', () => {
  const tile = `let tile: workgroup<array<f32, 4>>;
export function put(i: u32, v: f32): void { tile[i] = v; }
export function get(i: u32): f32 { return tile[i]; }`;

  it('a workgroup variable starts zero', () => {
    expect(compileModule(moduleOf(tile)).fns['get']!(2)).toBe(0);
  });

  it('a workgroup variable keeps what one host call wrote for the next', () => {
    const cpu = compileModule(moduleOf(tile));
    cpu.fns['put']!(2, 7);
    expect(cpu.fns['get']!(2)).toBe(7);
    expect(cpu.fns['get']!(1)).toBe(0);
  });

  it('a private variable starts from its initializer at each host call and persists inside one', () => {
    const cpu = compileModule(
      moduleOf(`let seed: u32 = 7;
function bump(): u32 { seed = seed + 1; return seed; }
export function once(): u32 { return bump(); }
export function twice(): u32 { bump(); return bump(); }`),
    );
    expect(cpu.fns['once']!()).toBe(8);
    expect(cpu.fns['twice']!()).toBe(9);
    expect(cpu.fns['once']!()).toBe(8);
  });

  it('a private variable initialised from a constant does not alias the constant', () => {
    const cpu = compileModule(
      moduleOf(`const C: vec2 = vec2(1., 2.);
let v: vec2 = C;
export function run(): f32 { v.x += 10.; return v.x; }`),
    );
    expect(cpu.fns['run']!()).toBe(11);
    expect(cpu.fns['run']!()).toBe(11);
  });
});
