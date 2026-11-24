import { describe, it, expect } from 'vitest';
import { externRef, f32T, fn, module } from './ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from './ir/index.js';
import { isSemanticallyEqual, semanticDiff } from './semantic-diff.js';
import type { EmitPlugin } from './emit.js';

const lit: Expr = { op: 'lit', type: f32T, value: 1 };
const cond: Expr = { op: 'lit', type: { kind: 'scalar', scalar: 'bool' }, value: true };
const scrut: Expr = { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: 0 };

const helperWith = (body: readonly Stmt[]): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [{ name: 'helper', params: [], ret: { kind: 'void' }, attrs: [], body }],
});

const letIn = (name: string): Stmt => ({ s: 'let', name, expr: lit });

const nestedBodies: ReadonlyArray<readonly [string, (name: string) => Stmt[]]> = [
  ['an if arm', (n) => [{ s: 'if', arms: [{ cond, body: [letIn(n)] }] }]],
  ['an else body', (n) => [{ s: 'if', arms: [{ cond, body: [] }], elseBody: [letIn(n)] }]],
  ['a for init', (n) => [{ s: 'for', init: letIn(n), cond, update: { s: 'break' }, body: [] }]],
  [
    'a for body',
    (n) => [{ s: 'for', init: { s: 'break' }, cond, update: { s: 'break' }, body: [letIn(n)] }],
  ],
  ['a switch case', (n) => [{ s: 'switch', scrut, cases: [{ values: [0], body: [letIn(n)] }] }]],
  ['a switch default', (n) => [{ s: 'switch', scrut, cases: [], defaultBody: [letIn(n)] }]],
];

describe('semanticDiff — canonical naming reaches nested bodies', () => {
  it.each(nestedBodies)('a local declared in %s is renamed without a diff', (_where, build) => {
    const a = helperWith(build('first'));
    const b = helperWith(build('second'));
    expect(isSemanticallyEqual(semanticDiff(a, b))).toBe(true);
    expect(isSemanticallyEqual(semanticDiff(a, b, { ignore: ['declOrder'] }))).toBe(false);
  });
});

const computeWith = (workgroupSize: number | readonly number[]): ModuleDecl =>
  module({ funcs: [fn('cs', {}, () => {}, { stage: 'compute', workgroupSize })] });

describe('semanticDiff — the workgroup shape is spelled with only the extents that differ from 1', () => {
  it.each([
    [64, 'wg=64 '],
    [[8, 8], 'wg=8x8 '],
    [[4, 1, 2], 'wg=4x1x2 '],
  ] as const)('workgroup %j reads %s', (size, spelling) => {
    const d = semanticDiff(computeWith(1), computeWith(size as number | readonly number[]));
    expect(d.interface.join('\n')).toContain(`+entry cs stage=compute ${spelling}`);
  });

  it('a [64, 1, 1] shape and a plain 64 are one fact', () => {
    expect(isSemanticallyEqual(semanticDiff(computeWith(64), computeWith([64, 1, 1])))).toBe(true);
  });
});

const readsExtern = (name: string): ModuleDecl =>
  module({ funcs: [fn('read', {}, () => externRef(name, f32T).add(1.0), { stage: 'vertex' })] });

describe('semanticDiff — a host-provided global name is ABI', () => {
  it('a renamed extern differs under the default ignore set', () => {
    const d = semanticDiff(readsExtern('hostA'), readsExtern('hostB'));
    expect(d.controlFlow.join('\n')).toContain('(extern hostA:f32)');
    expect(d.controlFlow.join('\n')).toContain('(extern hostB:f32)');
  });
});

const structModule = (innerName: string): ModuleDecl => {
  const inner: StructDecl = { name: innerName, fields: [{ name: 'x', type: f32T }] };
  const outer: StructDecl = {
    name: 'Outer',
    fields: [{ name: 'in', type: { kind: 'struct', name: innerName } }],
  };
  return {
    consts: [],
    structs: [inner, outer],
    bindings: [
      {
        group: 0,
        binding: 0,
        name: 'u',
        space: 'uniform',
        type: { kind: 'struct', name: 'Outer' },
      },
    ],
    funcs: [],
  };
};

describe('semanticDiff — a nested non-binding struct is canonicalized inside a layout', () => {
  it('renaming it changes nothing under names, and shows under ignore []', () => {
    expect(isSemanticallyEqual(semanticDiff(structModule('InnerA'), structModule('InnerB')))).toBe(
      true,
    );
    const d = semanticDiff(structModule('InnerA'), structModule('InnerB'), {
      ignore: ['declOrder'],
    });
    expect(d.resources.join('\n')).toContain('struct:InnerA');
    expect(d.resources.join('\n')).toContain('struct:InnerB');
  });
});

const withConst = (m: ModuleDecl, name: string): ModuleDecl => ({
  ...m,
  consts: [...m.consts, { name, type: f32T, wgslValue: 1, cpuValue: 1 }],
});

describe('semanticDiff — a transform step attributes only the lines it resolves', () => {
  const adding: EmitPlugin = {
    name: 'adding',
    transformIR: (m) => withConst(m, 'introduced'),
  };
  const funcs: FuncDecl[] = [];
  const a = withConst({ consts: [], structs: [], bindings: [], funcs }, 'first');
  const b = { consts: [], structs: [], bindings: [], funcs } as ModuleDecl;

  it('a line the step introduces stays in its bucket and is not explained', () => {
    const d = semanticDiff(a, b, { transforms: [adding] });
    expect(d.explained).toEqual([]);
    expect(d.constants.some((l) => l.startsWith('-const k#1 '))).toBe(true);
  });
});
