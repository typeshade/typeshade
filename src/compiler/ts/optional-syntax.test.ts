import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { Expr, FuncDecl, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { boolT, f32T, i32T, u32T, vec2fT } from '../../core/ir/types.js';
import {
  absentLiteral,
  absentRemedyValue,
  fitsOptional,
  isOmittableField,
  isUndefinedLiteral,
  markOmittableField,
  optionalDeclaredType,
  optionalT,
  optionalTestOperand,
  optionalWithin,
  orderedStructDecls,
  presenceTest,
  refusedOptionalPosition,
  refuseOptionalAt,
  typesOfFunctions,
  usedOptionalDecls,
  writesUndefinedUnion,
  type StructLookup,
} from './optional.js';

const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true);
const expressionOf = (text: string): ts.Expression =>
  (parse(`(${text});`).statements[0] as ts.ExpressionStatement).expression;
const binaryOf = (text: string): ts.BinaryExpression =>
  (expressionOf(text) as ts.ParenthesizedExpression).expression as ts.BinaryExpression;
const typeNodeOf = (text: string): ts.TypeNode =>
  (parse(`let x: ${text};`).statements[0] as ts.VariableStatement).declarationList.declarations[0]!
    .type!;
const spell = (t: ShaderType): string =>
  t.kind === 'struct' ? t.name : t.kind === 'vec' ? `vec${t.n}<f32>` : String(typeOfKey(t));
const typeOfKey = (t: ShaderType): string =>
  t.kind === 'scalar' ? t.scalar : t.kind === 'array' ? `array<${typeOfKey(t.elem)}>` : t.kind;
const structsOf =
  (...decls: StructDecl[]): StructLookup =>
  (name) =>
    decls.find((d) => d.name === name);

describe('optional syntax readers', () => {
  it('sees undefined through parentheses, and nothing else', () => {
    expect(isUndefinedLiteral(expressionOf('undefined'))).toBe(true);
    expect(isUndefinedLiteral(expressionOf('((undefined))'))).toBe(true);
    expect(isUndefinedLiteral(expressionOf('null'))).toBe(false);
    expect(isUndefinedLiteral(expressionOf('x'))).toBe(false);
    expect(absentLiteral(expressionOf('(undefined)'))).toBe(1);
    expect(absentLiteral(expressionOf('(null)'))).toBe(2);
    expect(absentLiteral(expressionOf('0'))).toBeUndefined();
  });

  it('takes the operand of a strict or loose comparison with an absent literal', () => {
    for (const text of ['v === undefined', 'v !== undefined', 'v == null', 'v != undefined']) {
      expect(optionalTestOperand(binaryOf(text))!.getText()).toBe('v');
    }
    expect(optionalTestOperand(binaryOf('undefined === v'))!.getText()).toBe('v');
    expect(optionalTestOperand(binaryOf('(null) !== v'))!.getText()).toBe('v');
    expect(optionalTestOperand(binaryOf('v < undefined'))).toBeUndefined();
    expect(optionalTestOperand(binaryOf('v === w'))).toBeUndefined();
  });

  it('reads an undefined union member off the syntax through parentheses only', () => {
    expect(writesUndefinedUnion(typeNodeOf('f32 | undefined'))).toBe(true);
    expect(writesUndefinedUnion(typeNodeOf('(f32 | undefined)'))).toBe(true);
    expect(writesUndefinedUnion(typeNodeOf('f32 | null'))).toBe(false);
    expect(writesUndefinedUnion(typeNodeOf('Alias'))).toBe(false);
    expect(writesUndefinedUnion(undefined)).toBe(false);
  });

  it('spells the absent value of a remedy by type', () => {
    expect(absentRemedyValue(f32T, spell)).toBe('0.');
    expect(absentRemedyValue(i32T, spell)).toBe('0');
    expect(absentRemedyValue(u32T, spell)).toBe('0');
    expect(absentRemedyValue(boolT, spell)).toBe('false');
    expect(absentRemedyValue(vec2fT, spell)).toBe('vec2()');
    expect(absentRemedyValue({ kind: 'struct', name: 'Ray' }, spell)).toBe('Ray()');
  });

  it('writes a presence test that excludes every absent value of the type', () => {
    expect(presenceTest('v', optionalT(f32T))).toBe('v !== undefined');
    expect(presenceTest('v', optionalT(f32T, 2))).toBe('v !== null');
    expect(presenceTest('v', optionalT(f32T, 3))).toBe('v != null');
  });

  it('widens a value into an optional of the same payload only when no absence is added', () => {
    expect(fitsOptional(f32T, optionalT(f32T))).toBe(true);
    expect(fitsOptional(f32T, f32T)).toBe(false);
    expect(fitsOptional(i32T, optionalT(f32T))).toBe(false);
    expect(fitsOptional(optionalT(f32T), optionalT(f32T, 3))).toBe(true);
    expect(fitsOptional(optionalT(f32T, 3), optionalT(f32T))).toBe(false);
    expect(fitsOptional(optionalT(f32T, 2), optionalT(f32T))).toBe(false);
  });

  it('keeps the omittable fields per file, struct and field', () => {
    const one = parse('');
    const two = parse('');
    markOmittableField(one, 'U', 'w');
    expect(isOmittableField(one, 'U', 'w')).toBe(true);
    expect(isOmittableField(one, 'U', 'x')).toBe(false);
    expect(isOmittableField(one, 'V', 'w')).toBe(false);
    expect(isOmittableField(two, 'U', 'w')).toBe(false);
  });
});

describe('optional positions and declarations', () => {
  const holder: StructDecl = { name: 'U', fields: [{ name: 'w', type: optionalT(f32T) }] };

  it('finds the first optional in field order, depth first, with its path', () => {
    const structs = structsOf(holder, {
      name: 'V',
      fields: [
        { name: 'a', type: f32T },
        { name: 'u', type: { kind: 'struct', name: 'U' } },
      ],
    });
    expect(optionalWithin(optionalT(f32T), structs)).toMatchObject({ path: '', inner: f32T });
    expect(optionalWithin({ kind: 'struct', name: 'V' }, structs)!.path).toBe('.u.w');
    expect(
      optionalWithin({ kind: 'array', elem: { kind: 'struct', name: 'U' }, size: 2 }, structs)!
        .path,
    ).toBe('[i].w');
    expect(optionalWithin(f32T, structs)).toBeUndefined();
    expect(optionalWithin(undefined, structs)).toBeUndefined();
  });

  it('stops at a struct that holds itself', () => {
    const loop: StructDecl = {
      name: 'L',
      fields: [{ name: 'n', type: { kind: 'struct', name: 'L' } }],
    };
    expect(optionalWithin({ kind: 'struct', name: 'L' }, structsOf(loop))).toBeUndefined();
  });

  it('words the refusal with a u32 flag, or with the remedy of the position', () => {
    expect(refusedOptionalPosition('f32 | undefined', 'a binding', 'f32')).toBe(
      '"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a ' +
        "parameter, a function's result, a struct field or an array element may hold; a binding " +
        'may not. Carry a u32 flag beside the value, "f32".',
    );
    expect(
      refusedOptionalPosition(
        'f32 | undefined',
        'a binding',
        'f32',
        { type: 'U', path: '.w' },
        (i) => `Use ${i}.`,
      ),
    ).toBe(
      '"U" holds "w: f32 | undefined", a value and a flag saying whether it is there, which a ' +
        "local, a parameter, a function's result, a struct field or an array element may hold; " +
        'a binding may not. Use f32.',
    );
  });

  it('refuses a type that holds an optional, and only then', () => {
    const sourceFile = parse('let x = 1;');
    const diagnostics: never[] = [];
    const run = (type: ShaderType, structs?: StructLookup): boolean =>
      refuseOptionalAt(
        type,
        sourceFile.statements[0]!,
        'a binding',
        sourceFile,
        diagnostics,
        spell,
        structs,
      );
    expect(run(f32T)).toBe(false);
    expect(diagnostics).toHaveLength(0);
    expect(run(optionalT(f32T, 3))).toBe(true);
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0] as { message: string }).message).toContain('"f32 | null | undefined"');
    expect(run({ kind: 'struct', name: 'U' })).toBe(false);
    expect(run({ kind: 'struct', name: 'U' }, structsOf(holder))).toBe(true);
    expect((diagnostics[1] as { message: string }).message).toContain(
      '"U" holds "w: f32 | undefined"',
    );
  });

  it('types a question-marked declaration as an optional, and refuses a payload that cannot', () => {
    const sourceFile = parse('let x = 1;');
    const question = (
      (parse('class A { f?: number }').statements[0] as ts.ClassDeclaration)
        .members[0] as ts.PropertyDeclaration
    ).questionToken!;
    const diagnostics: { message: string }[] = [];
    const run = (mapped: ShaderType | undefined, token?: ts.QuestionToken) =>
      optionalDeclaredType(
        mapped,
        token,
        'parameter "x?"',
        sourceFile,
        diagnostics as never,
        spell,
      );
    expect(run(f32T)).toBe(f32T);
    expect(run(undefined, question)).toBeUndefined();
    expect(run(f32T, question)).toEqual(optionalT(f32T));
    expect(optionalDeclaredType(optionalT(f32T, 2), question, 's', sourceFile, [], spell)).toEqual(
      optionalT(f32T, 3),
    );
    expect(diagnostics).toHaveLength(0);
    expect(run({ kind: 'sampler' }, question)).toBeUndefined();
    expect(diagnostics[0]!.message).toBe(
      'parameter "x?" would hold a sampler and a flag saying whether it is there, and an ' +
        'optional holds what a function-scope struct field may: a scalar, a vector, a matrix, ' +
        'an array with a size or a struct.',
    );
    expect(run({ kind: 'atomic', elem: 'u32' }, question)).toBeUndefined();
    expect(diagnostics[1]!.message).toContain('would hold an atomic and');
  });
});

describe('optional struct collection and order', () => {
  const names = (decls: readonly { decl: StructDecl }[]): string[] => decls.map((d) => d.decl.name);
  const wrap = (decl: StructDecl) => ({ decl });
  const declared = (name: string, fieldType?: ShaderType): { decl: StructDecl } => ({
    decl: { name, fields: fieldType === undefined ? [] : [{ name: 'f', type: fieldType }] },
  });

  it('collects each optional named by a type, through an array, with its payload first', () => {
    const inner = optionalT({ kind: 'struct', name: 'Q' });
    const outer = optionalT({ kind: 'array', elem: inner, size: 2 });
    const used = usedOptionalDecls([
      outer,
      f32T,
      { kind: 'array', elem: optionalT(i32T), size: 1 },
    ]);
    expect(used.map((d) => d.name)).toEqual([
      '__opt_Q',
      '__opt_array_struct___opt_Q_2',
      '__opt_i32',
    ]);
  });

  it('places an optional before the first struct that holds it', () => {
    const opt = optionalT(f32T);
    const holder = declared('H', opt);
    const plain = declared('Z');
    const out = orderedStructDecls([holder, plain], usedOptionalDecls([opt]), wrap);
    expect(names(out)).toEqual(['__opt_f32', 'H', 'Z']);
  });

  it('places an optional no struct holds after every declared struct', () => {
    const out = orderedStructDecls(
      [declared('A'), declared('B')],
      usedOptionalDecls([optionalT(f32T)]),
      wrap,
    );
    expect(names(out)).toEqual(['A', 'B', '__opt_f32']);
  });

  it('places an optional of a struct declared below its holder right after that struct', () => {
    const opt = optionalT({ kind: 'struct', name: 'Item' });
    const optional = usedOptionalDecls([opt]);
    const unheld = orderedStructDecls([declared('Item'), declared('Z')], optional, wrap);
    expect(names(unheld)).toEqual(['Item', 'Z', '__opt_Item']);
    const heldFirst = orderedStructDecls(
      [declared('Holder', opt), declared('Item')],
      optional,
      wrap,
    );
    expect(names(heldFirst)).toEqual(['Holder', 'Item', '__opt_Item']);
  });

  it('keeps the declared order of the declared structs', () => {
    const out = orderedStructDecls([declared('B'), declared('A'), declared('C')], [], wrap);
    expect(names(out)).toEqual(['B', 'A', 'C']);
  });

  it('lists every type of the functions: parameters, result, vars and expressions', () => {
    const x: Expr = { op: 'lit', type: i32T, value: 1 };
    const fn: FuncDecl = {
      name: 'f',
      params: [{ name: 'p', type: u32T }],
      ret: f32T,
      body: [{ s: 'var', name: 'v', type: vec2fT, init: x }],
    } as FuncDecl;
    const types = typesOfFunctions([fn]).map((t) => JSON.stringify(t));
    expect(types).toEqual(
      expect.arrayContaining([u32T, f32T, vec2fT, i32T].map((t) => JSON.stringify(t))),
    );
  });
});
