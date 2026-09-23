// ═══ The deprecation window before an integer-written literal types as i32 (§13, #148) ═══
//
// WGSL concretizes an AbstractInt to `i32` when nothing else decides (wgsl.txt:3929-3933,
// 4100-4104); GLSL's `5` is an `int`; and a TypeScript reader expects `let i = 0` to index an
// array. This compiler types every numeric literal `f32`, so `let i = 0` is `var i: f32 = 0.0;`
// and `xs[i]` is then `Index must be i32 or u32`.
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
// `let i = 0`, `const K = 5`, `const n = 2 + 3`. That is the shape the flip moves and the shape
// an author can act on: writing `0.` keeps `f32`, writing `let i: f32 = 0` does too. A literal
// in any other position is already decided by something — an annotated declaration, an
// argument, an index, a peer in an arithmetic expression — and `lit-coerce.ts` and
// `numeric.ts` retarget it there today, so the flip does not move it and warning about it
// would be noise the author cannot act on.

import ts from 'typescript';
import { isIntegerLiteralTree } from './lit-coerce.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** Every `let`/`const` declaration in `sourceFile`, at module scope or inside a function,
 *  whose initialiser is an integer-written literal tree and which declares no type.
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
      node.initializer !== undefined
    ) {
      if (ts.isIdentifier(node.name) && isIntegerLiteralTree(node.initializer)) {
        const name = node.name.text;
        // A BARE literal has a one-character fix, so the message writes it out. A TREE of them
        // (`2 + 3`) does not — a decimal point on one leaf is enough, which reads as a typo —
        // so that one is told to annotate, which says the same thing and keeps the arithmetic
        // legible.
        const fix = ts.isNumericLiteral(node.initializer)
          ? `Write "${name} = ${node.initializer.getText(sourceFile)}." to keep f32`
          : `Annotate it — "${name}: f32 = ${node.initializer.getText(sourceFile)}" — to keep f32`;
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
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}
