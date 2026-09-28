// Multi-file "use typeshade" program from a list of files: every file kept whole, one module.
//
// The public paths follow an import from one source (`compile(source, { readDocument })`, Rule
// 3.9); this is the in-tree form that takes the files as a list instead, for the tests and
// tools that hold a program as `{ fileName, source }` pairs. It is not exported from any
// subpath. Both go through one linker (`link.ts`), so the two cannot compile one program into
// two modules: this form only adds that every file handed in is kept whole, where a compile
// from one source keeps of an imported file what the source reaches.

import ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  DeclarableCapability,
  FuncDecl,
  OverrideDecl,
  StructDecl,
} from '../../core/ir/nodes.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { hasUseTypeshadeDirective } from './directive.js';
import { compileTsProgram, type TsCompilerDiagnostic } from './source-file.js';
import { emittedStructDecls } from './structs.js';
import type { DeclaredSymbol } from './symbols.js';

export interface TsSourceFileInput {
  readonly fileName: string;
  readonly source: string;
}

export interface CompileTsSourcesResult {
  readonly funcs: readonly FuncDecl[];
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  /** The module constants of every file, each read by its own file's functions (Rule 3.9). */
  readonly consts: readonly ConstDecl[];
  /** The structs, resource bindings and overrides of every file: a program is one module, and
   *  a struct or a binding is module scope in WGSL whichever file declares it. Two bindings of
   *  one name are a diagnostic; two structs of one name are two structs, the later one emitted
   *  under a generated name (Rule 3.2). */
  readonly structs: readonly StructDecl[];
  readonly bindings: readonly BindingDecl[];
  readonly overrides: readonly OverrideDecl[];
  /** The capabilities the program's `"enable <extension>";` directives turn on (§50), merged
   *  over every file: a program is one module, so two files naming one extension is one
   *  enable, not a duplicate declaration. Empty for a program that enables nothing. */
  readonly enables: readonly DeclarableCapability[];
  /** What the front end declared while lowering the ENTRY file (`entry`, or the first file
   *  given), as `CompileTsSourceResult.symbols` records it. One file only: a `DeclaredSymbol`
   *  span is a UTF-16 offset, which means nothing without the file it indexes, and this result
   *  names no source file. Empty when nothing was lowered. */
  readonly symbols: readonly DeclaredSymbol[];
  readonly wgsl?: string;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** Compile a set of `"use typeshade"` files into one WGSL module, resolving
 *  `import { name } from "./file"` between them.
 *
 *  `entry` names the file whose names the module keeps as written when two files declare one
 *  (Rule 3.2), whose symbols the result reports, and whose position anchors a whole-module emit
 *  failure; it defaults to the first file given. Every file is kept whole regardless — the
 *  list is the program — and an import names a file of the list. */
export function compileTsSources(
  files: readonly TsSourceFileInput[],
  entry?: string,
): CompileTsSourcesResult {
  const diagnostics: TsCompilerDiagnostic[] = [];
  const empty = (): CompileTsSourcesResult => ({
    funcs: [],
    diagnostics,
    consts: [],
    structs: [],
    bindings: [],
    overrides: [],
    enables: [],
    symbols: [],
  });
  const inputs = files.map((f) => ({ fileName: normalizePath(f.fileName), source: f.source }));
  const record = new Map(inputs.map((f) => [f.fileName, f.source]));
  const shaders: typeof inputs = [];
  for (const f of inputs) {
    const sf = ts.createSourceFile(f.fileName, f.source, ts.ScriptTarget.Latest, true);
    if (hasUseTypeshadeDirective(sf)) {
      shaders.push(f);
      continue;
    }
    diagnostics.push(
      makeDiagnostic(
        sf,
        undefined,
        `File "${f.fileName}" is missing "use typeshade".`,
        TS_CODES.MISSING_DIRECTIVE,
      ),
    );
  }

  const entryName = entry === undefined ? inputs[0]?.fileName : normalizePath(entry);
  const entryFile = inputs.find((f) => f.fileName === entryName);
  if (entryFile === undefined) {
    const anchor = ts.createSourceFile(
      inputs[0]?.fileName ?? 'typeshade',
      inputs[0]?.source ?? '',
      ts.ScriptTarget.Latest,
      true,
    );
    diagnostics.push(
      makeDiagnostic(
        anchor,
        undefined,
        `Entry "${entry}" is not in the source set.`,
        TS_CODES.UNSUPPORTED,
      ),
    );
    return empty();
  }
  if (!shaders.includes(entryFile)) return empty();

  const { result } = compileTsProgram(entryFile.source, {
    fileName: entryFile.fileName,
    readDocument: (fileName) => record.get(normalizePath(fileName)),
    roots: shaders
      .filter((f) => f !== entryFile)
      .map((f) => ({ fileName: f.fileName, text: f.source })),
  });
  diagnostics.push(...result.diagnostics);
  return {
    funcs: result.funcs,
    diagnostics,
    consts: result.consts,
    structs: emittedStructDecls(result.structs),
    bindings: result.bindings,
    overrides: result.overrides,
    enables: result.enables,
    symbols: result.symbols,
    ...(result.wgsl !== undefined ? { wgsl: result.wgsl } : {}),
  };
}
