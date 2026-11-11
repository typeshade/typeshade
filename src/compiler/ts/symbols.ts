// === What the front end declared: the side table an editor types a symbol from ===
//
// The front end knows the `ShaderType` of every name it lowers, and until now that knowledge
// stopped at the IR: the IR carries types, but not the source span of the name they were
// declared at, so nothing downstream could answer "what type is the thing under the cursor".
// TypeScript cannot answer it either: the ambient scalar types brand `number` optionally
// (`number & { readonly [f32Tag]?: true }`), so `let x = 1.` is inferred plain `number` and the
// editor says `number` where the compiler says `f32`. Recording each declaration as it is
// lowered closes that gap without the language service re-deriving anything.
//
// This table is a SIDE OUTPUT. Nothing here feeds lowering, the IR or emitted text, and the
// sink is optional at every call site, so a caller that does not ask for symbols pays one
// `undefined` check per declaration.

import type ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';

/** What kind of declaration a {@link DeclaredSymbol} records. `const` is a module-level
 *  constant (`const K: f32 = 2.`), `binding` a resource (`uniform<T>` / `storage<T>`), `struct`
 *  a data class and `field` one of its members; `local` and `param` are function-scoped. */
export type DeclaredSymbolKind =
  | 'local'
  | 'param'
  | 'const'
  | 'binding'
  | 'function'
  | 'struct'
  | 'field'
  // A specialization constant (#8 A7). Its own kind rather than 'const': its value is not
  // known until a pipeline is built, so an editor should not offer it as a folded number.
  | 'override';

/** One parameter of a declared function, in declaration order. */
export interface DeclaredParam {
  readonly name: string;
  readonly type: ShaderType;
}

/**
 * One name the front end declared while lowering a source file, with the type it gave it.
 *
 * `start`/`length` are the UTF-16 span of the declared NAME identifier, `name.getStart(sf)` and
 * `name.getEnd() - name.getStart(sf)`, the same convention `TsCompilerDiagnostic` uses, so
 * `sourceFile.text.slice(start, start + length)` is exactly `name`. Every declaration lowered
 * gets its own entry, including a `for`-init declarator, a nested block's local and a
 * redeclaration that shadows an outer name, so two entries can share a `name` and are told
 * apart by their span.
 *
 * The spans are offsets into ONE file: `CompileTsSourceResult.symbols` belongs to that result's
 * `sourceFile`, never to an imported document.
 */
export interface DeclaredSymbol {
  readonly name: string;
  readonly kind: DeclaredSymbolKind;
  /** UTF-16 offset where the declared name identifier begins. */
  readonly start: number;
  /** Length of the declared name identifier, in UTF-16 code units. */
  readonly length: number;
  /** The type the front end gave this declaration; for a `function`, its RETURN type. */
  readonly type: ShaderType;
  /** A `function`'s parameters, in declaration order. Absent for every other kind. */
  readonly params?: readonly DeclaredParam[];
  /** Whether the declaration may be written to. For a `local` it is the keyword, `let`
   *  (`true`) or `const` (`false`). For a `binding` it is the ACCESS MODE the declared type
   *  asked for, `true` only for `storage<T, "read_write">`: a binding is always declared
   *  `const` (design rule 6.1), so the keyword says nothing about it. Absent for every other
   *  kind. */
  readonly mutable?: boolean;
  /** The name of the struct that owns a `field`. Absent for every other kind. */
  readonly struct?: string;
}

/** The growable table lowering appends to. `undefined` at a call site means the caller did not
 *  ask for symbols, and every recording helper is then a no-op. */
export type DeclaredSymbolSink = DeclaredSymbol[];

/**
 * Append `symbol` to `sink`, taking its span from `nameNode` (the identifier the declaration
 * names, not the whole declaration). A no-op when `sink` is `undefined`.
 */
export function recordDeclaration(
  sink: DeclaredSymbolSink | undefined,
  sourceFile: ts.SourceFile,
  nameNode: ts.Node,
  symbol: Omit<DeclaredSymbol, 'start' | 'length'>,
): void {
  if (sink === undefined) return;
  const start = nameNode.getStart(sourceFile);
  sink.push({ ...symbol, start, length: nameNode.getEnd() - start });
}

// ─── the return type a declaration that writes none was given (Rule 8.19) ───────────────────
//
// TypeScript types an arithmetic result `number`, so a function whose `return` is `p * 0.5` on a
// `vec2` returns a `number` to the editor and a `vec2` to the compiler (#162). The language
// service writes the compiler's type into the text TypeScript reads (`projection.ts`), and this
// is where it reads it: by the offset the function's node starts at. A side table rather than a
// field of `CompileTsSourceResult`, whose shape is public API; keyed by the source file, so a
// result's table lives exactly as long as its file.

/** Per source file: the return type each function-like node that writes none was given, or
 *  `null` for one lowered twice to two types (a generic function's instances, the copies of a
 *  function that takes a function), which no one written type describes. */
const inferredReturns = new WeakMap<ts.SourceFile, Map<number, ShaderType | null>>();

/** Record that `node`, a function that writes no return type, returns `type`. */
export function recordInferredReturn(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  type: ShaderType,
): void {
  let table = inferredReturns.get(sourceFile);
  if (table === undefined) {
    table = new Map();
    inferredReturns.set(sourceFile, table);
  }
  const at = node.getStart(sourceFile);
  const seen = table.get(at);
  if (seen === undefined) table.set(at, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) table.set(at, null);
}

/** The return type the front end gave the function whose node starts at `offset` in
 *  `sourceFile` and writes none; undefined when it recorded none, or two. */
export function inferredReturnAt(
  sourceFile: ts.SourceFile,
  offset: number,
): ShaderType | undefined {
  return inferredReturns.get(sourceFile)?.get(offset) ?? undefined;
}

// ─── the type the front end gave each expression it lowered (0015) ──────────────────────────
//
// `symbols` answers "what type is this NAME"; this table answers "what type is this
// EXPRESSION", for every expression `lowerExpression` returned a value for. The language
// service's TypeScript checker gives the same expressions a type of its own, from the ambient
// library, and Rule 12.7 says the two agree. The table is what lets a test hold them to it
// (`expression-parity.test.ts`) rather than to a hand-picked hover.
//
// Keyed by the source file, like the inferred returns above, so recording needs nothing but the
// node: every lowering reaches `lowerExpression` with its source file, and no scope has to carry
// a sink. `compileTsSource` opens the table before lowering and closes it into its result; a
// lowering outside one (a unit test that calls `lowerExpression` directly) records nothing.

/**
 * One expression the front end lowered, with the type it gave it.
 *
 * `start`/`length` are the UTF-16 span of the expression, `node.getStart(sf)` and
 * `node.getEnd() - node.getStart(sf)`, the convention `DeclaredSymbol` uses. A span the front end
 * lowered to two different types (a generic function's body, once per instance, or a literal
 * read once without its context and once with it) has no one type and is left out.
 *
 * The spans are offsets into ONE file: `CompileTsSourceResult.expressions` belongs to that
 * result's `sourceFile`, never to an imported document.
 */
export interface LoweredExpression {
  /** UTF-16 offset where the expression begins, leading trivia excluded. */
  readonly start: number;
  /** Length of the expression, in UTF-16 code units. */
  readonly length: number;
  /** The type the front end gave the expression. */
  readonly type: ShaderType;
}

/** Per source file being compiled: each lowered span, `start:length`, and its type, or `null`
 *  for a span lowered to two types. */
const loweredExpressions = new WeakMap<ts.SourceFile, Map<string, ShaderType | null>>();

/** Record an initializer trial separately; only the selected lowering supplies editor types.
 *  The ordinary scalar paths commit their original records unchanged (change 0123). */
export function captureExpressionRecords<T>(
  sourceFile: ts.SourceFile,
  lower: () => T,
): { value: T; commit: () => void } {
  const previous = loweredExpressions.get(sourceFile);
  if (previous === undefined) return { value: lower(), commit: () => {} };
  const trial = new Map<string, ShaderType | null>();
  loweredExpressions.set(sourceFile, trial);
  let value: T;
  try {
    value = lower();
  } finally {
    loweredExpressions.set(sourceFile, previous);
  }
  return {
    value,
    commit: () => {
      for (const [key, type] of trial) {
        const seen = previous.get(key);
        previous.set(
          key,
          seen === undefined || JSON.stringify(seen) === JSON.stringify(type) ? type : null,
        );
      }
    },
  };
}

/** Start recording the expressions lowered in `sourceFile`, dropping any earlier table. */
export function openExpressionTable(sourceFile: ts.SourceFile): void {
  loweredExpressions.set(sourceFile, new Map());
}

/** Record that `node` was lowered to `type`. A no-op when no table is open for its file. */
export function recordLoweredExpression(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  type: ShaderType,
): void {
  const table = loweredExpressions.get(sourceFile);
  if (table === undefined) return;
  const start = node.getStart(sourceFile);
  const key = `${start}:${node.getEnd() - start}`;
  const seen = table.get(key);
  if (seen === undefined) table.set(key, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) table.set(key, null);
}

/** Stop recording for `sourceFile` and return what was recorded, in source order. */
export function closeExpressionTable(sourceFile: ts.SourceFile): LoweredExpression[] {
  const table = loweredExpressions.get(sourceFile);
  loweredExpressions.delete(sourceFile);
  if (table === undefined) return [];
  const out: LoweredExpression[] = [];
  for (const [key, type] of table) {
    if (type === null) continue;
    const [start, length] = key.split(':').map(Number) as [number, number];
    out.push({ start, length, type });
  }
  return out.sort((a, b) => a.start - b.start || b.length - a.length);
}

// ─── the constants of no fixed type, and the type each read of one took (change 0134) ──────
//
// A constant of no fixed type (`const K = 3`, Rule 5.1) has no one type: each read takes the type
// the written number would take there (`vi * K` reads a `u32`, `x * K` an `f32`). `symbols`
// records the declaration at the type of its emitted `f32` declaration, so the editor's hover
// reads this table instead: the declaration, in the language's words, and the type of each read
// (item 4, decision Q3). Keyed by the source file, like the tables above; a linked compile keeps
// its entry's reads, in the entry's offsets, and every declaration, in the offsets of its file.

/** One constant of no fixed type, as the editor's hover names it at its declaration. */
export interface AbstractConstDecl {
  /** The file and the offset of the declared name. */
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
  /** `const`, or `static` for a static field that no code writes. */
  readonly keyword: 'const' | 'static';
  /** The initializer as the author wrote it. */
  readonly written: string;
  /** Whether every written number of the initializer is integer-written: such a constant takes
   *  `i32`, `u32`, `f32` or `f64` where it is read, and a float-written one `f32` or `f64`. */
  readonly integerWritten: boolean;
}

/** One read of a constant of no fixed type, with the one type every lowering of it took, or
 *  `null` where they disagree or the read stands in another such constant's initializer. */
export interface AbstractConstRead {
  readonly start: number;
  readonly length: number;
  readonly type: ShaderType | null;
}

/** What one compile knows of its constants of no fixed type. */
export interface AbstractConstTable {
  readonly decls: readonly AbstractConstDecl[];
  readonly reads: readonly AbstractConstRead[];
}

const abstractConstTables = new WeakMap<ts.SourceFile, AbstractConstTable>();

/** Keep `table` as what the compile of `sourceFile` knows of its constants of no fixed type. */
export function recordAbstractConstTable(
  sourceFile: ts.SourceFile,
  table: AbstractConstTable,
): void {
  abstractConstTables.set(sourceFile, table);
}

/** What the latest compile of `sourceFile` knows of its constants of no fixed type, or
 *  `undefined` when none was compiled. */
export function abstractConstTableOf(sourceFile: ts.SourceFile): AbstractConstTable | undefined {
  return abstractConstTables.get(sourceFile);
}

// ─── a function its callers decide, with copies (Rule 8.19, change 0134 items 1 and 4) ───────
//
// A function whose calls ask two or more result types is lowered once for each (`g_u32` beside
// `g`), so the table above records two types at its declaration and at each local of its body,
// and no one written type describes them. This side table holds what the hover says instead:
// at the declaration, the result types in TypeShade's words; at a call, the copy that call
// takes. Keyed by the source file, as the tables above are.

/** Per source file: the result types of each function with copies, by the offset of its name,
 *  and the result type of each call of one, by the offset of the call's callee name. */
const resultCopies = new WeakMap<
  ts.SourceFile,
  {
    readonly decls: Map<number, { readonly name: string; readonly types: readonly ShaderType[] }>;
    readonly calls: Map<number, ShaderType | null>;
  }
>();

function resultCopiesOf(sourceFile: ts.SourceFile) {
  let table = resultCopies.get(sourceFile);
  if (table === undefined)
    resultCopies.set(sourceFile, (table = { decls: new Map(), calls: new Map() }));
  return table;
}

/** Record that the function named at `name` is lowered once for each of `types`. */
export function recordResultCopies(
  sourceFile: ts.SourceFile,
  name: ts.Node,
  shown: string,
  types: readonly ShaderType[],
): void {
  resultCopiesOf(sourceFile).decls.set(name.getStart(sourceFile), { name: shown, types });
}

/** Record that the call whose callee name is `callee` calls the copy that returns `type`. */
export function recordCopyCall(sourceFile: ts.SourceFile, callee: ts.Node, type: ShaderType): void {
  const { calls } = resultCopiesOf(sourceFile);
  const at = callee.getStart(sourceFile);
  const seen = calls.get(at);
  // A call in a body lowered twice (a copy of the function around it) can take two copies.
  if (seen === undefined) calls.set(at, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) calls.set(at, null);
}

/** Forgets what an earlier pass of the use inference recorded (`use-inference.ts`). */
export function resetResultCopies(sourceFile: ts.SourceFile): void {
  resultCopies.delete(sourceFile);
}

/** Whether some function of `sourceFile` has copies whose words the hover shows. */
export function hasResultCopies(sourceFile: ts.SourceFile): boolean {
  return (resultCopies.get(sourceFile)?.decls.size ?? 0) > 0;
}

/** The result types of the function whose name starts at `offset`, when it has copies. */
export function resultCopiesAt(
  sourceFile: ts.SourceFile,
  offset: number,
): { readonly name: string; readonly types: readonly ShaderType[] } | undefined {
  return resultCopies.get(sourceFile)?.decls.get(offset);
}

/** The result type of the call whose callee name starts at `offset`, when it calls a copy. */
export function copyCallAt(sourceFile: ts.SourceFile, offset: number): ShaderType | undefined {
  return resultCopies.get(sourceFile)?.calls.get(offset) ?? undefined;
}
