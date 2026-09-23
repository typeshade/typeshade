// Multi-file "use typeshade" program: relative import { name } from "./file"

import ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  DeclarableCapability,
  FuncDecl,
  OverrideDecl,
  StructDecl,
} from '../../core/ir/nodes.js';
import { typeKey } from '../../core/ir/types.js';
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js';
import { requiredCaps } from '../../core/passes/required-caps.js';
import { hasUseTypeshadeDirective } from './directive.js';
import { reportCrossDeclarationCollisions, type TsCompilerDiagnostic } from './source-file.js';
import { collectStructs, emittedStructDecls, type CollectedStruct } from './structs.js';
import { collectBindings } from './bindings.js';
import { collectEnables } from './enables.js';
import { collectOverrides } from './overrides.js';
import { fillFunctionBody, parseSignature } from './lower/function.js';
import { analyzeSemantics } from './semantic.js';
import { collectModuleConsts } from './module-const.js';
import { collectModuleVars } from './module-vars.js';
import { TS_CODES } from './codes.js';
import { checkRecursion, type RecursionNode } from './recursion.js';
import { fileFunctionsOf } from './context.js';
import { backendDiagnostic, makeDiagnostic, syntaxDiagnostics } from './diagnostic.js';
import type { DeclaredSymbol } from './symbols.js';
import { unknownNameSentence } from './unknown-names.js';

export interface TsSourceFileInput {
  readonly fileName: string;
  readonly source: string;
}

export interface CompileTsSourcesResult {
  readonly funcs: readonly FuncDecl[];
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  /** Module constants declared in the ENTRY file. Collected per-entry, not per-file, because
   *  a `const` is module scope and the entry is the module: two files declaring `PI` are two
   *  modules that each have one, not one module with a duplicate. */
  readonly consts: readonly ConstDecl[];
  /** The structs, resource bindings and overrides of EVERY file, merged (roadmap 0.5 item 14,
   *  #74): a multi-file program is one module, and a struct or a binding is module scope in
   *  WGSL whichever file declares it. A name two files both declare is a diagnostic, and the
   *  `declare` bindings are numbered in file order so two files' first bindings do not share
   *  a slot. Module constants keep the entry-only rule above. */
  readonly structs: readonly StructDecl[];
  readonly bindings: readonly BindingDecl[];
  readonly overrides: readonly OverrideDecl[];
  /** The capabilities the program's `"enable <extension>";` directives turn on (§50), merged
   *  over every file: a multi-file program is one module, so two files naming one extension
   *  is one enable, not a duplicate declaration. Empty for a program that enables nothing.
   *  Reported so a caller assembling its own `ModuleDecl` from this result does not silently
   *  drop the directives — the caps a `@builtin(...)` id derives need no entry here, since
   *  `requiredCaps` reads them straight off the declarations. */
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

function resolveSpecifier(fromFile: string, spec: string): string {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  let target = spec.startsWith('.') ? (dir ? `${dir}/${spec}` : spec) : spec;
  if (!target.endsWith('.ts')) target += '.ts';
  return normalizePath(target);
}

/** Compile a set of `"use typeshade"` files into one WGSL module, resolving
 *  `import { name } from "./file"` between them.
 *
 *  `entry` names the file whose module constants are collected and whose position anchors a
 *  whole-module emit failure; it defaults to the first file given. Every function in every
 *  file is lowered and emitted regardless — a multi-file program is one module, and the entry
 *  selects module scope, not a reachability root. */
export function compileTsSources(
  files: readonly TsSourceFileInput[],
  entry?: string,
): CompileTsSourcesResult {
  const diagnostics: TsCompilerDiagnostic[] = [];
  const symbols: DeclaredSymbol[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  const exports = new Map<
    string,
    Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }>
  >();

  for (const f of files) {
    const name = normalizePath(f.fileName);
    const sf = ts.createSourceFile(name, f.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    parsed.set(name, sf);
    if (!hasUseTypeshadeDirective(sf)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          undefined,
          `File "${name}" is missing "use typeshade".`,
          TS_CODES.MISSING_DIRECTIVE,
        ),
      );
    }
  }

  // A file TypeScript could not parse takes the whole program down: nothing is lowered or
  // emitted, and the parse errors, each naming its file, are the diagnostics (see
  // `compileTsSource`).
  const syntax = [...parsed.values()].flatMap((sf) => syntaxDiagnostics(sf));
  if (syntax.length > 0) {
    diagnostics.push(...syntax);
    return {
      funcs: [],
      diagnostics,
      consts: [],
      structs: [],
      bindings: [],
      overrides: [],
      enables: [],
      symbols,
    };
  }

  for (const [name, sf] of parsed) {
    // The statement-level check `compileTsSource` runs on a single file (a top-level `let`,
    // an expression statement that is not the directive, and the rest). It was missing from
    // the multi-file path, so a construct rejected in a one-file program was accepted in a
    // two-file one — including in the documentation gate, which compiles every multi-file
    // fence in README.md and docs/ through this function.
    analyzeSemantics(sf, diagnostics);
    const table = new Map<
      string,
      { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }
    >();
    for (const stmt of sf.statements) {
      if (!ts.isFunctionDeclaration(stmt)) continue;
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const stub = parseSignature(stmt, sf, diagnostics);
      if (!stub) continue;
      if (table.has(stub.name)) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            `Duplicate function "${stub.name}" in "${name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        );
        continue;
      }
      table.set(stub.name, { stub, node: stmt, sf });
      (stub as { exported?: boolean }).exported = exported;
    }
    exports.set(name, table);
  }

  const fileCallees = new Map<string, Map<string, FuncDecl>>();
  for (const [name, table] of exports) {
    const callees = new Map<string, FuncDecl>();
    for (const [fn, rec] of table) callees.set(fn, rec.stub);
    fileCallees.set(name, callees);
  }

  for (const [name, sf] of parsed) {
    const callees = fileCallees.get(name)!;
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      if (
        !stmt.importClause ||
        !stmt.moduleSpecifier ||
        !ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            'Import must be `import { name } from "./file"`.',
            TS_CODES.UNSUPPORTED,
          ),
        );
        continue;
      }
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith('.')) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            `Only relative imports are supported (got "${spec}").`,
            TS_CODES.UNSUPPORTED,
          ),
        );
        continue;
      }
      const target = resolveSpecifier(name, spec);
      const targetTable = exports.get(target);
      if (!targetTable) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            `Cannot resolve import "${spec}" from "${name}" (looked for "${target}").`,
            TS_CODES.UNSUPPORTED,
          ),
        );
        continue;
      }
      const bindings = stmt.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            'Default / namespace import is not supported. Use `import { name } from "./file"`.',
            TS_CODES.UNSUPPORTED,
          ),
        );
        continue;
      }
      for (const el of bindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const local = el.name.text;
        const rec = targetTable.get(imported);
        if (!rec) {
          // On the imported name, as TypeScript's TS2305 is, with the export it is spelled like.
          const exported = [...targetTable]
            .filter(([, r]) => (r.stub as { exported?: boolean } | undefined)?.exported !== false)
            .map(([n]) => n);
          diagnostics.push(
            makeDiagnostic(
              sf,
              el.propertyName ?? el.name,
              unknownNameSentence(`"${target}" has no function "${imported}".`, imported, [
                exported,
              ]),
              TS_CODES.UNSUPPORTED,
            ),
          );
          continue;
        }
        if (rec.stub && (rec.stub as { exported?: boolean }).exported === false) {
          diagnostics.push(
            makeDiagnostic(
              sf,
              el,
              `"${imported}" is not exported from "${target}".`,
              TS_CODES.UNSUPPORTED,
            ),
          );
          continue;
        }
        callees.set(local, rec.stub);
      }
    }
  }

  const entryName = entry === undefined ? [...parsed.keys()][0] : normalizePath(entry);
  const entrySf = entryName === undefined ? undefined : parsed.get(entryName);
  if (entry !== undefined && entrySf === undefined) {
    diagnostics.push(
      makeDiagnostic(
        [...parsed.values()][0] ?? emptySourceFile(files),
        undefined,
        `Entry "${entry}" is not in the source set.`,
        TS_CODES.UNSUPPORTED,
      ),
    );
  }

  // The structs, resource bindings and overrides of EVERY file (roadmap 0.5 item 14, #74). The
  // single-file path has always collected them before lowering; this path lowered functions
  // and module constants and nothing else, so a one-file program with a struct or a `declare`
  // binding compiled through `compile()` and was refused through here with "Unknown
  // identifier", and a two-file program with either could not be compiled at all. A
  // multi-file program is one module, so the lists are merged: a name two files declare is
  // reported once, naming both, and each file's `declare` bindings are numbered after the
  // earlier files' so two files' first bindings do not share @group(0) @binding(0).
  const perFile: FileDeclarations[] = [];
  let nextBinding = 0;
  for (const [name, sf] of parsed) {
    const sink = name === entryName ? symbols : undefined;
    const structs = collectStructs(sf, diagnostics, sink);
    // Per FILE, not merged: a binding's struct is declared in the file that declares the
    // binding, or the program would not have typechecked. The host-shareable rules (§51) read
    // through it.
    const bindings = collectBindings(
      sf,
      diagnostics,
      sink,
      nextBinding,
      emittedStructDecls(structs),
    );
    for (const b of bindings) if (b.group === 0) nextBinding = Math.max(nextBinding, b.binding + 1);
    const glslNames = new Set<string>([
      ...structs.flatMap((s) => s.decl.fields.map((f) => f.name)),
      ...bindings.map((b) => b.name),
    ]);
    const overrides = collectOverrides(sf, diagnostics, sink, glslNames);
    perFile.push({
      name,
      sf,
      structs,
      bindings,
      overrides,
      enables: collectEnables(sf, diagnostics),
    });
  }
  const merged = mergeDeclarations(perFile, diagnostics);

  // BEFORE the bodies are filled, not after. `fillFunctionBody` takes the module constants as
  // a parameter and defines each one in the lowering scope; collect them afterwards and every
  // reference to one inside a function is TS8022 "Unknown identifier". Both pre-merge
  // implementations had this order wrong — `sources.ts` collected them last too — so a
  // multi-file program simply could not use a module constant. The single-file path in
  // `source-file.ts` has always collected first, which is why it works there.
  const consts = entrySf
    ? collectModuleConsts(entrySf, diagnostics, undefined, emittedStructDecls(merged.structs))
    : [];
  const vars = entrySf
    ? collectModuleVars(entrySf, diagnostics, undefined, consts, emittedStructDecls(merged.structs))
    : [];
  // A name two different collectors claim in the entry file, as the single-file path reports it.
  if (entrySf)
    reportCrossDeclarationCollisions(
      entrySf,
      diagnostics,
      consts,
      merged.bindings,
      merged.overrides,
      vars,
    );
  // A module variable (§24) is collected from the entry file, as a const is. A top-level `let`
  // in another file would otherwise vanish without a word, and a read of it in that file would
  // be an "Unknown identifier" that names no cause; roadmap item 14 carries the other files'
  // declarations, and until then the refusal says where the declaration goes.
  for (const [fileName, sf] of parsed) {
    if (sf === entrySf) continue;
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      if ((stmt.declarationList.flags & ts.NodeFlags.Let) === 0) continue;
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
      diagnostics.push(
        makeDiagnostic(
          sf,
          stmt,
          `A module variable is declared in the entry file, and "${fileName}" is not the entry. ` +
            `Move this let there, or pass the value as a parameter.`,
          TS_CODES.TOP_LEVEL,
        ),
      );
    }
  }

  const funcs: FuncDecl[] = [];
  const graph: RecursionNode[] = [];
  // A function that writes no return type says it in its body (Rule 8.19), so a call that needs
  // it first, from any file, lowers that body then: each waits in `pending` until a call or its
  // turn comes. A call back into a body still being lowered closes a cycle, which a call here
  // always names by an identifier the graph below resolves, so `checkRecursion` names it.
  const pending = new Map<FuncDecl, () => void>();
  const inferring = new Set<FuncDecl>();
  // Every body being lowered, innermost last.
  const filling: FuncDecl[] = [];
  // The ones whose body did not lower, and so says nothing it returns, and those a call cycle
  // runs through, whose return type waits on itself.
  const unsaid = new Set<FuncDecl>();
  const cyclic = new Set<FuncDecl>();
  const ensure = (decl: FuncDecl): boolean => {
    const fill = pending.get(decl);
    if (fill !== undefined) {
      pending.delete(decl);
      fill();
    }
    if (inferring.has(decl)) {
      for (const f of filling.slice(filling.lastIndexOf(decl))) if (inferring.has(f)) cyclic.add(f);
      return false;
    }
    return !unsaid.has(decl);
  };
  for (const callees of fileCallees.values()) fileFunctionsOf(callees).ensure = ensure;
  // Only the entry file feeds the symbol table, since a span alone cannot say which file it
  // indexes. `entryName` above is that file: already normalized, so the caller's `'./main.ts'`
  // and `'main.ts'` name one file and neither can be handed the other's offsets.
  const inOrder: (() => void)[] = [];
  for (const [name, table] of exports) {
    const callees = fileCallees.get(name)!;
    for (const rec of table.values()) {
      // Every file's functions see the MERGED structs, bindings and overrides (one module);
      // `consts` is the entry file's, collected above, and the symbol sink is passed only for
      // the entry file.
      const sink = name === entryName ? symbols : undefined;
      const infers = rec.node.type === undefined && rec.stub.stage === undefined;
      const fill = (): void => {
        const before = diagnostics.length;
        filling.push(rec.stub);
        if (infers) inferring.add(rec.stub);
        try {
          fillFunctionBody(
            rec.node,
            rec.stub,
            rec.sf,
            diagnostics,
            callees,
            consts,
            merged.bindings,
            merged.structs,
            sink,
            merged.overrides,
            vars,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            infers,
          );
        } finally {
          filling.pop();
          inferring.delete(rec.stub);
        }
        // A body that did not lower says nothing it returns, and a call of it adds nothing.
        if (
          infers &&
          (cyclic.has(rec.stub) ||
            (typeKey(rec.stub.ret) === 'void' &&
              diagnostics.slice(before).some((d) => d.category === 'error')))
        ) {
          unsaid.add(rec.stub);
        }
        funcs.push(rec.stub);
      };
      if (infers) {
        pending.set(rec.stub, fill);
        inOrder.push(() => ensure(rec.stub));
      } else {
        inOrder.push(fill);
      }
      // The graph key is the EMITTED name, not the local one: across files the same function
      // reaches its callers under whatever name each `import` bound it to, and a cycle is a
      // cycle in the emitted WGSL. `callees` is already that mapping, per file.
      graph.push({
        name: rec.stub.name,
        decl: rec.node,
        sourceFile: rec.sf,
        resolve: (callee: string) => callees.get(callee)?.name,
      });
    }
  }
  // Each function in file order; one a call lowered already is not lowered again.
  for (const run of inOrder) run();
  // A call cycle emits WGSL Tint refuses (#48). Across files it can be spelled through an
  // import, which is exactly why the resolver above goes through `callees`.
  checkRecursion(graph, diagnostics);

  let wgsl: string | undefined;
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      // `emitModule` only when there is something for its other slots to hold: a constant or
      // a module variable (§24; a `vars`-only module took the bare path before the plain
      // top-level `let` test found the variable missing from the text). `emitFuncs` is the
      // bare-functions form the single-file path uses too, and switching unconditionally would
      // change the emitted text of every multi-file program that has neither.
      //
      // A module needing a DIRECTIVE takes the full path whatever its declarations hold
      // (§50). `emitFuncs` writes no preamble and runs neither `assertCaps` nor
      // `assertBuiltins`, so a two-file program whose only notable feature is
      // `@builtin(primitive_index)` emitted with zero diagnostics and no `enable` line —
      // measured on Tint as `use of '@builtin(primitive_index)' requires enabling extension
      // 'primitive_index'`. `requiredCaps`, not `merged.enables`: the caps that matter here
      // are the ones a `@builtin(...)` id DERIVES, which no declaration list mentions.
      const structs = emittedStructDecls(merged.structs);
      const decl = {
        consts,
        structs,
        bindings: merged.bindings,
        funcs,
        overrides: merged.overrides,
        vars,
        enables: merged.enables,
      };
      wgsl =
        consts.length > 0 ||
        vars.length > 0 ||
        structs.length > 0 ||
        merged.bindings.length > 0 ||
        merged.overrides.length > 0 ||
        requiredCaps(decl).length > 0
          ? emitModule(decl)
          : emitFuncs(funcs);
    } catch (e) {
      // `backendDiagnostic` (X-GIS #37's honest-failure work) rather than the message built
      // by hand here; the anchor is the resolved entry, which is what `entry` was already
      // being used for above.
      diagnostics.push(
        backendDiagnostic(entrySf ?? [...parsed.values()][0] ?? emptySourceFile(files), e),
      );
    }
  }
  return {
    funcs,
    diagnostics,
    consts,
    structs: emittedStructDecls(merged.structs),
    bindings: merged.bindings,
    overrides: merged.overrides,
    enables: merged.enables,
    symbols,
    wgsl,
  };
}

/** One file's module-scope declarations, before the merge. */
interface FileDeclarations {
  readonly name: string;
  readonly sf: ts.SourceFile;
  readonly structs: readonly CollectedStruct[];
  readonly bindings: readonly BindingDecl[];
  readonly overrides: readonly OverrideDecl[];
  readonly enables: readonly DeclarableCapability[];
}

/** Merges every file's structs, bindings and overrides into one module's (roadmap 0.5 item 14).
 *  A name declared in two files is reported once, naming both, and the second declaration is
 *  dropped so the emit that follows the diagnostic is still one module; a bind slot two files
 *  both claim (an explicit `resource(...)` slot colliding with another file's) is reported the
 *  same way. Order is file order, which is what the caller gave. */
function mergeDeclarations(
  files: readonly FileDeclarations[],
  diagnostics: TsCompilerDiagnostic[],
): {
  structs: CollectedStruct[];
  bindings: BindingDecl[];
  overrides: OverrideDecl[];
  enables: DeclarableCapability[];
} {
  const owner = new Map<string, string>();
  const slots = new Map<string, string>();
  const structs: CollectedStruct[] = [];
  const bindings: BindingDecl[] = [];
  const overrides: OverrideDecl[] = [];
  // A multi-file program is one module, so its `"enable ..."` directives are one set: two
  // files naming the same extension is not a duplicate declaration, it is one enable.
  const enables: DeclarableCapability[] = [];
  const claim = (kind: string, name: string, file: FileDeclarations): boolean => {
    const prev = owner.get(name);
    if (prev !== undefined && prev !== file.name) {
      diagnostics.push(
        makeDiagnostic(
          file.sf,
          undefined,
          `${kind} "${name}" is declared in both "${prev}" and "${file.name}". A multi-file ` +
            `program is one module, so a name is declared once; rename one or move it.`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
      return false;
    }
    owner.set(name, file.name);
    return true;
  };
  for (const f of files) {
    for (const c of f.enables) if (!enables.includes(c)) enables.push(c);
    for (const s of f.structs) if (claim('Struct', s.decl.name, f)) structs.push(s);
    for (const o of f.overrides) if (claim('Override', o.name, f)) overrides.push(o);
    for (const b of f.bindings) {
      if (!claim('Binding', b.name, f)) continue;
      const slot = `@group(${b.group}) @binding(${b.binding})`;
      const prev = slots.get(slot);
      if (prev !== undefined) {
        diagnostics.push(
          makeDiagnostic(
            f.sf,
            undefined,
            `Binding "${b.name}" in "${f.name}" and ${prev} both occupy ${slot}. Give one an ` +
              `explicit slot, uniform<T>({ group, binding }) or storage<T>({ group, binding }).`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        );
        continue;
      }
      slots.set(slot, `"${b.name}" in "${f.name}"`);
      bindings.push(b);
    }
  }
  return { structs, bindings, overrides, enables };
}

/** A diagnostic needs a source file to carry a position. With no parsable file left to point
 *  at — an empty `files` array — an empty one is the honest anchor. */
function emptySourceFile(files: readonly TsSourceFileInput[]): ts.SourceFile {
  return ts.createSourceFile(
    files[0]?.fileName ?? 'typeshade',
    '',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
