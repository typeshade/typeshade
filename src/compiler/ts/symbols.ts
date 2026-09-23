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
  /** Whether a `local` or a `binding` was declared `let` (`true`) or `const` (`false`), which
   *  is also what decides a storage binding's access mode. Absent for every other kind. */
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
