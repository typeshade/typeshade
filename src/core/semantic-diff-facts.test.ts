import { describe, it, expect } from 'vitest';
import { boolT, f32T } from './ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt, StructDecl } from './ir/index.js';
import { isSemanticallyEqual, semanticDiff } from './semantic-diff.js';
import type { EmitPlugin } from './emit.js';

const num = (value: number, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value });

const funcOf = (name: string, body: readonly Stmt[], rest: Partial<FuncDecl> = {}): FuncDecl => ({
  name,
  params: [],
  ret: { kind: 'void' },
  attrs: [],
  body,
  ...rest,
});

const moduleOf = (funcs: readonly FuncDecl[], rest: Partial<ModuleDecl> = {}): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs,
  ...rest,
});

const lets = (count: number): Stmt[] =>
  Array.from({ length: count }, (_, i) => ({ s: 'let', name: `x${i}`, expr: num(1) }));

const helperWithLets = (count: number): ModuleDecl => moduleOf([funcOf('helper', lets(count))]);

describe('semanticDiff — a repeated fact is counted, in both directions', () => {
  it('two copies of a literal against one report one removed line', () => {
    expect(semanticDiff(helperWithLets(2), helperWithLets(1)).constants).toEqual(['-lit f32=1']);
  });

  it('one copy of a literal against three reports two added lines', () => {
    expect(semanticDiff(helperWithLets(1), helperWithLets(3)).constants).toEqual([
      '+lit f32=1',
      '+lit f32=1',
    ]);
  });

  it('equal counts report nothing', () => {
    expect(semanticDiff(helperWithLets(3), helperWithLets(3)).constants).toEqual([]);
  });
});

const dropOneLet: EmitPlugin = {
  name: 'drop-one-let',
  transformIR: (m) => ({
    ...m,
    funcs: m.funcs.map((f) => ({ ...f, body: f.body.slice(1) })),
  }),
};

const addOneLet: EmitPlugin = {
  name: 'add-one-let',
  transformIR: (m) => ({
    ...m,
    funcs: m.funcs.map((f) => ({ ...f, body: [...f.body, ...lets(1)] })),
  }),
};

describe('semanticDiff — a transform step explains the multiset of lines it resolves', () => {
  it('a step that removes one of two equal lines explains one and leaves one', () => {
    const d = semanticDiff(helperWithLets(2), helperWithLets(0), { transforms: [dropOneLet] });
    expect(d.explained.filter((e) => e.bucket === 'constants')).toEqual([
      { transform: 'drop-one-let', bucket: 'constants', line: '-lit f32=1' },
    ]);
    expect(d.constants).toEqual(['-lit f32=1']);
  });

  it('a step that removes both of two equal lines explains both', () => {
    const dropAll: EmitPlugin = {
      name: 'drop-all',
      transformIR: (m) => ({ ...m, funcs: m.funcs.map((f) => ({ ...f, body: [] })) }),
    };
    const d = semanticDiff(helperWithLets(2), helperWithLets(0), { transforms: [dropAll] });
    expect(d.explained.filter((e) => e.bucket === 'constants').map((e) => e.line)).toEqual([
      '-lit f32=1',
      '-lit f32=1',
    ]);
    expect(d.constants).toEqual([]);
  });

  it('a step that supplies one of two missing lines explains an added line', () => {
    const d = semanticDiff(helperWithLets(0), helperWithLets(2), { transforms: [addOneLet] });
    expect(d.explained.filter((e) => e.bucket === 'constants')).toEqual([
      { transform: 'add-one-let', bucket: 'constants', line: '+lit f32=1' },
    ]);
    expect(d.constants).toEqual(['+lit f32=1']);
  });

  it('entries come in the order of the buckets within one step, and in step order', () => {
    const d = semanticDiff(helperWithLets(2), helperWithLets(0), {
      transforms: [dropOneLet, dropOneLet],
    });
    expect(d.explained.map((e) => `${e.transform}:${e.bucket}`)).toEqual([
      'drop-one-let:constants',
      'drop-one-let:controlFlow',
      'drop-one-let:constants',
      'drop-one-let:controlFlow',
    ]);
    expect(isSemanticallyEqual(d)).toBe(true);
  });

  it('a step is named by its identity when it has one and by its name otherwise', () => {
    const named: EmitPlugin = { ...dropOneLet, name: 'plain-name' };
    const identified: EmitPlugin = { ...dropOneLet, name: 'plain-name', identity: 'the-identity' };
    const withName = semanticDiff(helperWithLets(1), helperWithLets(0), { transforms: [named] });
    const withIdentity = semanticDiff(helperWithLets(1), helperWithLets(0), {
      transforms: [identified],
    });
    expect(new Set(withName.explained.map((e) => e.transform))).toEqual(new Set(['plain-name']));
    expect(new Set(withIdentity.explained.map((e) => e.transform))).toEqual(
      new Set(['the-identity']),
    );
  });
});

const computeOf = (rest: Partial<FuncDecl>): ModuleDecl =>
  moduleOf([funcOf('cs', [], { stage: 'compute', workgroupSize: 8, ...rest })]);

const entryLines = (m: ModuleDecl): string[] =>
  semanticDiff(m, moduleOf([])).interface.map((l) => l.replace(/^-/, ''));

describe('semanticDiff — the entry line', () => {
  it('a compute entry without override names carries no bracket', () => {
    expect(entryLines(computeOf({}))[0]).toMatch(/^entry cs stage=compute wg=8 in=\[\] /);
  });

  it('override names are listed per axis, with a dash for an axis that has none', () => {
    const m = computeOf({
      workgroupShape: [8, 4, 1],
      workgroupSizeOverrides: ['N', undefined, 'M'],
    });
    expect(entryLines(m)[0]).toMatch(/^entry cs stage=compute wg=8x4\[N,-,M\] in=\[\] /);
  });

  it('a non-compute entry has no workgroup shape', () => {
    const m = moduleOf([funcOf('vs', [], { stage: 'vertex' })]);
    expect(entryLines(m)[0]).toMatch(/^entry vs stage=vertex wg=- /);
  });
});

const structNamed = (name: string): StructDecl => ({ name, fields: [{ name: 'x', type: f32T }] });

const arrayOfStruct = (name: string): ShaderType => ({
  kind: 'array',
  elem: { kind: 'struct', name },
  size: 4,
});

const withArrayVar = (type: ShaderType, structName: string): ModuleDecl =>
  moduleOf([funcOf('helper', [{ s: 'var', name: 'xs', type }])], {
    structs: [structNamed(structName)],
  });

describe('semanticDiff — canonical names inside a type', () => {
  it('a struct renamed inside an array element type changes nothing under names', () => {
    const a = withArrayVar(arrayOfStruct('ItemA'), 'ItemA');
    const b = withArrayVar(arrayOfStruct('ItemB'), 'ItemB');
    expect(isSemanticallyEqual(semanticDiff(a, b))).toBe(true);
    const spelled = semanticDiff(a, b, { ignore: ['declOrder'] }).controlFlow.join('\n');
    expect(spelled).toContain('ItemA');
    expect(spelled).toContain('ItemB');
  });

  it('a struct renamed inside an array of arrays changes nothing under names', () => {
    const nest = (name: string): ShaderType => ({
      kind: 'array',
      elem: arrayOfStruct(name),
      size: 2,
    });
    expect(
      isSemanticallyEqual(
        semanticDiff(withArrayVar(nest('ItemA'), 'ItemA'), withArrayVar(nest('ItemB'), 'ItemB')),
      ),
    ).toBe(true);
  });

  it('an array of scalars keeps its own spelling', () => {
    const scalars: ShaderType = { kind: 'array', elem: f32T, size: 4 };
    const d = semanticDiff(
      withArrayVar(scalars, 'ItemA'),
      withArrayVar(arrayOfStruct('ItemA'), 'ItemA'),
    );
    expect(d.controlFlow.join('\n')).toContain('array<f32');
  });
});

const entryBody = (paramName: string): FuncDecl =>
  funcOf('main', [{ s: 'let', name: 'y', expr: { op: 'param', type: f32T, name: paramName } }], {
    stage: 'vertex',
    params: [{ name: paramName, type: f32T, location: 0 }],
  });

const helperTaking = (paramName: string): FuncDecl =>
  funcOf('helper', [{ s: 'let', name: 'y', expr: { op: 'param', type: f32T, name: paramName } }], {
    params: [{ name: paramName, type: f32T }],
  });

describe('semanticDiff — only helper functions are renamed', () => {
  it('a renamed entry function shows in the control flow as authored', () => {
    const d = semanticDiff(
      moduleOf([funcOf('vsA', [], { stage: 'vertex' })]),
      moduleOf([funcOf('vsB', [], { stage: 'vertex' })]),
    );
    expect(d.controlFlow).toEqual([
      '+fn vsB() -> void stage=vertex',
      '-fn vsA() -> void stage=vertex',
    ]);
  });

  it('a renamed entry parameter is a difference, in its header and in its uses', () => {
    const d = semanticDiff(moduleOf([entryBody('p')]), moduleOf([entryBody('q')]));
    expect(d.controlFlow).toEqual([
      '+fn main(q:f32@loc0) -> void stage=vertex',
      '+main#0 let v#0 = (param q:f32)',
      '-fn main(p:f32@loc0) -> void stage=vertex',
      '-main#0 let v#0 = (param p:f32)',
    ]);
  });

  it('a renamed entry parameter is a difference even when the body declares the same name', () => {
    const shadowing = (name: string): FuncDecl =>
      funcOf('main', [{ s: 'let', name, expr: num(1) }], {
        stage: 'vertex',
        params: [{ name, type: f32T, location: 0 }],
      });
    const d = semanticDiff(moduleOf([shadowing('p')]), moduleOf([shadowing('q')]));
    expect(d.controlFlow).toContain('-fn main(p:f32@loc0) -> void stage=vertex');
    expect(d.controlFlow).toContain('+fn main(q:f32@loc0) -> void stage=vertex');
  });

  it('a renamed helper parameter is not a difference', () => {
    expect(
      isSemanticallyEqual(
        semanticDiff(moduleOf([helperTaking('p')]), moduleOf([helperTaking('q')])),
      ),
    ).toBe(true);
  });
});

describe('semanticDiff — the spelling of constants', () => {
  it('a module const, with and without a value expression, and an override', () => {
    const m = moduleOf([], {
      consts: [
        { name: 'A', type: f32T, wgslValue: 1.5, cpuValue: 2.5 },
        {
          name: 'B',
          type: f32T,
          wgslValue: 0,
          cpuValue: 0,
          valueExpr: { op: 'constref', type: f32T, name: 'A' },
        },
      ],
      overrides: [{ name: 'N', type: f32T, default: 3 }],
    });
    expect(semanticDiff(m, moduleOf([]), { ignore: [] }).constants.sort()).toEqual(
      [
        '-@0 override N f32 = 3',
        '-@1 const A f32 wgsl=1.5 cpu=2.5',
        '-@2 const B f32 wgsl=0 cpu=0 expr=(const A:f32)',
      ].sort(),
    );
    expect(semanticDiff(m, moduleOf([])).constants).toContain(
      '-const k#1 f32 wgsl=0 cpu=0 expr=(const k#0:f32)',
    );
  });

  it('a literal is spelled by its type and its value', () => {
    const m = moduleOf([
      funcOf('helper', [
        { s: 'let', name: 'a', expr: num(0.5) },
        { s: 'let', name: 'b', expr: { op: 'lit', type: boolT, value: true } },
      ]),
    ]);
    expect(semanticDiff(m, moduleOf([funcOf('helper', [])])).constants).toEqual([
      '-lit bool=true',
      '-lit f32=0.5',
    ]);
  });
});
