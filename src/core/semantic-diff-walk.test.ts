import { describe, it, expect } from 'vitest';
import { boolT, f32T, i32T, vec4fT } from './ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from './ir/index.js';
import { semanticDiff } from './semantic-diff.js';

const num = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const flag = (value: boolean): Expr => ({ op: 'lit', type: boolT, value });
const index = (value: number): Expr => ({ op: 'lit', type: i32T, value });
const named = (op: 'varref' | 'param', name: string, type = f32T): Expr => ({ op, type, name });

const helperOf = (body: readonly Stmt[], params: FuncDecl['params'] = []): FuncDecl => ({
  name: 'helper',
  params,
  ret: { kind: 'void' },
  attrs: [],
  body,
});

const moduleOf = (funcs: readonly FuncDecl[], rest: Partial<ModuleDecl> = {}): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs,
  ...rest,
});

const letOf = (expr: Expr): Stmt => ({ s: 'let', name: 'x', expr });

const emptyModule = moduleOf([helperOf([])]);

const removedFrom = (
  m: ModuleDecl,
  bucket: 'constants' | 'controlFlow',
  ignore: readonly ('names' | 'declOrder')[] = ['names', 'declOrder'],
): string[] =>
  semanticDiff(m, emptyModule, { ignore })
    [bucket].filter((line) => line.startsWith('-'))
    .map((line) => line.slice(1));

const around: ReadonlyArray<readonly [string, (e: Expr) => Expr]> = [
  ['a call argument', (e) => ({ op: 'call', type: f32T, fn: 'g', args: [num(0), e] })],
  ['a construct argument', (e) => ({ op: 'construct', type: vec4fT, args: [num(0), e] })],
  ['the left of a binop', (e) => ({ op: 'binop', type: f32T, bop: '+', a: e, b: num(0) })],
  ['the right of a binop', (e) => ({ op: 'binop', type: f32T, bop: '+', a: num(0), b: e })],
  ['the left of a compare', (e) => ({ op: 'compare', type: boolT, cop: '<', a: e, b: num(0) })],
  ['the right of a compare', (e) => ({ op: 'compare', type: boolT, cop: '<', a: num(0), b: e })],
  [
    'the left of a logical',
    (e) => ({ op: 'logical', type: boolT, lop: '&&', a: e, b: flag(true) }),
  ],
  [
    'the right of a logical',
    (e) => ({ op: 'logical', type: boolT, lop: '&&', a: flag(true), b: e }),
  ],
  ['the operand of a unop', (e) => ({ op: 'unop', type: f32T, a: e })],
  ['the base of a member', (e) => ({ op: 'member', type: f32T, base: e, field: 'x' })],
  ['the base of an index', (e) => ({ op: 'index', type: f32T, base: e, idx: index(0) })],
  ['the index of an index', (e) => ({ op: 'index', type: f32T, base: num(0), idx: e })],
  [
    'the condition of a select',
    (e) => ({ op: 'select', type: f32T, cond: e, ifTrue: num(0), ifFalse: num(0) }),
  ],
  [
    'the true arm of a select',
    (e) => ({ op: 'select', type: f32T, cond: flag(true), ifTrue: e, ifFalse: num(0) }),
  ],
  [
    'the false arm of a select',
    (e) => ({ op: 'select', type: f32T, cond: flag(true), ifTrue: num(0), ifFalse: e }),
  ],
  [
    'the scrutinee of a match',
    (e) => ({ op: 'matchExpr', type: f32T, scrutinee: e, cases: [[0, num(0)]], default: num(0) }),
  ],
  [
    'a case value of a match',
    (e) => ({
      op: 'matchExpr',
      type: f32T,
      scrutinee: index(0),
      cases: [
        [0, num(0)],
        [1, e],
      ],
      default: num(0),
    }),
  ],
  [
    'the default of a match',
    (e) => ({ op: 'matchExpr', type: f32T, scrutinee: index(0), cases: [], default: e }),
  ],
];

describe('semanticDiff — the walk reaches every child of an expression', () => {
  it.each(around)(
    'a changed literal in %s lands in constants and not in controlFlow',
    (_w, wrap) => {
      const d = semanticDiff(
        moduleOf([helperOf([letOf(wrap(num(1)))])]),
        moduleOf([helperOf([letOf(wrap(num(2)))])]),
      );
      expect(d.constants).toEqual(['+lit f32=2', '-lit f32=1']);
      expect(d.controlFlow).toEqual([]);
    },
  );

  it.each(around)(
    'a changed operator in %s lands in controlFlow and not in constants',
    (_w, wrap) => {
      const inner = (bop: '+' | '*'): Expr => ({
        op: 'binop',
        type: f32T,
        bop,
        a: num(0),
        b: num(0),
      });
      const d = semanticDiff(
        moduleOf([helperOf([letOf(wrap(inner('+')))])]),
        moduleOf([helperOf([letOf(wrap(inner('*')))])]),
      );
      expect(d.controlFlow.join('\n')).toContain('(+:f32 ');
      expect(d.controlFlow.join('\n')).toContain('(*:f32 ');
      expect(d.constants).toEqual([]);
    },
  );
});

const leaf = (s: 'break' | 'continue'): Stmt => ({ s });

const nestedAt: ReadonlyArray<readonly [string, string, (s: Stmt) => Stmt]> = [
  ['an if arm', '0.arm0.0', (s) => ({ s: 'if', arms: [{ cond: flag(true), body: [s] }] })],
  [
    'a second if arm',
    '0.arm1.0',
    (s) => ({
      s: 'if',
      arms: [
        { cond: flag(true), body: [] },
        { cond: flag(true), body: [s] },
      ],
    }),
  ],
  [
    'an else body',
    '0.else.0',
    (s) => ({ s: 'if', arms: [{ cond: flag(true), body: [] }], elseBody: [s] }),
  ],
  [
    'a for init',
    '0.init.0',
    (s) => ({ s: 'for', init: s, cond: flag(true), update: { s: 'discard' }, body: [] }),
  ],
  [
    'a for update',
    '0.update.0',
    (s) => ({ s: 'for', init: { s: 'discard' }, cond: flag(true), update: s, body: [] }),
  ],
  [
    'a for body',
    '0.body.0',
    (s) => ({
      s: 'for',
      init: { s: 'discard' },
      cond: flag(true),
      update: { s: 'discard' },
      body: [s],
    }),
  ],
  [
    'a switch case',
    '0.case0.0',
    (s) => ({ s: 'switch', scrut: index(0), cases: [{ values: [0], body: [s] }] }),
  ],
  [
    'a second switch case',
    '0.case1.0',
    (s) => ({
      s: 'switch',
      scrut: index(0),
      cases: [
        { values: [0], body: [] },
        { values: [1], body: [s] },
      ],
    }),
  ],
  [
    'a switch default',
    '0.default.0',
    (s) => ({ s: 'switch', scrut: index(0), cases: [], defaultBody: [s] }),
  ],
];

describe('semanticDiff — a statement line is addressed by its path in the tree', () => {
  it.each(nestedAt)('a statement in %s is named %s', (_where, path, build) => {
    const d = semanticDiff(
      moduleOf([helperOf([build(leaf('break'))])]),
      moduleOf([helperOf([build(leaf('continue'))])]),
    );
    expect(d.controlFlow).toEqual([`+fn#0#${path} continue`, `-fn#0#${path} break`]);
  });

  it('the line of a top-level statement carries its position and the function name', () => {
    const d = semanticDiff(moduleOf([helperOf([leaf('break')])]), emptyModule, { ignore: [] });
    expect(d.controlFlow).toEqual(['-@1 helper#0 break']);
  });
});

describe('semanticDiff — the spelling of a statement and of an expression', () => {
  const k = (name: string): ModuleDecl['consts'][number] => ({
    name,
    type: f32T,
    wgslValue: 1,
    cpuValue: 1,
  });
  const member: Expr = { op: 'member', type: f32T, base: named('param', 'q', vec4fT), field: 'y' };
  const statements: readonly Stmt[] = [
    { s: 'var', name: 'w', type: f32T, init: num(1) },
    { s: 'var', name: 'u', type: f32T },
    { s: 'assign', target: named('varref', 'w'), expr: num(1) },
    { s: 'assignOp', target: named('varref', 'w'), bop: '*', expr: num(1) },
    { s: 'return' },
    { s: 'return', expr: num(1) },
    { s: 'call', expr: { op: 'call', type: f32T, fn: 'helper', args: [num(1)] } },
    {
      s: 'if',
      arms: [
        { cond: flag(true), body: [] },
        { cond: flag(false), body: [] },
      ],
      elseBody: [],
    },
    { s: 'if', arms: [{ cond: flag(true), body: [] }] },
    { s: 'for', init: { s: 'discard' }, cond: flag(true), update: { s: 'continue' }, body: [] },
    {
      s: 'switch',
      scrut: index(0),
      cases: [
        { values: [0, 1], body: [] },
        { values: [2], body: [] },
      ],
      defaultBody: [],
    },
    { s: 'switch', scrut: index(0), cases: [] },
    { s: 'placeholder', tag: 'tag' },
    { s: 'raw', wgsl: 'w' },
    { s: 'raw', glsl: 'g' },
    { s: 'raw', wgsl: 'w', glsl: 'g' },
    leaf('break'),
  ];

  it('every statement kind is spelled by its own fields', () => {
    const m = moduleOf([helperOf(statements, [{ name: 'q', type: vec4fT }])]);
    expect(removedFrom(m, 'controlFlow')).toEqual(
      [
        'fn#0#0 var v#1: f32 = (lit:f32)',
        'fn#0#1 var v#2: f32',
        'fn#0#2 assign (varref v#1:f32) = (lit:f32)',
        'fn#0#3 assign* (varref v#1:f32) = (lit:f32)',
        'fn#0#4 return',
        'fn#0#5 return (lit:f32)',
        'fn#0#6 call (call fn#0:f32 (lit:f32))',
        'fn#0#7 if arms=2 else=y conds=[(lit:bool) (lit:bool)]',
        'fn#0#8 if arms=1 else=n conds=[(lit:bool)]',
        'fn#0#9 for cond=(lit:bool)',
        'fn#0#9.init.0 discard',
        'fn#0#9.update.0 continue',
        'fn#0#10 switch (lit:i32) cases=[0|1,2] default=y',
        'fn#0#11 switch (lit:i32) cases=[] default=n',
        'fn#0#12 placeholder tag',
        'fn#0#13 raw wgsl=y glsl=n',
        'fn#0#14 raw wgsl=n glsl=y',
        'fn#0#15 raw wgsl=y glsl=y',
        'fn#0#16 break',
        'fn fn#0(v#0:vec4<f32>) -> void stage=-',
      ].sort(),
    );
  });

  it('every expression kind is spelled by its own fields', () => {
    const exprs: readonly Expr[] = [
      num(1),
      { op: 'constref', type: f32T, name: 'K' },
      { op: 'overrideref', type: f32T, name: 'N' },
      { op: 'externref', type: f32T, name: 'E' },
      named('param', 'q'),
      named('varref', 'q'),
      { op: 'binop', type: f32T, bop: '-', a: num(1), b: num(1) },
      { op: 'compare', type: boolT, cop: '>=', a: num(1), b: num(1) },
      { op: 'logical', type: boolT, lop: '||', a: flag(true), b: flag(true) },
      { op: 'call', type: f32T, fn: 'helper', args: [num(1)] },
      { op: 'call', type: f32T, fn: 'elsewhere', args: [num(1)] },
      member,
      { op: 'unop', type: f32T, a: num(1) },
      { op: 'construct', type: vec4fT, args: [num(1)] },
      { op: 'select', type: f32T, cond: flag(true), ifTrue: num(1), ifFalse: num(1) },
      { op: 'index', type: f32T, base: named('varref', 'q'), idx: index(0) },
      {
        op: 'matchExpr',
        type: f32T,
        scrutinee: index(0),
        cases: [
          [3, num(1)],
          [4, num(1)],
        ],
        default: num(1),
      },
    ];
    const m = moduleOf(
      [
        helperOf(
          exprs.map((e) => letOf(e)),
          [{ name: 'q', type: vec4fT }],
        ),
      ],
      { consts: [k('K')] },
    );
    const lines = removedFrom(m, 'controlFlow').filter((l) => l.startsWith('fn#0#'));
    expect(lines.map((l) => l.replace(/^fn#0#\d+ let v#1 = /, '')).sort()).toEqual(
      [
        '(lit:f32)',
        '(const k#0:f32)',
        '(override N:f32)',
        '(extern E:f32)',
        '(param v#0:f32)',
        '(varref v#0:f32)',
        '(-:f32 (lit:f32) (lit:f32))',
        '(>=:bool (lit:f32) (lit:f32))',
        '(||:bool (lit:bool) (lit:bool))',
        '(call fn#0:f32 (lit:f32))',
        '(call elsewhere:f32 (lit:f32))',
        '(.y:f32 (param v#0:vec4<f32>))',
        '(unop:f32 (lit:f32))',
        '(construct:vec4<f32> (lit:f32))',
        '(select:f32 (lit:bool) (lit:f32) (lit:f32))',
        '(index:f32 (varref v#0:f32) (lit:i32))',
        '(match:f32 [3,4] (lit:i32) (lit:f32) (lit:f32) (lit:f32))',
      ].sort(),
    );
  });
});
