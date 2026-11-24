import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { f32T, u32T, vec3fT } from '../../core/ir/types.js';
import {
  captureExpressionRecords,
  closeExpressionTable,
  copyCallAt,
  copyCallParamsAt,
  hasResultCopies,
  abstractConstTableOf,
  inferredReturnAt,
  loweredTypeOf,
  mapResultCopies,
  openExpressionTable,
  recordAbstractConstTable,
  recordCopyCall,
  recordDeclaration,
  recordInferredReturn,
  recordLoweredExpression,
  recordResultCopies,
  resetResultCopies,
  resultCopiesAt,
} from './symbols.js';
import type { DeclaredSymbol } from './symbols.js';

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true);
}

function expressionOf(sf: ts.SourceFile, text: string): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found === undefined && ts.isExpression(node) && node.getText(sf) === text) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found!;
}

describe('inferred return table', () => {
  const sf = parse('function g() { return 1; }');
  const fn = sf.statements[0]!;

  it('answers the type recorded at the start of the node', () => {
    recordInferredReturn(sf, fn, f32T);
    expect(inferredReturnAt(sf, fn.getStart(sf))).toEqual(f32T);
  });

  it('keeps the type when two lowerings record the same type', () => {
    const other = parse('function g() { return 1; }');
    const node = other.statements[0]!;
    recordInferredReturn(other, node, u32T);
    recordInferredReturn(other, node, u32T);
    expect(inferredReturnAt(other, node.getStart(other))).toEqual(u32T);
  });

  it('answers undefined once two lowerings record two types, and stays undefined', () => {
    const other = parse('function g() { return 1; }');
    const node = other.statements[0]!;
    recordInferredReturn(other, node, f32T);
    recordInferredReturn(other, node, u32T);
    recordInferredReturn(other, node, f32T);
    expect(inferredReturnAt(other, node.getStart(other))).toBeUndefined();
  });

  it('answers undefined for an offset nothing was recorded at', () => {
    expect(inferredReturnAt(sf, 3)).toBeUndefined();
  });
});

describe('lowered expression table', () => {
  const sf = parse('const a = b + c;');
  const sum = expressionOf(sf, 'b + c');
  const left = expressionOf(sf, 'b');

  it('records nothing while no table is open for the file', () => {
    recordLoweredExpression(sf, sum, f32T);
    expect(loweredTypeOf(sf, sum)).toBeUndefined();
    expect(closeExpressionTable(sf)).toEqual([]);
  });

  it('closes into source order, the longer span first at one start', () => {
    openExpressionTable(sf);
    recordLoweredExpression(sf, left, u32T);
    recordLoweredExpression(sf, sum, f32T);
    const start = sum.getStart(sf);
    expect(closeExpressionTable(sf)).toEqual([
      { start, length: sum.getEnd() - start, type: f32T },
      { start, length: left.getEnd() - start, type: u32T },
    ]);
  });

  it('drops a span lowered to two types, and stops recording once closed', () => {
    openExpressionTable(sf);
    recordLoweredExpression(sf, sum, f32T);
    recordLoweredExpression(sf, sum, u32T);
    expect(loweredTypeOf(sf, sum)).toBeUndefined();
    expect(closeExpressionTable(sf)).toEqual([]);
    recordLoweredExpression(sf, sum, f32T);
    expect(loweredTypeOf(sf, sum)).toBeUndefined();
  });

  it('answers the one type of a span while the table is open', () => {
    openExpressionTable(sf);
    recordLoweredExpression(sf, sum, vec3fT);
    expect(loweredTypeOf(sf, sum)).toEqual(vec3fT);
    closeExpressionTable(sf);
  });

  it('drops an earlier table when a new one opens', () => {
    openExpressionTable(sf);
    recordLoweredExpression(sf, sum, f32T);
    openExpressionTable(sf);
    expect(closeExpressionTable(sf)).toEqual([]);
  });
});

describe('captureExpressionRecords', () => {
  const sf = parse('const a = b + c;');
  const sum = expressionOf(sf, 'b + c');

  it('lowers without recording when no table is open, and commit does nothing', () => {
    const { value, commit } = captureExpressionRecords(sf, () => {
      recordLoweredExpression(sf, sum, f32T);
      return 7;
    });
    commit();
    expect(value).toBe(7);
    expect(closeExpressionTable(sf)).toEqual([]);
  });

  it('keeps the trial out of the table until commit', () => {
    openExpressionTable(sf);
    const { commit } = captureExpressionRecords(sf, () => recordLoweredExpression(sf, sum, f32T));
    expect(loweredTypeOf(sf, sum)).toBeUndefined();
    commit();
    expect(loweredTypeOf(sf, sum)).toEqual(f32T);
    closeExpressionTable(sf);
  });

  it('commits a trial that agrees with an earlier record, and voids one that disagrees', () => {
    openExpressionTable(sf);
    recordLoweredExpression(sf, sum, f32T);
    captureExpressionRecords(sf, () => recordLoweredExpression(sf, sum, f32T)).commit();
    expect(loweredTypeOf(sf, sum)).toEqual(f32T);
    captureExpressionRecords(sf, () => recordLoweredExpression(sf, sum, u32T)).commit();
    expect(loweredTypeOf(sf, sum)).toBeUndefined();
    closeExpressionTable(sf);
  });

  it('restores the table of the file when the lowering throws', () => {
    openExpressionTable(sf);
    expect(() =>
      captureExpressionRecords(sf, () => {
        recordLoweredExpression(sf, sum, f32T);
        throw new Error('refused');
      }),
    ).toThrow('refused');
    recordLoweredExpression(sf, sum, u32T);
    expect(loweredTypeOf(sf, sum)).toEqual(u32T);
    closeExpressionTable(sf);
  });
});

describe('result copies table', () => {
  const sf = parse('function g() {} g(); g();');
  const name = (sf.statements[0] as ts.FunctionDeclaration).name!;
  const call = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
  const callee = call.expression;

  it('answers the copies of a function at the offset of its name', () => {
    recordResultCopies(sf, name, 'g', [f32T, u32T]);
    expect(resultCopiesAt(sf, name.getStart(sf))).toEqual({ name: 'g', types: [f32T, u32T] });
    expect(hasResultCopies(sf)).toBe(true);
  });

  it('answers the copy a call takes and the parameters of the function it calls', () => {
    recordCopyCall(sf, callee, u32T, [f32T]);
    expect(copyCallAt(sf, callee.getStart(sf))).toEqual(u32T);
    expect(copyCallParamsAt(sf, callee.getStart(sf))).toEqual([f32T]);
  });

  it('answers undefined for a call that took two copies, and keeps it so', () => {
    const other = parse('function g() {} g();');
    const at = ((other.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression)
      .expression;
    recordCopyCall(other, at, f32T);
    recordCopyCall(other, at, f32T);
    expect(copyCallAt(other, at.getStart(other))).toEqual(f32T);
    recordCopyCall(other, at, u32T);
    recordCopyCall(other, at, f32T);
    expect(copyCallAt(other, at.getStart(other))).toBeUndefined();
    expect(copyCallParamsAt(other, at.getStart(other))).toEqual([]);
  });

  it('reports no copies for a file that recorded none', () => {
    expect(hasResultCopies(parse('const a = 1;'))).toBe(false);
  });

  it('maps the entries of a linked file to the offsets of the entry, skipping the others', () => {
    const linked = parse('function g() {} g(); g();');
    const entry = parse('g();');
    const calls = linked.statements.slice(1);
    const [first, second] = calls.map(
      (s) => ((s as ts.ExpressionStatement).expression as ts.CallExpression).expression,
    ) as unknown as [ts.Node, ts.Node];
    const declName = (linked.statements[0] as ts.FunctionDeclaration).name!;
    recordResultCopies(linked, declName, 'g', [f32T]);
    recordCopyCall(linked, first, f32T, [u32T]);
    recordCopyCall(linked, second, u32T);
    mapResultCopies(linked, entry, (offset) =>
      offset === first.getStart(linked) ? 0 : offset === declName.getStart(linked) ? 40 : undefined,
    );
    expect(copyCallAt(entry, 0)).toEqual(f32T);
    expect(copyCallParamsAt(entry, 0)).toEqual([u32T]);
    expect(copyCallAt(entry, second.getStart(linked))).toBeUndefined();
    expect(resultCopiesAt(entry, 40)).toEqual({ name: 'g', types: [f32T] });
    expect(resultCopiesAt(entry, declName.getStart(linked))).toBeUndefined();
  });

  it('reports copies for a file that recorded only a call', () => {
    const other = parse('g();');
    recordCopyCall(other, other.statements[0]!, f32T);
    expect(hasResultCopies(other)).toBe(true);
  });

  it('keeps nothing of entries that map to no offset of the entry', () => {
    const linked = parse('g();');
    const entry = parse('g();');
    recordCopyCall(linked, linked.statements[0]!, f32T);
    mapResultCopies(linked, entry, () => undefined);
    expect(hasResultCopies(entry)).toBe(false);
  });

  it('maps nothing when the linked file recorded nothing', () => {
    const entry = parse('g();');
    mapResultCopies(parse('g();'), entry, () => 0);
    expect(hasResultCopies(entry)).toBe(false);
  });

  it('forgets everything recorded for a file on reset', () => {
    resetResultCopies(sf);
    expect(hasResultCopies(sf)).toBe(false);
    expect(copyCallAt(sf, callee.getStart(sf))).toBeUndefined();
  });
});

describe('declaration sink', () => {
  const sf = parse('let value = 1;');
  const name = (
    (sf.statements[0] as ts.VariableStatement).declarationList
      .declarations[0] as ts.VariableDeclaration
  ).name;

  it('appends the symbol with the span of the name node, not of the declaration', () => {
    const sink: DeclaredSymbol[] = [];
    recordDeclaration(sink, sf, name, { name: 'value', kind: 'local', type: f32T });
    expect(sink).toEqual([{ name: 'value', kind: 'local', type: f32T, start: 4, length: 5 }]);
  });

  it('records nothing when the caller asked for no symbols', () => {
    expect(() =>
      recordDeclaration(undefined, sf, name, { name: 'value', kind: 'local', type: f32T }),
    ).not.toThrow();
  });
});

describe('abstract constant table', () => {
  const sf = parse('const K = 3;');

  it('answers the table recorded for the file, and undefined for a file with none', () => {
    const table = { decls: [], reads: [{ start: 1, length: 1, type: null }] };
    recordAbstractConstTable(sf, table);
    expect(abstractConstTableOf(sf)).toBe(table);
    expect(abstractConstTableOf(parse('const K = 3;'))).toBeUndefined();
  });
});
