// Implements: Rule 12.7

import ts from 'typescript';
import type { ShaderType } from '../core/ir/types.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import type { ImportHooks } from '../compiler/ts/link.js';
import { inferredReturnAt } from '../compiler/ts/symbols.js';
import { authorTypeText } from '../compiler/ts/context.js';
import { stageDeclarationOfFunction } from '../compiler/ts/stage-call.js';
import { clampPosition } from './positions.js';
import type { TypeshadePosition } from './types.js';
import { optionalInner } from '../compiler/ts/optional.js';
import { ambientSpelling, sizedArraySpelling } from './projection/spelling.js';
import {
  fieldCandidates,
  listCandidates,
  logicalBitwiseOperations,
  reduceCandidates,
} from './projection/candidates.js';

export interface Insertion {
  readonly at: number;
  readonly text: string;
}

export type ErasedResult = 'shape' | 'bool';

export const ERASING_OPERATORS: ReadonlyMap<ts.SyntaxKind, ErasedResult> = new Map([
  [ts.SyntaxKind.PlusToken, 'shape'],
  [ts.SyntaxKind.MinusToken, 'shape'],
  [ts.SyntaxKind.AsteriskToken, 'shape'],
  [ts.SyntaxKind.SlashToken, 'shape'],
  [ts.SyntaxKind.PercentToken, 'shape'],
  [ts.SyntaxKind.AsteriskAsteriskToken, 'shape'],
  [ts.SyntaxKind.AmpersandToken, 'shape'],
  [ts.SyntaxKind.BarToken, 'shape'],
  [ts.SyntaxKind.CaretToken, 'shape'],
  [ts.SyntaxKind.LessThanLessThanToken, 'shape'],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, 'shape'],
  [ts.SyntaxKind.PlusEqualsToken, 'shape'],
  [ts.SyntaxKind.MinusEqualsToken, 'shape'],
  [ts.SyntaxKind.AsteriskEqualsToken, 'shape'],
  [ts.SyntaxKind.SlashEqualsToken, 'shape'],
  [ts.SyntaxKind.PercentEqualsToken, 'shape'],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, 'shape'],
  [ts.SyntaxKind.AmpersandEqualsToken, 'shape'],
  [ts.SyntaxKind.BarEqualsToken, 'shape'],
  [ts.SyntaxKind.CaretEqualsToken, 'shape'],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, 'shape'],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, 'shape'],
  [ts.SyntaxKind.LessThanToken, 'bool'],
  [ts.SyntaxKind.LessThanEqualsToken, 'bool'],
  [ts.SyntaxKind.GreaterThanToken, 'bool'],
  [ts.SyntaxKind.GreaterThanEqualsToken, 'bool'],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, 'bool'],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, 'bool'],
]);

export const ERASING_UNARY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

function hasOperator(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && ERASING_OPERATORS.has(node.operatorToken.kind)) return true;
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ERASING_UNARY_OPERATORS.has(node.operator)
  ) {
    return true;
  }
  return ts.forEachChild(node, (child) => (hasOperator(child) ? true : undefined)) === true;
}

function memberSpelling(type: ShaderType): string | undefined {
  if (type.kind === 'scalar') return type.scalar === 'bool' ? undefined : type.scalar;
  if (type.kind === 'f64') return 'f64';
  const inner = optionalInner(type);
  if (inner !== undefined) {
    const spelled = memberSpelling(inner);
    return spelled === undefined ? undefined : `${spelled} | undefined`;
  }
  return ambientSpelling(type);
}

export function planInsertions(text: string, fileName: string, imports?: ImportHooks): Insertion[] {
  const syntax = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  if (
    candidates(syntax).length === 0 &&
    functionCandidates(syntax).length === 0 &&
    fieldCandidates(syntax).length === 0 &&
    reduceCandidates(syntax).length === 0 &&
    logicalBitwiseOperations(syntax).length === 0 &&
    listCandidates(syntax).length === 0
  ) {
    return [];
  }
  let analysis: ReturnType<typeof compileTsSource>;
  try {
    analysis = compileTsSource(text, {
      fileName,
      requireDirective: true,
      emit: false,
      ...imports,
    });
  } catch {
    return [];
  }
  if (!analysis.hasDirective) return [];
  const byNameStart = new Map<number, ShaderType>();
  for (const symbol of analysis.symbols) {
    if (symbol.kind === 'local' || symbol.kind === 'const')
      byNameStart.set(symbol.start, symbol.type);
  }
  const fieldTypes = new Map<number, ShaderType>();
  for (const symbol of analysis.symbols) {
    if (symbol.kind === 'field' || symbol.kind === 'const' || symbol.kind === 'binding')
      fieldTypes.set(symbol.start, symbol.type);
  }
  const out: Insertion[] = [];
  for (const name of fieldCandidates(analysis.sourceFile)) {
    const type = fieldTypes.get(name.getStart(analysis.sourceFile));
    const spelled =
      type === undefined || (type.kind !== 'scalar' && type.kind !== 'f64')
        ? sizedArraySpelling(type, name.parent)
        : memberSpelling(type);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  for (const name of candidates(analysis.sourceFile)) {
    const type = byNameStart.get(name.getStart(analysis.sourceFile));
    const spelled = type === undefined ? undefined : ambientSpelling(type);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  for (const name of listCandidates(analysis.sourceFile)) {
    const at = name.getStart(analysis.sourceFile);
    const spelled = sizedArraySpelling(byNameStart.get(at) ?? fieldTypes.get(at), undefined);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  const sf = analysis.sourceFile;
  for (const fn of functionCandidates(sf)) {
    const lowered = stageDeclarationOfFunction(fn) ?? fn;
    const type = inferredReturnAt(sf, lowered.getStart(sf));
    const spelled =
      type === undefined
        ? undefined
        : (memberSpelling(type) ??
          (type.kind === 'struct' && isEntryFunction(fn) ? authorTypeText(type) : undefined));
    if (spelled === undefined) continue;
    const close = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.CloseParenToken);
    if (close !== undefined) {
      out.push({ at: close.getEnd(), text: `: ${spelled}` });
      continue;
    }
    const only = fn.parameters[0];
    if (only === undefined) continue;
    out.push({ at: only.getStart(sf), text: '(' });
    out.push({ at: only.getEnd(), text: ')' });
    out.push({ at: only.getEnd(), text: `: ${spelled}` });
  }
  const lowered = new Map(analysis.expressions.map((e) => [`${e.start}:${e.length}`, e.type]));
  const typeOf = (node: ts.Node): ShaderType | undefined =>
    lowered.get(`${node.getStart(sf)}:${node.getWidth(sf)}`) ?? undefined;
  for (const call of reduceCandidates(sf)) {
    const type = typeOf(call);
    const spelled = type === undefined ? undefined : memberSpelling(type);
    if (spelled === undefined) continue;
    const receiver = typeOf((call.expression as ts.PropertyAccessExpression).expression);
    const size = receiver?.kind === 'array' ? receiver.size : undefined;
    const args = size === undefined ? spelled : `${spelled}, ${String(size)}`;
    out.push({ at: call.expression.getEnd(), text: `<${args}>` });
  }
  for (const op of logicalBitwiseOperations(sf)) {
    const type = typeOf(op);
    if (type?.kind !== 'scalar' || type.scalar !== 'bool') continue;
    out.push({ at: op.getStart(sf), text: '((' });
    out.push({ at: op.getEnd(), text: ') as unknown as bool)' });
  }
  return out.sort((a, b) => a.at - b.at);
}

type FunctionCandidate =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

function returnedValues(fn: FunctionCandidate): ts.Expression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) out.push(node.expression);
      return;
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

function isEntryFunction(fn: FunctionCandidate): boolean {
  const parent = fn.parent;
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    ['vertex', 'fragment'].includes(parent.expression.text)
  )
    return true;
  return (
    ts.isFunctionDeclaration(fn) &&
    (fn.modifiers ?? []).some(
      (m) => ts.isDecorator(m) && /^@(vertex|fragment)\b/.test(m.getText(fn.getSourceFile())),
    )
  );
}

function functionCandidates(sourceFile: ts.SourceFile): FunctionCandidate[] {
  const out: FunctionCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) &&
      node.type === undefined &&
      (returnedValues(node).some(hasOperator) ||
        (isEntryFunction(node) && returnedValues(node).length > 0))
    ) {
      out.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

function candidates(sourceFile: ts.SourceFile): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type === undefined &&
      node.initializer !== undefined &&
      !ts.isForStatement(node.parent.parent) &&
      hasOperator(node.initializer)
    ) {
      out.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

export class Projection {
  readonly projected: string;
  private readonly originalFile: ts.SourceFile;
  private readonly projectedFile: ts.SourceFile;

  constructor(
    readonly original: string,
    readonly insertions: readonly Insertion[],
  ) {
    let out = '';
    let from = 0;
    for (const insertion of insertions) {
      out += original.slice(from, insertion.at) + insertion.text;
      from = insertion.at;
    }
    this.projected = out + original.slice(from);
    this.originalFile = ts.createSourceFile('original.ts', original, ts.ScriptTarget.Latest);
    this.projectedFile = ts.createSourceFile(
      'projected.ts',
      this.projected,
      ts.ScriptTarget.Latest,
    );
  }

  insertionStarts(): number[] {
    let shift = 0;
    return this.insertions.map((insertion) => {
      const at = insertion.at + shift;
      shift += insertion.text.length;
      return at;
    });
  }

  insertionLengths(): number[] {
    return this.insertions.map((insertion) => insertion.text.length);
  }

  get isIdentity(): boolean {
    return this.insertions.length === 0;
  }

  toProjected(offset: number): number {
    let shift = 0;
    for (const insertion of this.insertions) {
      if (insertion.at > offset) break;
      if (insertion.at < offset || insertion.text.startsWith('(')) {
        shift += insertion.text.length;
      }
    }
    return offset + shift;
  }

  toOriginal(offset: number): number {
    let shift = 0;
    for (const insertion of this.insertions) {
      const start = insertion.at + shift;
      if (offset <= start) break;
      if (offset < start + insertion.text.length) return insertion.at;
      shift += insertion.text.length;
    }
    return offset - shift;
  }

  toProjectedPosition(position: TypeshadePosition): TypeshadePosition {
    const p = clampPosition(this.originalFile, position.line, position.character);
    const offset = this.originalFile.getPositionOfLineAndCharacter(p.line, p.character);
    return this.projectedFile.getLineAndCharacterOfPosition(this.toProjected(offset));
  }

  originalPositionAt(offset: number): TypeshadePosition {
    const clamped = Math.max(0, Math.min(offset, this.original.length));
    return this.originalFile.getLineAndCharacterOfPosition(clamped);
  }

  originalOffsetAt(position: TypeshadePosition): number {
    const p = clampPosition(this.originalFile, position.line, position.character);
    return this.originalFile.getPositionOfLineAndCharacter(p.line, p.character);
  }

  isInserted(position: TypeshadePosition): boolean {
    const p = clampPosition(this.projectedFile, position.line, position.character);
    const offset = this.projectedFile.getPositionOfLineAndCharacter(p.line, p.character);
    let shift = 0;
    for (const insertion of this.insertions) {
      const start = insertion.at + shift;
      if (offset < start) return false;
      if (offset < start + insertion.text.length) return true;
      shift += insertion.text.length;
    }
    return false;
  }

  toOriginalPosition(position: TypeshadePosition): TypeshadePosition {
    const p = clampPosition(this.projectedFile, position.line, position.character);
    const offset = this.projectedFile.getPositionOfLineAndCharacter(p.line, p.character);
    return this.originalFile.getLineAndCharacterOfPosition(this.toOriginal(offset));
  }
}

export type ProjectionLookup = (uri: string) => Projection | undefined;

export function mapToOriginal<T>(value: T, uri: string, lookup: ProjectionLookup): T {
  if (Array.isArray(value)) return value.map((v) => mapToOriginal(v, uri, lookup)) as T;
  if (value === null || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  const at = typeof o['uri'] === 'string' ? (o['uri'] as string) : uri;
  const projection = lookup(at);
  if (typeof o['line'] === 'number' && typeof o['character'] === 'number') {
    if (!projection || projection.isIdentity) return value;
    const p = projection.toOriginalPosition({ line: o['line'], character: o['character'] });
    return { ...o, line: p.line, character: p.character } as T;
  }
  const keys = Object.keys(o);
  if (keys.length === 2 && typeof o['start'] === 'number' && typeof o['length'] === 'number') {
    if (!projection || projection.isIdentity) return value;
    const start = projection.toOriginal(o['start']);
    const end = projection.toOriginal(o['start'] + o['length']);
    return { start, length: end - start } as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = mapToOriginal(o[key], at, lookup);
  return out as T;
}
