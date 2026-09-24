// === The text TypeScript sees: the document, with the types TypeScript cannot infer written in ===
//
// TypeScript has no operator overloading, so the checker types every arithmetic result as
// `number`. On an operand that is a vector or a matrix the diagnostics filter already drops the
// operator's own complaint (TS2362, TS2363, TS2365). What it could not reach was the local the
// result is stored in: `const uv = p.xy * frame.scale` gives `uv` the type `number`, and from
// there `uv.x` is TS2339, `f(uv)` is TS2345, and completion after `uv.` offers nothing. The
// front end knows `uv` is a `vec2`, because it lowered the expression. So the program the service
// builds reads the document with that type written in, `const uv: vec2 = p.xy * frame.scale`,
// and every answer the service gives maps back to the document the author wrote (#162).
//
// Only a declaration TypeScript would get wrong is written into, when its front-end type is a
// vector or a matrix TypeScript can spell and the value it is declared from applies an operator
// TypeScript types as a `number` or a `boolean` (arithmetic, a bitwise operator, a comparison, a
// unary one):
//
//   - a `const` or `let` with no annotation, a local or a module const: `: vec2` after its name.
//     `const c = a < b` on two `vec3` is a `vec3b`, and `const w = v * f64(2.)` a `vec3f64`;
//   - a function that writes no return type and whose `return`, or an arrow function's
//     expression body, applies such an operator (Rule 8.19): `: vec2` after its parameter list,
//     and a pair of parentheses around an arrow function's one bare parameter. A function, a
//     method, a getter, a field that holds a function, an arrow function or a function
//     expression, local or handed to a call. Its return is written in when it is a SCALAR
//     too (`f32`, `i32`, `u32`, `f64`), which TypeScript types `number` (0015's class B);
//   - a class field with an initializer and no annotation, static or not, private or not,
//     whose front-end type is a scalar: `: f32` after its name. `#width = 0.05` is `number` to
//     TypeScript and `static readonly MIN_WIDTH = 0.01` the literal `0.01`.
//
// Everything else is served as written. An insertion never spans a line break, so the two texts
// have the same lines and differ only in the columns after an insertion on its own line.
//
// This is the one place a lost vector type is restored, and it restores it for every answer the
// service gives, hover and completion as much as diagnostics. The diagnostics filters read no
// type from the front end: what they judge is an operation used in place (`return a < b`), and
// a name declared from one that the projection could not type, because the compiler refused the
// declaration, is judged as that operation (`diagnostics.ts`). Both read one operator table,
// `ERASING_OPERATORS`, so the two cannot disagree about which operation loses a vector's type.

import ts from 'typescript';
import type { ShaderType } from '../core/ir/types.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { inferredReturnAt } from '../compiler/ts/symbols.js';
import { clampPosition } from './positions.js';
import type { TypeshadePosition } from './types.js';

/** Text inserted into the document at `at`, an offset into the document as written. */
export interface Insertion {
  readonly at: number;
  readonly text: string;
}

/** What the front end makes of a vector or matrix operand of an operator in
 *  `ERASING_OPERATORS`: a value of the operands' own shape, or, for a comparison, the `bool`
 *  vector of their width. */
export type ErasedResult = 'shape' | 'bool';

/**
 * The binary operators TypeScript types as a `number` or a `boolean` whatever their operands,
 * which on a vector or a matrix erases its type: the arithmetic (`+ - * / % **`), the bitwise
 * and shift operators, their compound assignments, and the comparisons. The front end gives each
 * a vector, or a matrix for matrix arithmetic, and a comparison of two vectors the `bool` vector
 * of their width. `&&` and `||` are not among them: TypeScript types those as an operand's own
 * type, and the front end takes them on a scalar `bool` only.
 *
 * One table, read twice: here, to find a declaration whose type TypeScript cannot infer, and by
 * the diagnostics filter (`diagnostics.ts`), to recognize the report such an operation draws
 * where its value is used in place.
 */
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

/** The unary operators that erase a vector's type the same way, each keeping its operand's
 *  shape: negation, the identity `+`, bitwise not, logical not, and the increments. */
export const ERASING_UNARY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

/** Whether `node` applies such an operator anywhere inside it: the only way TypeScript turns a
 *  vector into a `number` or a `boolean`. A call, a swizzle or a constructor keeps its type. */
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

/** How the ambient library spells `type`, or undefined when it is not a vector or a matrix:
 *  the `f32`, `i32`, `u32` and `bool` vectors, the emulated-double ones, and the matrices, whose
 *  `f64` form is a square one's type argument. */
export function ambientSpelling(type: ShaderType): string | undefined {
  if (type.kind === 'vec') {
    const suffix = { f32: '', i32: 'i', u32: 'u', bool: 'b' }[type.elem as string];
    return suffix === undefined ? undefined : `vec${type.n}${suffix}`;
  }
  if (type.kind === 'vec64') return `vec${type.n}f64`;
  if (type.kind === 'mat') {
    const name = `mat${type.cols}x${type.rows}`;
    return type.elem === 'f64' ? `${name}<f64>` : name;
  }
  return undefined;
}

/** `ambientSpelling`, and a scalar too: the `f32`, `i32`, `u32` or `f64` a class field or a
 *  function's return is to the front end, which TypeScript infers as `number` from a literal or
 *  arithmetic (0015's class B: `#width = 0.05`, `get period() { return this.r * 2. }`). A local
 *  keeps `ambientSpelling`: hover already answers for a local from the front end's own record,
 *  and a scalar there costs nothing downstream. The brands are optional, so writing one in
 *  rejects no `number`; a `bool` is TypeScript's own `boolean` already. */
function memberSpelling(type: ShaderType): string | undefined {
  if (type.kind === 'scalar') return type.scalar === 'bool' ? undefined : type.scalar;
  if (type.kind === 'f64') return 'f64';
  return ambientSpelling(type);
}

/**
 * The insertions for `text`: a `: <type>` after the name of every unannotated local or module
 * const whose initializer applies an operator TypeScript types as a `number` or a `boolean`, and
 * after the parameter list of every function that writes no return type and whose return
 * applies one, when the front-end type is a vector or a matrix. Reads the front end's own record
 * of what it declared and what each function returns, so the type written in is the type the
 * compiler uses. A document the front end cannot read, or one without the directive, gets none.
 */
export function planInsertions(text: string, fileName: string): Insertion[] {
  // The front end is the expensive half; a document with no candidate declaration skips it.
  const syntax = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  if (
    candidates(syntax).length === 0 &&
    functionCandidates(syntax).length === 0 &&
    fieldCandidates(syntax).length === 0
  ) {
    return [];
  }
  let analysis: ReturnType<typeof compileTsSource>;
  try {
    analysis = compileTsSource(text, { fileName, requireDirective: true, emit: false });
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
    // A field whose initializer is a vector call TypeScript types right (`c = vec2(0.)`); only a
    // scalar, which a literal or arithmetic leaves `number`, is written in unless it applied an
    // operator (the rule for a local, above).
    const spelled =
      type === undefined || (type.kind !== 'scalar' && type.kind !== 'f64')
        ? undefined
        : memberSpelling(type);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  for (const name of candidates(analysis.sourceFile)) {
    const type = byNameStart.get(name.getStart(analysis.sourceFile));
    const spelled = type === undefined ? undefined : ambientSpelling(type);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  const sf = analysis.sourceFile;
  for (const fn of functionCandidates(sf)) {
    const type = inferredReturnAt(sf, fn.getStart(sf));
    const spelled = type === undefined ? undefined : memberSpelling(type);
    if (spelled === undefined) continue;
    const close = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.CloseParenToken);
    if (close !== undefined) {
      out.push({ at: close.getEnd(), text: `: ${spelled}` });
      continue;
    }
    // `x => x * k`: a return type needs the parameter in parentheses, `(x): vec2 => x * k`.
    const only = fn.parameters[0];
    if (only === undefined) continue;
    out.push({ at: only.getStart(sf), text: '(' });
    out.push({ at: only.getEnd(), text: `): ${spelled}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A function that writes no return type: what TypeScript infers a return type for. */
type FunctionCandidate =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

/** The values a function returns, its own and not a nested function's: an arrow function's
 *  expression body, or the expression of each `return` in its block. */
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

/** Every function TypeScript may type wrongly: one that writes no return type and returns a
 *  value that applies such an operator (Rule 8.19). */
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
      returnedValues(node).some(hasOperator)
    ) {
      out.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** The name of every class field TypeScript may type wrongly: one with an initializer and no
 *  annotation, static or not, private (`#width`) or not. What the front end typed it decides
 *  whether anything is written (a scalar is; see `planInsertions`). */
function fieldCandidates(sourceFile: ts.SourceFile): (ts.Identifier | ts.PrivateIdentifier)[] {
  const out: (ts.Identifier | ts.PrivateIdentifier)[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyDeclaration(node) &&
      (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
      node.type === undefined &&
      node.initializer !== undefined
    ) {
      out.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** The name of every declaration TypeScript may type wrongly: a `const` or `let` with no
 *  annotation, outside a `for` header, whose initializer applies such an operator. */
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

/** One document as written and as TypeScript reads it, with the offset and position maps
 *  between the two. */
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

  /** Whether the two texts differ at all. */
  get isIdentity(): boolean {
    return this.insertions.length === 0;
  }

  /** An offset into the document as written, as an offset into the projected text. An offset
   *  AT an insertion stays before it, so a cursor at the end of `uv` is at the end of `uv`. */
  toProjected(offset: number): number {
    let shift = 0;
    for (const insertion of this.insertions) {
      if (insertion.at < offset) shift += insertion.text.length;
      else break;
    }
    return offset + shift;
  }

  /** An offset into the projected text, as an offset into the document as written. An offset
   *  inside inserted text maps to the point it was inserted at. */
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

  /** An offset into the document as written, as a position in it. */
  originalPositionAt(offset: number): TypeshadePosition {
    const clamped = Math.max(0, Math.min(offset, this.original.length));
    return this.originalFile.getLineAndCharacterOfPosition(clamped);
  }

  /** A position in the document as written, as an offset into it. */
  originalOffsetAt(position: TypeshadePosition): number {
    const p = clampPosition(this.originalFile, position.line, position.character);
    return this.originalFile.getPositionOfLineAndCharacter(p.line, p.character);
  }

  /** Whether a position in the projected text falls inside text this projection inserted,
   *  which the author never wrote: a semantic token there has nothing to colour. */
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

/** Where to find the projection of a document, or undefined for one read as written. */
export type ProjectionLookup = (uri: string) => Projection | undefined;

/**
 * `value`, an answer the service computed on the projected text, with every position, range
 * and span in it moved back to the document as written. A position is an object with a numeric
 * `line` and `character` (a semantic token is one, with its `length` beside them); a span is an
 * object that is exactly `{ start, length }`. An object carrying a `uri` answers for that
 * document, so a reference into another open document maps through that document's own
 * projection. Everything else is copied as it is.
 */
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
