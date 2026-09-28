// === TypeShade source compiler entry point ===

import ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  DeclarableCapability,
  Expr,
  FuncDecl,
  DiagnosticDirective,
  ModuleDecl,
  ModuleVarDecl,
  OverrideDecl,
} from '../../core/ir/nodes.js';
import { stageOf } from '../../core/ir/nodes.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { kernelLoopDiagnostics } from './kernel-loops.js';
import { findUseTypeshadeDirective, hasUseTypeshadeDirective, USE_TYPESHADE } from './directive.js';
import { lowerSourceFunctions } from './lower/function.js';
import { sequenceEffects } from './sequence.js';
import { analyzeSemantics, carryRefusals, reportUndeclaredValues } from './semantic.js';
import { collectModuleConsts } from './module-const.js';
import { collectBindings } from './bindings.js';
import { collectOverrides } from './overrides.js';
import { collectModuleVars } from './module-vars.js';
import { collectStructs, emittedStructDecls, type CollectedStruct } from './structs.js';
import type { DeclaredSymbol, LoweredExpression } from './symbols.js';
import type { SourceSpan } from '../../core/ir/span.js';
import { closeExpressionTable, openExpressionTable } from './symbols.js';
import { reportReservedNames } from './reserved-names.js';
import { TS_CODES } from './codes.js';
import {
  backendDiagnostic,
  diagnosticAtSpan,
  dropRepeatedDiagnostics,
  makeDiagnostic,
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
import { reportIntegerLiteralDeprecations } from './integer-literal-deprecation.js';
import {
  collectDiagnosticDirectives,
  derivativeUniformitySeverity,
} from './diagnostic-directive.js';
import { uniformityViolations, type UniformityViolation } from '../../core/passes/uniformity.js';
import { interstageMismatches } from '../../core/passes/lint/rules/interstage-io.js';
import {
  authorTypeText,
  withLinkedOrigin,
  withWrittenStructs,
  type LinkedOrigin,
} from './context.js';

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
   * change. One today: an integer-written literal in a declaration that declares no type still
   * types as `f32` and will type as `i32` (§13, #148). Off by default, and off is
   * the whole of the compiler's behaviour: the flag adds warnings and moves no emitted byte,
   * so a build that turns it on and a build that does not produce the same shader. */
  readonly deprecations?: boolean;
  /** Whether the declared names are held to the targets' reserved words (#103). Defaults to
   *  `true`, which is what an author's file wants — in the editor too, where `emit` is
   *  `false` and the diagnostic is the whole point. A caller that lowers a SYNTHETIC source
   *  whose names it generated itself, and never emits it, passes `false`: the debug watch
   *  builds `__typeshade_watch__` around the author's expression precisely because no name
   *  the author could write starts with two underscores, and runs the result on the CPU
   *  oracle, where WGSL's identifier rules do not apply. */
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
  /** The `diagnostic(severity, rule);` directives the file's entries ask for (§54), in source
   *  order. Empty for a file that asks for none, which is most. Carried here rather than left
   *  at the emit, because the assembled `ModuleDecl` an example registers is built from this
   *  result — and a module missing the directive it was written with is one Tint refuses.
   *  Named `directives` and not `diagnostics`: that name is taken, by the compiler's own
   *  error list, and one of the two would have read as the other at every call site. */
  readonly directives: readonly DiagnosticDirective[];
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

/** A compile that followed imports: the linked program, and the one source it was lowered as. */
export interface LinkedCompile {
  readonly linked: LinkedProgram;
  /** The linked source, parsed: what the front end lowered, whose names are the module's. */
  readonly sourceFile: ts.SourceFile;
  /** What the front end declared in the linked source, in its offsets: the table the host face
   *  reads the module's exports against, which `result.symbols` keeps only the entry's of. */
  readonly symbols: readonly DeclaredSymbol[];
}

/** `compileTsSource`, and for a source that imports another, what the linker made of it (the
 *  Vite plugin's host face reads the module's exports there). `roots` are more files to keep
 *  whole beside the source, which `compileTsSources` passes; with any, the source is linked
 *  whether it imports or not. */
export function compileTsProgram(source: string, options: ProgramOptions = {}): ProgramCompile {
  // A message names a struct as the author wrote it, `N.P` and `Slot<f32>`, for this compile's
  // structs and no other's (see `useWrittenStructs`).
  return withWrittenStructs(() => compileOneSource(source, options));
}

type ProgramOptions = CompileTsSourceOptions & { readonly roots?: readonly LinkRoot[] };
type ProgramCompile = { readonly result: CompileTsSourceResult; readonly linked?: LinkedCompile };

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
    directives: [] as DiagnosticDirective[],
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

  // A file TypeScript could not parse is not lowered. The tree it hands back is the parser's
  // recovery, not the author's program: lowering it produced a cascade of misleading TypeShade
  // diagnostics at best and, for `vec4(3.14`, a clean WGSL emit at worst. Its parse errors are
  // the whole answer.
  const syntax = syntaxDiagnostics(sourceFile);
  if (syntax.length > 0) {
    diagnostics.push(...syntax);
    return { result: { ...empty, hasDirective: true } };
  }

  // A source that imports another shader module is one program with the files it imports
  // (Rule 3.9): linked into one source, lowered as one file, and mapped back.
  if (hasModuleReference(sourceFile) || (options.roots?.length ?? 0) > 0) {
    return compileLinked(sourceFile, options, diagnostics);
  }

  reportMisplacedDirective(sourceFile, directive, diagnostics);
  openExpressionTable(sourceFile);
  analyzeSemantics(sourceFile, diagnostics);
  // Opt-in, and additive: warnings only, no emitted byte moves (§13, #148).
  if (options.deprecations === true) reportIntegerLiteralDeprecations(sourceFile, diagnostics);
  // The file's `"enable <extension>";` directives (§50), before anything that could emit.
  const enables = collectEnables(sourceFile, diagnostics);
  const directives = collectDiagnosticDirectives(sourceFile, diagnostics);
  const structs = collectStructs(sourceFile, diagnostics, symbols);
  // The structs, so a buffer binding's host-shareable rules can be read through its struct
  // type (§51) — collected first, which this order already guaranteed.
  const bindings = collectBindings(
    sourceFile,
    diagnostics,
    symbols,
    0,
    emittedStructDecls(structs),
  );
  const consts = collectModuleConsts(sourceFile, diagnostics, symbols, emittedStructDecls(structs));
  // The names the GLSL writer spells from this module, so an override cannot shadow one with
  // its `#define`. Structs and bindings are collected above, which is why this order holds.
  const glslNames = new Set<string>([
    ...structs.flatMap((s) => s.decl.fields.map((f) => f.name)),
    ...bindings.map((b) => b.name),
  ]);
  const overrides = collectOverrides(sourceFile, diagnostics, symbols, glslNames);
  // Module variables (§24) after the consts their initializers may name.
  const vars = collectModuleVars(
    sourceFile,
    diagnostics,
    symbols,
    consts,
    emittedStructDecls(structs),
  );
  // A name claimed by two DIFFERENT collectors. Each reports its own repeats, and none can see
  // the others, so `const q: f32 = 1.` beside `const q: override<f32> = 2.` passed all three and
  // then met `scope.define`, which throws — an exception out of `compile()` and out of the
  // language service's `getDiagnostics()`. Reported here, where all three lists exist.
  reportCrossDeclarationCollisions(sourceFile, diagnostics, consts, bindings, overrides, vars);
  // The CollectedStructs whole, not their decls: #23's TS8029 names the spelling the author
  // used (`class`, `interface` or `type`), which only the collected form carries.
  const funcs = lowerSourceFunctions(
    sourceFile,
    diagnostics,
    consts,
    bindings,
    structs,
    symbols,
    overrides,
    vars,
  );
  // A call that writes, inside a larger expression, in the order the source evaluates it
  // (Rule 7.9, §26). After every function is lowered, since what a helper writes is read off its
  // body, and before anything reads the bodies, so every backend runs the one order.
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
  // The interstage pair, once every entry is lowered: a `@location` a fragment reads must be
  // produced by the vertex entry with the same type and the same interpolation (§53). The
  // CORE lint rule answers the same question on the IR, so every authoring surface is covered
  // at every emit; this runs the same function here because it can point at the fragment
  // declaration the author wrote, and a backend throw cannot.
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
  // Derivative uniformity, and the barriers that need the same property for a different
  // reason (§54). Answered on the assembled module, because the walk follows a condition down
  // through the statements a function holds, and reported here, where the IR's span can point
  // at the call the author wrote. Silent when the file has switched the rule off: WGSL will
  // not refuse the module either, which is the whole point of the directive.
  {
    const shaped: ModuleDecl = {
      consts: [...consts],
      structs: emittedStructDecls(structs),
      bindings: [...bindings],
      funcs: [...funcs],
      overrides: [...overrides],
      vars: [...vars],
    };
    // The filter sets the DERIVATIVE rule and nothing else: a barrier's requirement is not
    // `derivative_uniformity` and is not filterable, measured on Tint with the directive in
    // the module. `off` drops the derivative rows, `info` and `warning` demote them.
    const severity = derivativeUniformitySeverity(directives);
    const calleeText = calleesAsWritten(sourceFile, funcs);
    // `@diagnostic` is read off any top-level function (`collectDiagnosticDirectives`), and a
    // namespace's entry refuses the attribute (`TS8028`). So the sentence offers it on the entry
    // when every entry is top-level, on a top-level function when one is not and the file has
    // one, and not at all when it has none.
    const namespaceEntry = funcs.some(
      (f) => stageOf(f) !== undefined && entryDeclaration(sourceFile, f.name) === undefined,
    );
    const directivePlace = !namespaceEntry
      ? 'the entry'
      : sourceFile.statements.some((st) => ts.isFunctionDeclaration(st) && st.body !== undefined)
        ? 'a top-level function'
        : undefined;
    for (const v of uniformityViolations(shaped, { builtIfs, calleeText })) {
      if (v.kind === 'derivative' && severity === 'off') continue;
      const category =
        v.kind === 'derivative' && (severity === 'warning' || severity === 'info')
          ? 'warning'
          : 'error';
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          v.span,
          entryDeclaration(sourceFile, v.fn),
          uniformityMessage(v, directivePlace),
          TS_CODES.UNIFORMITY,
          category,
        ),
      );
    }
  }
  // A kernel function's loops run as dispatches when the proof accepts them, and on the CPU
  // with a warning that names why when it does not (Rule 8.22, TS8070). After the functions,
  // because the proof reads what each callee writes, and only on a module with no error.
  if (funcs.some((f) => f.kernel === true) && !diagnostics.some((d) => d.category === 'error')) {
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
  // A name a target reserves, on the name the emit actually carries (#103). After the
  // functions, because a local, a parameter and a method's flattened name are recorded there,
  // and because the entry stages are what say whether GLSL ES 3.00 is a target of this module.
  if (options.checkReservedNames ?? true) {
    reportReservedNames(sourceFile, diagnostics, symbols, funcs, vars);
  }
  // A name nothing declares in a body no call lowered, which the lowering never read (Rule 2.1).
  reportUndeclaredValues(sourceFile, diagnostics);
  dropRepeatedDiagnostics(diagnostics);
  let wgsl: string | undefined;
  const shouldEmit = options.emit ?? true;
  if (shouldEmit && funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitModule({
        consts: [...consts],
        structs: emittedStructDecls(structs),
        bindings: [...bindings],
        funcs: [...funcs],
        overrides: [...overrides],
        vars: [...vars],
        enables,
        ...(directives.length > 0 ? { diagnostics: directives } : {}),
      });
    } catch (e) {
      // No fallback to emitFuncs(funcs): it emits the functions without the consts, structs
      // and bindings they reference, which is not this module's WGSL. The throw is the answer.
      diagnostics.push(backendDiagnostic(sourceFile, e));
    }
  }

  return {
    result: {
      hasDirective: true,
      funcs,
      diagnostics,
      directives,
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

/** The codes an unknown name is reported under, which a refused import already accounts for. */
const UNKNOWN_NAME_CODES: ReadonlySet<string> = new Set([
  TS_CODES.UNKNOWN_FN,
  TS_CODES.UNKNOWN_TYPE,
  TS_CODES.UNKNOWN_NAME,
]);

/**
 * The linked compile (Rule 3.9, `link.ts`): link `entry` with the shader files it imports, lower
 * the linked source through the single-file path, and map every position the result carries
 * back to the file and the offsets the author wrote. The result reads as the entry's own: its
 * `sourceFile` is `entry`, its `symbols` and `expressions` are the entry's, and a diagnostic
 * located in an imported file carries that file's name and offsets.
 */
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
    directives: [],
    symbols: [],
    expressions: [],
  };
  if (linked.fatal) return { result: empty };
  // Rule 3.1 in each file the module keeps: the linked source opens with the directive, so a
  // late one in any file is reported here, where the file is still the author's.
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
  // A sentence names a declaration as its own file writes it, and says whether a name the
  // linker joined was declared in the file the sentence is about or imported into it.
  const origin: LinkedOrigin = {
    sourceFile,
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
  // What the semantic pass refused whole, on the entry's own nodes, where the editor's merged
  // list reads it (Rule 12.4).
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
  for (const d of inner.diagnostics) {
    const mapped = mapDiagnostic(d);
    if (mapped !== undefined) diagnostics.push(mapped);
  }
  remapSpans(linked, [
    ...inner.funcs,
    ...inner.consts,
    ...inner.bindings,
    ...inner.structs.map((s) => s.decl),
    ...inner.overrides,
    ...inner.vars,
  ]);
  /** A span of the linked source that lands in the entry, in the entry's offsets. */
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
  return {
    result: {
      ...inner,
      diagnostics,
      sourceFile: entry,
      symbols,
      expressions,
    },
    linked: { linked, sourceFile, symbols: inner.symbols },
  };
}

/** Maps every `SourceSpan` the IR under `roots` carries from the linked source back to the file
 *  the author wrote it in. The IR holds no `ts.Node`, and a span object is replaced, not edited,
 *  so one shared between two nodes is mapped once for each. */
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

/** Rule 3.1: `"use typeshade"` is the file's first statement (#200, proposal 0012). A comment
 *  before it is not a statement, so a licence header is fine; anything else, another string
 *  directive included, is `TS8069` on the directive. The file is still lowered, so the editor
 *  keeps its answers while the directive is out of place, and the error holds back the emit. */
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

/** The statement a late directive follows, in the words an author would use for it. */
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

/** Reports a module-scope name declared by more than one of the three collectors — a module
 *  const, a resource binding and an override each own a namespace they police alone.
 *
 *  Named in the order they are collected, so the message points at what the author most likely
 *  meant to keep. The declaration itself is not removed: the later `scope.define` is guarded,
 *  so one of the two wins silently rather than throwing, and the diagnostic is what stops the
 *  module being emitted. */
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

/** The `function <name>` statement an entry was lowered from, so a whole-module diagnostic can
 *  anchor at the declaration rather than at the file's first line. `undefined` when the name
 *  names no top-level function, which {@link makeDiagnostic} already handles. */
function entryDeclaration(sourceFile: ts.SourceFile, name: string): ts.Node | undefined {
  return sourceFile.statements.find(
    (st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === name,
  );
}

/** A call's callee as the author wrote it, for the uniformity walk to name a user function by
 *  (Rule 12.1): `Lim.hit` for the IR's `Lim_hit`, `done` for a closure's `main_done`,
 *  `Gate.open` for a namespace's `Gate_open`. Read off the call expression the IR call's span
 *  covers, or, for a call the source does not spell as one (a getter, `new`), off the name
 *  its function was declared with. Indexed once, on the first question: the walk asks for
 *  every user call it classifies, round after round. */
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

/** Where a {@link UniformityViolation}'s call is reached, before the value that made it
 *  non-uniform, and the two remedies that fit that statement: where to move a barrier or hoist
 *  a derivative, and what to write the statement on instead. Each remedy compiles on Tint in
 *  the shape it names (Rule 12.1), and the loop rows are why there are rows: a barrier moved
 *  ABOVE a non-uniform `break` is still refused, because the next iteration is reached by fewer
 *  invocations, so a `break` or `continue` sends it out of the loop; and a `return` taken in a
 *  loop reaches that loop's later iterations and everything after it, so it sends it above.
 *  The value comes last, because its phrase can end in "which this compiler cannot prove
 *  uniform", and a clause after that one reads as part of it. */
const UNIFORMITY_SITES: Readonly<
  Record<UniformityViolation['via'], { reached: string; move: string; hoist: string; on: string }>
> = {
  branch: {
    reached: 'under',
    move: 'Move it out of the branch',
    hoist: 'Hoist the call above the branch',
    on: 'branch on',
  },
  'short-circuit': {
    reached: 'on the right of an && or || whose left side reads',
    move: 'Call it before the && or ||',
    hoist: 'Hoist the call above the && or ||',
    on: 'make the left side',
  },
  conditional: {
    reached: 'in an arm of a ?: whose condition reads',
    move: 'Call it before the ?:',
    hoist: 'Hoist the call above the ?:',
    on: 'make the condition',
  },
  loop: {
    reached: 'in a loop whose condition reads',
    move: 'Move it out of the loop',
    hoist: 'Hoist the call out of the loop',
    on: 'bound the loop by',
  },
  return: {
    reached: 'after a return taken under',
    move: 'Move it above the return',
    hoist: 'Hoist the call above the return',
    on: 'return on',
  },
  'loop-return': {
    reached: 'after a return taken inside a loop under',
    move: 'Move it above the loop',
    hoist: 'Hoist the call above the loop',
    on: 'return on',
  },
  'bound-return': {
    reached: 'after a return inside a loop whose condition reads',
    move: 'Move it above the loop',
    hoist: 'Hoist the call above the loop',
    on: 'bound the loop by',
  },
  break: {
    reached: 'in a loop some invocations leave by a break taken under',
    move: 'Move it out of the loop',
    hoist: 'Hoist the call out of the loop',
    on: 'break on',
  },
  continue: {
    reached: 'in a loop where some invocations skip ahead by a continue taken under',
    move: 'Move it out of the loop',
    hoist: 'Hoist the call out of the loop',
    on: 'continue on',
  },
  'switch-break': {
    reached: 'after a break out of the switch taken under',
    move: 'Move it above the break',
    hoist: 'Hoist the call above the break',
    on: 'break on',
  },
};

/** The sentence a {@link UniformityViolation} reads as. Two rules with one walk behind them,
 *  so two wordings: a derivative needs uniform control flow because its value is a difference
 *  between neighbouring invocations, and a barrier because a workgroup where some invocations
 *  arrive and some do not waits forever. A derivative's sentence offers `@diagnostic` at
 *  `directivePlace`, where the file can carry it, and not at all when it has no such place. */
function uniformityMessage(
  v: UniformityViolation,
  directivePlace: 'the entry' | 'a top-level function' | undefined,
): string {
  const site = UNIFORMITY_SITES[v.via];
  const reached = `${site.reached} ${v.cause}`;
  if (v.kind === 'barrier') {
    return (
      `${v.callee}() is reached ${reached}, and every invocation of the workgroup has ` +
      `to reach it: one that does not is a workgroup that waits forever. ${site.move}, or ` +
      `${site.on} a value the whole workgroup shares (a uniform, a module const, ` +
      `@builtin("workgroup_id")).`
    );
  }
  // Two fixes, not one. A SAMPLE has a same-shape alternative that carries the level the
  // author wrote, so the message names it. A DERIVATIVE does not — a screen-space difference
  // is what `dpdx` IS, so there is nothing to swap it for and the fix is to restructure. The
  // `fragment-only-builtin` rule splits its fix string for the same reason.
  const fix = v.isDerivativeBuiltin
    ? `${site.hoist} and select from its result, or compute the quantity ` +
      `some other way — a screen-space derivative has no alternative form`
    : `${site.hoist}, or use textureSampleLevel or textureSampleGrad, whose ` +
      `level of detail is the one you wrote`;
  return (
    `${v.callee}() is reached ${reached}, which WGSL's derivative_uniformity rule ` +
    `refuses: ${
      v.isDerivativeBuiltin
        ? 'it differences neighbouring invocations'
        : 'the implicit level of detail is a difference between neighbouring invocations'
    }, and one that did not run has no value to difference against. ${fix}${
      directivePlace === undefined
        ? '.'
        : `, or write @diagnostic("off", "derivative_uniformity") on ${directivePlace} to ` +
          `take the module as written.`
    }`
  );
}
