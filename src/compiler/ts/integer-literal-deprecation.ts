// ═══ The deprecation window before an integer-written literal types as i32 (§13, #148) ═══
//
// WGSL concretizes an AbstractInt to `i32` when nothing else decides (wgsl.txt:3929-3933,
// 4100-4104); GLSL's `5` is an `int`; and a TypeScript reader expects `let i = 0` to index an
// array. Without a declared integer context or use, the compiler types a numeric literal
// `f32`, so `let i = 0` is `var i: f32 = 0.0;` and `xs[i]` is then `Index must be i32 or u32`.
//
// Flipping that default is a BREAKING change to every module that leans on it — a literal that
// types `f32` today reaches a `+` beside an `f32`, a `vec4(...)` argument, a return — so the
// roadmap's item 25 gives it a deprecation window, and THIS IS THAT WINDOW. Step one only: the
// diagnostic exists, it is OFF by default, and the default typing has not moved. A caller that
// wants to know which lines will change asks for it:
//
//   compile(source, { deprecations: true })
//
// Nothing else in the compiler reads the flag. The emitted text with it on is byte-identical
// to the emit with it off, and the flip is a separate change with its own golden review.
//
// SCOPE: a DECLARATION with no type annotation whose initialiser is written as an integer —
// `let i = 0`, `const K = 5`, `const n = 2 + 3`, excluding a local that already takes an
// integer type from its declared uses (changes 0036 and 0037), or a counted loop's initializer
// (Rule 7.5). An unannotated class field also warns when its collector gives the initializer
// the f32 default (Rule 8.14). That is the shape the flip moves and the shape
// an author can act on: writing `0.` keeps `f32`, writing `let i: f32 = 0` does too. A literal
// in any other position is already decided by something — an annotated declaration, an
// argument, an index, a peer in an arithmetic expression — and `lit-coerce.ts` and
// `numeric.ts` retarget it there today, so the flip does not move it and warning about it
// would be noise the author cannot act on.

import ts from 'typescript';
import { isIntegerLiteralTree } from './lit-coerce.js';
import { localNumericInference } from './local-numeric-inference.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { DeclaredSymbol } from './symbols.js';
import { optionalInner } from './optional.js';

/** Every `let`/`const` declaration in `sourceFile`, at module scope or inside a function,
 *  whose initialiser is an integer-written literal tree and which declares no type or integer use.
 *
 *  Reported as a WARNING, not an error: the program compiles today and compiles after the
 *  flip — what changes is the TYPE it compiles to, so an author who wants `f32` has a line to
 *  edit and an author who wanted `i32` all along has nothing to do. */
export function reportIntegerLiteralDeprecations(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.type === undefined &&
      node.initializer !== undefined &&
      !isForCounterDeclaration(node)
    ) {
      if (
        ts.isIdentifier(node.name) &&
        isIntegerLiteralTree(node.initializer) &&
        localNumericInference(node, sourceFile)?.type === undefined
      ) {
        report(sourceFile, node, node.name.text, node.initializer, diagnostics);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/** Read the field type its collector recorded, after lowering can refuse its initializer.
 *  Instance fields and static constants/variables do not share an initializer grammar.
 *  The symbol table keeps this warning from guessing a type or accepting a refused field. */
export function reportFieldLiteralDeprecations(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols: readonly DeclaredSymbol[],
): void {
  const f32Names = new Set(
    symbols.flatMap((symbol) => {
      const type = optionalInner(symbol.type) ?? symbol.type;
      return type.kind === 'scalar' && type.scalar === 'f32'
        ? [`${symbol.start}:${symbol.length}`]
        : [];
    }),
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyDeclaration(node) &&
      node.type === undefined &&
      node.exclamationToken === undefined &&
      node.initializer !== undefined &&
      (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
      isIntegerLiteralTree(node.initializer) &&
      f32Names.has(`${node.name.getStart(sourceFile)}:${node.name.getWidth(sourceFile)}`) &&
      !isAmbient(node) &&
      !diagnostics.some(
        (d) => d.category === 'error' && d.start >= node.getStart(sourceFile) && d.start < node.end,
      )
    ) {
      report(
        sourceFile,
        node,
        node.name.text,
        node.initializer,
        diagnostics,
        node.questionToken !== undefined,
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/** TypeScript refuses any initializer in an ambient declaration (TS1039). */
function isAmbient(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
    if (
      ts.canHaveModifiers(at) &&
      ts.getModifiers(at)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
    )
      return true;
  }
  return false;
}

function report(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  initializer: ts.Expression,
  diagnostics: TsCompilerDiagnostic[],
  optional = false,
): void {
  const writtenName = `${name}${optional ? '?' : ''}`;
  // A bare decimal literal has a one-character fix. A radix literal or a tree needs an
  // annotation: `0x10.` is invalid, and changing one leaf of `2 + 3` reads as a typo.
  const fix =
    ts.isNumericLiteral(initializer) && !/^0[xob]/i.test(initializer.getText(sourceFile))
      ? `Write "${writtenName} = ${initializer.getText(sourceFile)}." to keep f32`
      : `Annotate it — "${writtenName}: f32 = ${initializer.getText(sourceFile)}" — to keep f32`;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `"${name}" is written as an integer and types as f32 today; it will type as i32 ` +
        `(§13, #148). ${fix}, or leave it and take i32.`,
      TS_CODES.INT_LITERAL_DEPRECATION,
      'warning',
    ),
  );
}

/** The initializer lowerForInit types as i32 or u32 even without a declared integer use.
 *  Keep incomplete or multi-declaration headers and ordinary body locals on their existing path. */
function isForCounterDeclaration(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!list || !ts.isVariableDeclarationList(list)) return false;
  const loop = list.parent;
  return (
    loop !== undefined &&
    ts.isForStatement(loop) &&
    loop.initializer === list &&
    list.declarations.length === 1 &&
    (list.flags & ts.NodeFlags.Let) !== 0 &&
    loop.condition !== undefined &&
    loop.incrementor !== undefined
  );
}
