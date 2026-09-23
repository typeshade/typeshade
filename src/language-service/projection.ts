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
// Only a declaration TypeScript would get wrong is written into: a `const` or `let` with no
// annotation, whose initializer does arithmetic, and whose front-end type is a vector or a
// matrix TypeScript can spell. Everything else is served as written. An insertion never spans a
// line break, so the two texts have the same lines and differ only in the columns after an
// insertion on its own line.

import ts from 'typescript';
import type { ShaderType } from '../core/ir/types.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { clampPosition } from './positions.js';
import type { TypeshadePosition } from './types.js';

/** Text inserted into the document at `at`, an offset into the document as written. */
export interface Insertion {
  readonly at: number;
  readonly text: string;
}

const ARITHMETIC: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

/** Whether `node` does arithmetic anywhere inside it: the only way TypeScript turns a vector
 *  into a `number`. A call, a swizzle or a constructor keeps its declared type. */
function hasArithmetic(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind)) return true;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return true;
  return ts.forEachChild(node, (child) => (hasArithmetic(child) ? true : undefined)) === true;
}

/** How the ambient library spells `type`, or undefined when it has no spelling this pass
 *  writes: only the `f32`, `i32` and `u32` vectors and the `f32` matrices. */
export function ambientSpelling(type: ShaderType): string | undefined {
  if (type.kind === 'vec') {
    const suffix = { f32: '', i32: 'i', u32: 'u' }[type.elem as string];
    return suffix === undefined ? undefined : `vec${type.n}${suffix}`;
  }
  if (type.kind === 'mat' && type.elem === 'f32') return `mat${type.cols}x${type.rows}`;
  return undefined;
}

/**
 * The insertions for `text`: a `: <type>` after the name of every unannotated local whose
 * initializer does arithmetic and whose front-end type is a vector or a matrix. Reads the front
 * end's own record of what it declared, so the type written in is the type the compiler uses.
 * A document the front end cannot read, or one without the directive, gets none.
 */
export function planInsertions(text: string, fileName: string): Insertion[] {
  // The front end is the expensive half; a document with no candidate declaration skips it.
  if (candidates(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)).length === 0) {
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
    if (symbol.kind === 'local') byNameStart.set(symbol.start, symbol.type);
  }
  const out: Insertion[] = [];
  for (const name of candidates(analysis.sourceFile)) {
    const type = byNameStart.get(name.getStart(analysis.sourceFile));
    const spelled = type === undefined ? undefined : ambientSpelling(type);
    if (spelled !== undefined) out.push({ at: name.getEnd(), text: `: ${spelled}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The name of every declaration TypeScript may type wrongly: a `const` or `let` with no
 *  annotation, outside a `for` header, whose initializer does arithmetic. */
function candidates(sourceFile: ts.SourceFile): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type === undefined &&
      node.initializer !== undefined &&
      !ts.isForStatement(node.parent.parent) &&
      hasArithmetic(node.initializer)
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
