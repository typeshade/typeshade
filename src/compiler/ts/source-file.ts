// Implements: Rule 7.10
// Implements: Rule 8.1 (docs/language-design.md; traced in reqs/): an entry point is a function

import {
  beginUseInference,
  beginUseInferencePass,
  callersSwitchedOff,
  endUseInferencePass,
  switchCallersOff,
  switchedOffCalls,
} from './use-inference.js';
import {
  compilingCheckedEdit,
  markProjectedAnnotations,
  projectedAnnotationStarts,
  projectedReaderOf,
  reportAbstractDivisions,
  resetAbstractConsts,
  abstractConstFacts,
  exportedConstantNames,
  markExportedConstants,
} from './abstract-const.js';
import { withoutKernelLoops } from './lower/kernel-methods.js';
import ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  DeclarableCapability,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  OverrideDecl,
} from '../../core/ir/nodes.js';
import { refuseStageCalls, stageCallOf } from './stage-call.js';
import {
  refuseQualifierTypes,
  refuseRemovedQualifiers,
  warnDecoratedForm,
} from './decorated-form.js';
import { emitWgslKept } from './source-file/wgsl-lowered.js';
import { kernelLoopDiagnostics } from './kernel-loops.js';
import { findUseTypeshadeDirective, hasUseTypeshadeDirective, USE_TYPESHADE } from './directive.js';
import { lowerSourceFunctions } from './lower/function.js';
import { dropDeadStorageWriters, settleInference } from './storage-access.js';
import { sequenceEffects } from './sequence.js';
import { analyzeSemantics, carryRefusals, reportUndeclaredValues } from './semantic.js';
import { collectModuleConsts } from './module-const.js';
import { collectBindings } from './bindings.js';
import { collectOverrides } from './overrides.js';
import { collectModuleVars } from './module-vars.js';
import { separateModuleVars } from './module-var-names.js';
import { collectStructs, emittedStructDecls, type CollectedStruct } from './structs.js';
import type { DeclaredSymbol, LoweredExpression } from './symbols.js';
import type { SourceSpan } from '../../core/ir/span.js';
import {
  abstractConstTableOf,
  closeExpressionTable,
  openExpressionTable,
  recordAbstractConstTable,
  mapResultCopies,
  resetResultCopies,
} from './symbols.js';
import { orderedStructDecls, typesOfFunctions, usedOptionalDecls } from './optional.js';
import { optionalHelpersOf } from './optional/helpers.js';
import { TS_CODES } from './codes.js';
import {
  backendDiagnostic,
  diagnosticAtSpan,
  dropRepeatedDiagnostics,
  sortDiagnosticsByPosition,
  makeDiagnostic,
  sortFileDiagnosticsByPosition,
  syntaxDiagnostics,
} from './diagnostic.js';
import { collectEnables } from './enables.js';
import {
  hasModuleReference,
  linkProgram,
  type ImportHooks,
  type LinkedProgram,
  type LinkRoot,
} from './link.js';
import { normalizeSourcePath } from './specifier.js';
import { uniformityViolations } from '../../core/passes/uniformity.js';
import { reasonKey, rewriteDerivatives } from '../../core/passes/derivative-rewrite.js';
import { checkBuiltinTypeForms } from './builtin-type-form.js';
import { giveEntryLocations } from './entry-locations.js';
import { locateProgramErrors } from './program-refusals.js';
import { resolveSpecifierFile } from './specifier.js';
import { interstageMismatches } from '../../core/passes/lint/rules/interstage-io.js';
import {
  authorTypeText,
  withLinkedOrigin,
  withWrittenStructs,
  type LinkedOrigin,
} from './written-context.js';
import { uniformityMessage, unreachedMessage } from './source-file/uniformity.js';

/** Options controlling compilation of a TypeShade TypeScript source string. */
export interface CompileTsSourceOptions {
  readonly fileName?: string;
  /** When `true` (the default), a file without the `"use typeshade"` directive gets one
   * `MISSING_DIRECTIVE` error diagnostic and an otherwise empty result, so a caller cannot
   * mistake a file that never opted in for a program that compiled to nothing. Pass `false`
   * for a probe that only wants `hasDirective` (the language service's navigation and semantic
   * tokens do): the same empty result comes back with no diagnostic. */
  readonly requireDirective?: boolean;
  /** When `false`, skips `packModule`/WGSL emission entirely: the front end still parses,
   * analyzes and lowers to IR, but `CompileTsSourceResult.wgsl` is always `undefined`. The
   * language service's diagnostics analysis uses this so `getDiagnostics` never produces
   * shader text (design doc §8). Defaults to `true`, the pre-existing behavior. */
  readonly emit?: boolean;
  /** A pre-parsed source file to analyze instead of parsing `source` again — the language
   * service passes its own TypeScript program's `SourceFile` here so `getDiagnostics` runs on
   * the exact node identities the program already built, never a second parse (design doc §5,
   * §8). `source` must still be given (some callers, and every existing one, use it as the
   * text and never set this); when set, `source` is not re-parsed and `options.fileName` is
   * ignored in favor of `sourceFile.fileName`. */
  readonly sourceFile?: ts.SourceFile;
  /** When `true`, report the DEPRECATION warnings for spellings whose meaning is scheduled to
   * change (Rule 13.10). No window is open today, so the flag reports nothing: change 0134
   * retired the one warning it had. Off by default, and off is the whole of the compiler's
   * behaviour: the flag adds warnings and moves no emitted byte, so a build that turns it on
   * and a build that does not produce the same shader. */
  readonly deprecations?: boolean;
  /** No effect since change 0070, which spells a name a target reserves afresh instead of refusing
   *  it. Kept so that a caller that passes it still compiles. */
  readonly checkReservedNames?: boolean;
  /** Reads a file this source imports (Rule 3.9, surface §68): its text, or `undefined` when
   *  there is none, and a package's `package.json`, which the default `resolveImport` reads.
   *  The source and every shader file it imports, directly or through another, are compiled as
   *  one program into one module. Without it nothing is read, a source with no import compiles
   *  as it always has, and an import is `TS8072`. */
  readonly readDocument?: (fileName: string) => string | undefined;
  /** The file a specifier written in `fromFile` names, or `undefined` when it names none. The
   *  default is the rule the language service resolves an import by: relative to the importing
   *  file, `.js` and `.mjs` read as `.ts`, and `.ts` appended to any other path; any other
   *  specifier a package, found in `node_modules` through `readDocument` (surface §68). */
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

/**
 * A source diagnostic produced while TypeShade analyzes or compiles TypeScript shader code.
 *
 * `line`/`character` are one-based (external consumers, including `language-service.ts`, read
 * these) and mark the start of the offending node. `start`/`length` are UTF-16 offsets into the
 * file — `node.getStart(sourceFile)` and `node.getEnd() - node.getStart(sourceFile)` — so an
 * editor can underline the whole node rather than a single character; `endLine`/`endCharacter`
 * are the one-based position of `start + length`, in the same convention as `line`/`character`.
 * A diagnostic with no node behind it (a missing directive, a whole-module backend failure) uses
 * the file's first statement as its span, or `start: 0, length: 0` when the file has none — see
 * `makeDiagnostic` in `diagnostic.ts`.
 */
export interface TsCompilerDiagnostic {
  readonly message: string;
  readonly fileName: string;
  readonly line: number;
  readonly character: number;
  readonly category: 'error' | 'warning' | 'message';
  readonly code?: string;
  /** UTF-16 offset where the diagnostic's span begins. */
  readonly start: number;
  /** Length of the diagnostic's span, in UTF-16 code units. */
  readonly length: number;
  /** One-based line of the position `start + length`. */
  readonly endLine: number;
  /** One-based character of the position `start + length`. */
  readonly endCharacter: number;
}

/** The result of compiling a TypeShade TypeScript source string, including IR and optional WGSL. */
export interface CompileTsSourceResult {
  readonly hasDirective: boolean;
  readonly funcs: readonly FuncDecl[];
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  readonly sourceFile: ts.SourceFile;
  readonly consts: readonly ConstDecl[];
  readonly bindings: readonly BindingDecl[];
  readonly structs: readonly CollectedStruct[];
  /** Every `override<T>` the module declares — WGSL specialization constants, which the
   *  pipeline sets and no pass folds. Empty for a module that declares none. */
  readonly overrides: readonly OverrideDecl[];
  /** Every module variable (`let x: workgroup<T>`, `let y: T = init`, §24) the module
   *  declares. Empty for a module that declares none. */
  readonly vars: readonly ModuleVarDecl[];
  /** The capabilities the file's `"enable <extension>";` directives turn on (§50), by neutral
   *  id. Empty for a file that enables nothing, which is most; the two extension-gated
   *  `@builtin(...)` ids do not need one, since `requiredCaps` derives their capability from
   *  the use. */
  readonly enables: readonly DeclarableCapability[];
  /** Every name the front end declared while lowering `sourceFile`, with the `ShaderType` it
   *  gave it and the UTF-16 span of the declared name: the table an editor answers "what type
   *  is this symbol" from, since TypeScript infers plain `number` for a numeric literal that
   *  the compiler types `f32`. Empty when nothing was lowered (no directive, a parse error).
   *  A side output: nothing here feeds lowering, the IR or emitted text. See `DeclaredSymbol`. */
  readonly symbols: readonly DeclaredSymbol[];
  /** Every expression the front end lowered in `sourceFile`, with the `ShaderType` it gave it
   *  and its UTF-16 span, in source order: the table an editor's own type for an expression is
   *  held to (Rule 12.7, 0015). A span lowered to two types is left out, and a refused
   *  expression records nothing. Empty when nothing was lowered. A side output, like `symbols`:
   *  nothing here feeds lowering, the IR or emitted text. See `LoweredExpression`. */
  readonly expressions: readonly LoweredExpression[];
  readonly wgsl?: string;
}

/**
 * Compile a TypeScript source string through the TypeShade authoring pipeline.
 *
 * A source without the `"use typeshade"` directive returns `hasDirective: false`, no
 * functions and one `MISSING_DIRECTIVE` error (unless `options.requireDirective` is `false`).
 * `wgsl` is present only when the file lowered at least one function with no error diagnostic
 * and `options.emit` is not `false`; a backend that throws on such a module is reported as a
 * `BACKEND` error diagnostic and leaves `wgsl` undefined.
 */
export function compileTsSource(
  source: string,
  options: CompileTsSourceOptions = {},
): CompileTsSourceResult {
  return compileTsProgram(source, options).result;
}

export interface LinkedCompile {
  readonly linked: LinkedProgram;
  readonly sourceFile: ts.SourceFile;
  readonly symbols: readonly DeclaredSymbol[];
}

const linkedCompiles = new WeakMap<CompileTsSourceResult, LinkedCompile>();

export function linkedCompileOf(result: CompileTsSourceResult): LinkedCompile | undefined {
  return linkedCompiles.get(result);
}

export function compileTsProgram(source: string, options: ProgramOptions = {}): ProgramCompile {
  return withWrittenStructs(() => compileOneSource(source, options));
}

type ProgramOptions = CompileTsSourceOptions & { readonly roots?: readonly LinkRoot[] };
type ProgramCompile = { readonly result: CompileTsSourceResult; readonly linked?: LinkedCompile };

const MAX_INFERENCE_PASSES = 16;

function compileOneSource(source: string, options: ProgramOptions): ProgramCompile {
  const sourceFile =
    options.sourceFile ??
    ts.createSourceFile(
      options.fileName ?? 'typeshade-input.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  beginUseInference(sourceFile);
  for (let pass = 1; ; pass++) {
    const outer = beginUseInferencePass(sourceFile);
    let compiled: ProgramCompile;
    try {
      compiled = compileOnePass({ ...options, sourceFile }, sourceFile);
    } finally {
      endUseInferencePass(outer);
    }
    if (!settleInference(sourceFile, compiled.result) || callersSwitchedOff(sourceFile)) {
      return callersSwitchedOff(sourceFile) ? withCapNotes(compiled, sourceFile) : compiled;
    }
    if (pass >= MAX_INFERENCE_PASSES) switchCallersOff(sourceFile);
  }
}

function withCapNotes(compiled: ProgramCompile, sourceFile: ts.SourceFile): ProgramCompile {
  const calls = [...switchedOffCalls(sourceFile)].map(([node, name]) => ({
    start: node.getStart(sourceFile),
    end: node.getEnd(),
    name,
  }));
  if (calls.length === 0) return compiled;
  const diagnostics = compiled.result.diagnostics.map((d) => {
    if (d.category !== 'error' || d.fileName !== sourceFile.fileName) return d;
    const call = calls.find((c) => c.start >= d.start && c.end <= d.start + d.length);
    if (call === undefined) return d;
    return {
      ...d,
      message:
        `${d.message} "${call.name}" returns the f32 the compiler chose: its result passes ` +
        `through more functions whose calls decide it than the compiler follows. Write its ` +
        `result type, for example "function ${call.name}(): u32".`,
    };
  });
  return { ...compiled, result: { ...compiled.result, diagnostics } };
}

function compileOnePass(options: ProgramOptions, sourceFile: ts.SourceFile): ProgramCompile {
  const diagnostics: TsCompilerDiagnostic[] = [];
  const symbols: DeclaredSymbol[] = [];
  const directive = findUseTypeshadeDirective(sourceFile);
  const hasDirective = directive !== undefined;
  const empty = {
    hasDirective: false,
    funcs: [],
    diagnostics,
    sourceFile,
    consts: [],
    bindings: [],
    structs: [] as CollectedStruct[],
    overrides: [] as OverrideDecl[],
    vars: [] as ModuleVarDecl[],
    enables: [] as DeclarableCapability[],
    symbols,
    expressions: [] as LoweredExpression[],
  };

  if (!hasDirective) {
    const result = { ...empty } as CompileTsSourceResult;
    if (options.requireDirective ?? true) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `Missing "${USE_TYPESHADE}" directive. Add "${USE_TYPESHADE}"; at the top level to mark this file for TypeShade compilation.`,
          TS_CODES.MISSING_DIRECTIVE,
        ),
      );
    }
    return { result };
  }
  const syntax = syntaxDiagnostics(sourceFile);
  if (syntax.length > 0) {
    diagnostics.push(...syntax);
    return { result: { ...empty, hasDirective: true } };
  }

  if (hasModuleReference(sourceFile) || (options.roots?.length ?? 0) > 0) {
    return compileLinked(sourceFile, options, diagnostics);
  }

  reportMisplacedDirective(sourceFile, directive, diagnostics);
  openExpressionTable(sourceFile);
  resetAbstractConsts(sourceFile);
  analyzeSemantics(sourceFile, diagnostics);
  const enables = collectEnables(sourceFile, diagnostics);
  refuseStageCalls(sourceFile, diagnostics);
  checkBuiltinTypeForms(sourceFile, diagnostics);
  const structs = collectStructs(sourceFile, diagnostics, symbols);
  const bindings = collectBindings(
    sourceFile,
    diagnostics,
    symbols,
    0,
    emittedStructDecls(structs),
  );
  const consts = collectModuleConsts(sourceFile, diagnostics, symbols, emittedStructDecls(structs));
  const glslNames = new Set<string>([
    ...structs.flatMap((s) => s.decl.fields.map((f) => f.name)),
    ...bindings.map((b) => b.name),
  ]);
  const overrides = collectOverrides(sourceFile, diagnostics, symbols, glslNames);
  let vars = collectModuleVars(
    sourceFile,
    diagnostics,
    symbols,
    consts,
    emittedStructDecls(structs),
    overrides,
  );
  reportCrossDeclarationCollisions(sourceFile, diagnostics, consts, bindings, overrides, vars);
  vars = separateModuleVars(sourceFile, vars, [...consts, ...bindings, ...overrides]);
  const funcs = withoutKernelLoops(
    lowerSourceFunctions(
      sourceFile,
      diagnostics,
      consts,
      bindings,
      structs,
      symbols,
      overrides,
      vars,
    ),
  );
  giveEntryLocations(sourceFile, diagnostics, structs, funcs);
  dropDeadStorageWriters(sourceFile, funcs, bindings);
  funcs.unshift(...optionalHelpersOf(funcs));
  const optionals = usedOptionalDecls([
    ...typesOfFunctions(funcs),
    ...structs.flatMap((s) => s.decl.fields.map((f) => f.type)),
  ]);
  structs.splice(
    0,
    structs.length,
    ...orderedStructDecls(structs, optionals, (decl) => ({
      decl,
      packing: 'wgsl' as const,
      spelling: 'interface' as const,
    })),
  );
  const builtIfs = sequenceEffects(
    {
      consts: [...consts],
      structs: emittedStructDecls(structs),
      bindings: [...bindings],
      funcs,
      overrides: [...overrides],
      vars: [...vars],
    },
    sourceFile,
    diagnostics,
  );
  for (const m of interstageMismatches(emittedStructDecls(structs), funcs, authorTypeText)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        entryDeclaration(sourceFile, m.fragment),
        m.message,
        TS_CODES.STRUCT_FIELD,
      ),
    );
  }
  if (!compilingCheckedEdit()) {
    const shape = (): ModuleDecl => ({
      consts: [...consts],
      structs: emittedStructDecls(structs),
      bindings: [...bindings],
      funcs: [...funcs],
      overrides: [...overrides],
      vars: [...vars],
    });
    const rewrite = rewriteDerivatives(shape(), {
      builtIfs,
      calleeText: calleesAsWritten(sourceFile, funcs),
    });
    if (rewrite.module.funcs !== funcs) funcs.splice(0, funcs.length, ...rewrite.module.funcs);
    const calleeText = calleesAsWritten(sourceFile, funcs);
    for (const v of uniformityViolations(shape(), { builtIfs: rewrite.builtIfs, calleeText })) {
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          v.span,
          entryDeclaration(sourceFile, v.fn),
          v.kind === 'derivative'
            ? unreachedMessage(v, rewrite.unreached.get(reasonKey(v)) ?? { kind: 'other' })
            : uniformityMessage(v),
          TS_CODES.UNIFORMITY,
        ),
      );
    }
  }
  refuseRemovedQualifiers(sourceFile, diagnostics);
  refuseQualifierTypes(sourceFile, diagnostics);
  if (
    !compilingCheckedEdit() &&
    funcs.some((f) => f.kernel === true) &&
    !diagnostics.some((d) => d.category === 'error')
  ) {
    diagnostics.push(
      ...kernelLoopDiagnostics(
        {
          consts: [...consts],
          structs: emittedStructDecls(structs),
          bindings: [...bindings],
          funcs: [...funcs],
          overrides: [...overrides],
          vars: [...vars],
        },
        () => sourceFile,
      ),
    );
  }
  reportUndeclaredValues(sourceFile, diagnostics);
  const exported = exportedConstantNames(sourceFile);
  reportAbstractDivisions(sourceFile, diagnostics, (text, starts) => {
    const edited = ts.createSourceFile(
      sourceFile.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    if (starts !== undefined) markProjectedAnnotations(edited, starts);
    markExportedConstants(edited, exported);
    return compileTsSource(text, { sourceFile: edited, emit: false }).diagnostics.filter(
      (d) => d.category === 'error',
    );
  });
  warnDecoratedForm(sourceFile, diagnostics);
  dropRepeatedDiagnostics(diagnostics);
  sortDiagnosticsByPosition(diagnostics);
  let wgsl: string | undefined;
  const shouldEmit = options.emit ?? true;
  if (shouldEmit && funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitWgslKept({ consts, structs, bindings, funcs, overrides, vars, enables });
    } catch (e) {
      diagnostics.push(backendDiagnostic(sourceFile, e));
    }
  }

  recordAbstractConstTable(sourceFile, abstractConstFacts(sourceFile));
  return {
    result: {
      hasDirective: true,
      funcs,
      diagnostics,
      sourceFile,
      consts,
      bindings,
      structs,
      overrides,
      vars,
      enables,
      symbols,
      expressions: closeExpressionTable(sourceFile),
      wgsl,
    },
  };
}

const UNKNOWN_NAME_CODES: ReadonlySet<string> = new Set([
  TS_CODES.UNKNOWN_FN,
  TS_CODES.UNKNOWN_TYPE,
  TS_CODES.UNKNOWN_NAME,
]);

function compileLinked(
  entry: ts.SourceFile,
  options: ProgramOptions,
  diagnostics: TsCompilerDiagnostic[],
): ProgramCompile {
  const hooks: ImportHooks = {
    ...(options.readDocument ? { readDocument: options.readDocument } : {}),
    ...(options.resolveImport ? { resolveImport: options.resolveImport } : {}),
  };
  const linked = linkProgram(
    [{ fileName: entry.fileName, text: entry.text }, ...(options.roots ?? [])],
    hooks,
  );
  diagnostics.push(...linked.diagnostics);
  const empty: CompileTsSourceResult = {
    hasDirective: true,
    funcs: [],
    diagnostics,
    sourceFile: entry,
    consts: [],
    bindings: [],
    structs: [],
    overrides: [],
    vars: [],
    enables: [],
    symbols: [],
    expressions: [],
  };
  if (linked.fatal) return { result: empty };
  for (const f of linked.files) {
    if (!f.kept) continue;
    const late = findUseTypeshadeDirective(f.sourceFile);
    if (late !== undefined) {
      reportMisplacedDirective(f.sourceFile, late, diagnostics);
    }
  }

  const sourceFile = ts.createSourceFile(
    linked.fileName,
    linked.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  markLinkedProjections(
    sourceFile,
    entry,
    linked,
    options.readDocument === undefined ? undefined : projectedReaderOf(options.readDocument),
  );
  const origin: LinkedOrigin = {
    sourceFile,
    files: linked.files.map((f) => f.name),
    written: (start, end) => {
      const m = linked.map(start, end);
      return m && { file: m.file.name, text: m.file.sourceFile.text.slice(m.start, m.end) };
    },
  };
  const inner = withLinkedOrigin(
    origin,
    () =>
      compileTsProgram(linked.source, {
        ...options,
        sourceFile,
        readDocument: undefined,
        resolveImport: undefined,
        roots: undefined,
      }).result,
  );

  const entryFile = linked.files[0]!;
  carryRefusals(sourceFile, entry, (start, end) => {
    const m = linked.map(start, end);
    return m !== undefined && m.file.name === entryFile.name ? m : undefined;
  });
  const mapDiagnostic = (d: TsCompilerDiagnostic): TsCompilerDiagnostic | undefined => {
    if (d.fileName !== linked.fileName) return d;
    const m = linked.map(d.start, d.start + d.length);
    const file = m?.file.sourceFile ?? entryFile.sourceFile;
    const start = m?.start ?? entry.statements[0]?.getStart(entry) ?? 0;
    const end = m?.end ?? entry.statements[0]?.getEnd() ?? start;
    if (
      m !== undefined &&
      d.code !== undefined &&
      UNKNOWN_NAME_CODES.has(d.code) &&
      linked.silenced.some(
        (u) =>
          u.file === m.file.name &&
          (u.start === start ||
            (u.start >= start && u.end <= end && d.message.includes(`"${u.name}"`))),
      )
    ) {
      return undefined;
    }
    const s = file.getLineAndCharacterOfPosition(start);
    const e = file.getLineAndCharacterOfPosition(end);
    return {
      ...d,
      fileName: m?.file.name ?? entry.fileName,
      start,
      length: end - start,
      line: s.line + 1,
      character: s.character + 1,
      endLine: e.line + 1,
      endCharacter: e.character + 1,
    };
  };
  const located = locateProgramErrors({
    entry,
    linked,
    linkedSource: sourceFile,
    roots: new Set([entry.fileName, ...(options.roots ?? []).map((r) => r.fileName)]),
    errors: inner.diagnostics.flatMap((d) => {
      const mapped = mapDiagnostic(d);
      return mapped === undefined ? [] : [{ raised: d, mapped }];
    }),
    resolve: (from, specifier) =>
      options.resolveImport?.(from, specifier) ??
      resolveSpecifierFile(from, specifier, options.readDocument),
    optionsKey: JSON.stringify(options, (key, value: unknown) =>
      typeof value === 'function' ||
      key === 'sourceFile' ||
      key === 'roots' ||
      key === 'fileName' ||
      key === 'emit'
        ? undefined
        : value,
    ),
    ownProgram: (file) =>
      compileTsProgram(file.sourceFile.text, {
        ...options,
        fileName: file.name,
        sourceFile: undefined,
        roots: undefined,
        emit: false,
      }).result.diagnostics,
  });
  diagnostics.push(...located);
  sortFileDiagnosticsByPosition(diagnostics, entry.fileName);
  remapSpans(linked, [
    ...inner.funcs,
    ...inner.consts,
    ...inner.bindings,
    ...inner.structs.map((s) => s.decl),
    ...inner.overrides,
    ...inner.vars,
  ]);
  const inEntry = (
    start: number,
    length: number,
  ): { start: number; length: number } | undefined => {
    const m = linked.map(start, start + length);
    if (m === undefined || m.file.name !== entryFile.name) return undefined;
    return { start: m.start, length: m.end - m.start };
  };
  const symbols: DeclaredSymbol[] = [];
  for (const sym of inner.symbols) {
    const at = inEntry(sym.start, sym.length);
    if (at === undefined) continue;
    const written = entry.text.slice(at.start, at.start + at.length);
    symbols.push({ ...sym, ...at, name: /^[A-Za-z_]\w*$/.test(written) ? written : sym.name });
  }
  const expressions: LoweredExpression[] = [];
  for (const x of inner.expressions) {
    const at = inEntry(x.start, x.length);
    if (at !== undefined) expressions.push({ ...x, ...at });
  }
  const table = abstractConstTableOf(sourceFile);
  if (table !== undefined) {
    recordAbstractConstTable(entry, {
      decls: table.decls.flatMap((d) => {
        const m = linked.map(d.start, d.start + d.length);
        return m === undefined
          ? []
          : [{ ...d, fileName: m.file.name, start: m.start, length: m.end - m.start }];
      }),
      reads: table.reads.flatMap((r) => {
        const at = inEntry(r.start, r.length);
        return at === undefined ? [] : [{ ...r, ...at }];
      }),
    });
  }
  resetResultCopies(entry);
  mapResultCopies(sourceFile, entry, (offset) => inEntry(offset, 1)?.start);
  const result: CompileTsSourceResult = {
    ...inner,
    diagnostics,
    sourceFile: entry,
    symbols,
    expressions,
  };
  const linkedCompile: LinkedCompile = { linked, sourceFile, symbols: inner.symbols };
  linkedCompiles.set(result, linkedCompile);
  return { result, linked: linkedCompile };
}

function markLinkedProjections(
  sourceFile: ts.SourceFile,
  entry: ts.SourceFile,
  linked: LinkedProgram,
  projected: ((fileName: string) => readonly number[] | undefined) | undefined,
): void {
  const entryName = normalizeSourcePath(entry.fileName);
  const startsOf = new Map<string, ReadonlySet<number> | undefined>();
  const starts = (fileName: string): ReadonlySet<number> | undefined => {
    const name = normalizeSourcePath(fileName);
    if (!startsOf.has(name)) {
      const own = name === entryName ? projectedAnnotationStarts(entry) : undefined;
      const read = own ?? projected?.(name);
      startsOf.set(name, read === undefined ? undefined : new Set(read));
    }
    return startsOf.get(name);
  };
  if (projectedAnnotationStarts(entry) === undefined && projected === undefined) return;
  const marks = new Map<number, number>();
  const consider = (at: number, end: number): void => {
    if (at < 0 || marks.has(at)) return;
    const m = linked.map(at, at + 1);
    if (m !== undefined && starts(m.file.name)?.has(m.start) === true) marks.set(at, end - at);
  };
  const visit = (n: ts.Node): void => {
    const typed = n as { readonly type?: ts.TypeNode; readonly name?: ts.Node };
    if (typed.type !== undefined && ts.isTypeNode(typed.type)) {
      const end = typed.type.getEnd();
      if (typed.name !== undefined) consider(typed.name.getEnd(), end);
      consider(sourceFile.text.lastIndexOf(':', typed.type.getStart(sourceFile)), end);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  if (marks.size > 0) {
    const sorted = [...marks.entries()].sort((a, b) => a[0] - b[0]);
    markProjectedAnnotations(
      sourceFile,
      sorted.map(([at]) => at),
      sorted.map(([, length]) => length),
    );
  }
}

function remapSpans(linked: LinkedProgram, roots: readonly object[]): void {
  const seen = new WeakSet<object>();
  const mapSpan = (span: SourceSpan): SourceSpan => {
    if (span.file !== linked.fileName) return span;
    const m = linked.map(span.start, span.start + span.length);
    if (m === undefined) return span;
    const s = m.file.sourceFile.getLineAndCharacterOfPosition(m.start);
    const e = m.file.sourceFile.getLineAndCharacterOfPosition(m.end);
    return {
      file: m.file.name,
      start: m.start,
      length: m.end - m.start,
      line: s.line,
      character: s.character,
      endLine: e.line,
      endCharacter: e.character,
    };
  };
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if ((k === 'span' || k === 'nameSpan') && isSourceSpan(v)) {
        o[k] = mapSpan(v);
        continue;
      }
      visit(v);
    }
  };
  for (const r of roots) visit(r);
}

const isSourceSpan = (v: unknown): v is SourceSpan =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SourceSpan).file === 'string' &&
  typeof (v as SourceSpan).start === 'number' &&
  typeof (v as SourceSpan).length === 'number';

function reportMisplacedDirective(
  sourceFile: ts.SourceFile,
  directive: ts.ExpressionStatement,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const first = sourceFile.statements[0];
  if (first === undefined || first === directive) return;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      directive,
      `"${USE_TYPESHADE}" must be the file's first statement: here it follows ${describeStatement(first)}, ` +
        `so TypeScript reads it as an ordinary string and not as a directive. Move it to the top of the file.`,
      TS_CODES.MISPLACED_DIRECTIVE,
    ),
  );
}

function describeStatement(stmt: ts.Statement): string {
  if (ts.isClassDeclaration(stmt)) return 'a class declaration';
  if (ts.isFunctionDeclaration(stmt)) return 'a function declaration';
  if (ts.isInterfaceDeclaration(stmt)) return 'an interface declaration';
  if (ts.isTypeAliasDeclaration(stmt)) return 'a type alias';
  if (ts.isVariableStatement(stmt)) return 'a variable declaration';
  if (ts.isImportDeclaration(stmt)) return 'an import';
  if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression))
    return `the "${stmt.expression.text}" directive`;
  return 'another statement';
}

/** Return whether a TypeScript source string opts into TypeShade with the "use typeshade" directive. */
export function isTypeshadeSource(source: string, fileName = 'check.ts'): boolean {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return hasUseTypeshadeDirective(sf);
}

export function reportCrossDeclarationCollisions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  consts: readonly { readonly name: string }[],
  bindings: readonly { readonly name: string }[],
  overrides: readonly { readonly name: string }[],
  vars: readonly { readonly name: string }[] = [],
): void {
  const kindOf = new Map<string, string>();
  for (const [kind, list] of [
    ['a module const', consts],
    ['a resource', bindings],
    ['an override', overrides],
    ['a module variable', vars],
  ] as const) {
    for (const d of list) {
      const prev = kindOf.get(d.name);
      if (prev !== undefined && prev !== kind) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            undefined,
            `"${d.name}" is declared as ${prev} and as ${kind}; one module-scope name means one thing.`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        );
      } else kindOf.set(d.name, kind);
    }
  }
}

function entryDeclaration(sourceFile: ts.SourceFile, name: string): ts.Node | undefined {
  return sourceFile.statements.find(
    (st) =>
      (ts.isFunctionDeclaration(st) && st.name?.text === name) ||
      stageCallOf(st)?.declaration.name.text === name,
  );
}

function calleesAsWritten(
  sourceFile: ts.SourceFile,
  funcs: readonly FuncDecl[],
): (call: Extract<Expr, { op: 'call' }>) => string | undefined {
  let calls: Map<string, string> | undefined;
  const byName = new Map(funcs.map((f) => [f.name, f]));
  const textOf = (start: number, length: number): string =>
    sourceFile.text.slice(start, start + length).replace(/\s+/g, '');
  return (call) => {
    if (call.span !== undefined) {
      if (calls === undefined) {
        const index = new Map<string, string>();
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const start = node.getStart(sourceFile);
            const callee = node.expression;
            const at = callee.getStart(sourceFile);
            index.set(`${start}:${node.getEnd() - start}`, textOf(at, callee.getEnd() - at));
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        calls = index;
      }
      const written = calls.get(`${call.span.start}:${call.span.length}`);
      if (written !== undefined) return written;
    }
    const name = byName.get(call.fn)?.nameSpan;
    return name === undefined ? undefined : textOf(name.start, name.length);
  };
}
