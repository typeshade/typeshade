import type { ModuleDecl } from '../../core/ir/nodes.js';
import type { SourceSpan } from '../../core/ir/span.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslStages } from '../../core/backends/glsl.js';
import { determinismReport, type DeterminismEntry } from '../../core/passes/determinism.js';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { backendDiagnostic } from './diagnostic.js';
import { evalEntry } from './eval-entry.js';
import type { ConsoleLog, ConsoleSink } from '../../core/console.js';
import { consoleBuffer } from '../../core/passes/console-buffer.js';
import { TS_CODES } from './codes.js';
import { emittedStructDecls } from './structs.js';

/**
 * What `compile()` returns. The one rule behind every optional field: shader text and a
 * runnable oracle exist only for a program that compiled with no error diagnostic. A caller
 * that reads `wgsl` without checking `diagnostics` gets `undefined`, never text for a program
 * that did not compile.
 */
export interface CompileResult {
  /**
   * Every diagnostic the front end and the backends produced, in the order they were found.
   * A `"use typeshade"`-less file has exactly one, `TS8001` (`MISSING_DIRECTIVE`); a parse
   * error has only `TS8030` (`SYNTAX`) entries; a backend that threw on a program the front end
   * accepted adds one `TS8015` (`BACKEND`) entry anchored on the file's first statement: an
   * `error` when the WGSL emitter threw, a `warning` when only the GLSL emitter threw on a
   * vertex+fragment module (a compute entry next to the render pair, a storage binding the
   * GLSL emulation cannot spell). A program with no `error` entry compiled.
   */
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  /**
   * The lowered IR module: the consts, structs, bindings and functions the front end built.
   * Always present. When `diagnostics` has an error the module is partial (the front end
   * stops lowering a declaration at its first error and may drop it), so it is for inspection
   * and diagnostics tooling, not for emitting.
   */
  readonly module: ModuleDecl;
  /**
   * The module's WGSL. `undefined` when any diagnostic has category `error`, including a
   * `BACKEND` error from a WGSL emitter that threw. Present otherwise, even for a module with
   * no functions (a file of consts or structs emits their declarations), and kept when only
   * the GLSL emitter failed: the WGSL is the program, GLSL a second target of it.
   */
  readonly wgsl?: string;
  /**
   * The module's GLSL ES 3.00 vertex and fragment programs. Present when no diagnostic has
   * category `error` and the GLSL emitter took the module; a module with only one render
   * stage still gets both programs (the missing stage is a header-only program). A module the
   * GLSL backend refuses gets `undefined` here while `wgsl` is still present: silently for a
   * compute-only module, which GLSL ES 3.00 has no stage for, and with the throw recorded as a
   * `BACKEND` warning for a module with a `@vertex` or `@fragment` entry.
   */
  readonly glsl?: { readonly vertex: string; readonly fragment: string };
  /**
   * The operations in `module` whose result may differ by driver: a builtin WGSL §15.7.4 gives
   * a ULP or absolute bound (`sin`, `exp`, `atan2`, `/`), one inherited from a formula the
   * driver may reassociate or fuse (`pow`, `mix`, `fma`, `fract`, the matrix products), a
   * derivative, a filtered texture read or gather, an operation the GLSL ES 3.00 spelling may
   * answer differently (`ldexp`, the `pack` builtins), and every emulated `f64` arithmetic
   * operator and bounded builtin, each with the spec's bound in words, its count and where it
   * occurs. Empty when every operation has one answer, so a GPU result and the CPU oracle can
   * differ only by the oracle's own rounding. Computed on the front end's IR even when
   * `diagnostics` has an error, since a partial module still says what it uses. See
   * {@link determinismReport}.
   */
  readonly determinism: readonly DeterminismEntry[];
  /**
   * Run one function of the module on the CPU oracle: `eval('fs')` calls the fragment entry
   * with no arguments, `eval('add', [1, 2])` a helper with two. When `diagnostics` has an
   * error, every call throws an `Error` naming the first error diagnostic (file, line and
   * message), so a host that ignores `diagnostics` cannot run a broken shader on the oracle.
   * It also throws for a function name the module does not have.
   */
  readonly eval: (name: string, args?: readonly unknown[]) => unknown;
  /**
   * Where the WGSL records its `console` calls and what each entry of the buffer means, under
   * `console: 'gpu'`: the slot of the `_console` storage buffer and the site table
   * {@link decodeConsole} reads. `undefined` when the option is `'cpu'`, when the module did not
   * compile, or when no call is recorded. Surface §66.
   */
  readonly console?: ConsoleLog;
}

/**
 * How one `compile()` call is set up. Every field is optional, and the defaults are what
 * `compile(source)` did before this interface existed.
 */
export interface CompileOptions {
  /**
   * The name this source is compiled under. It is the `file` of every `SourceSpan` the
   * front end stamps on the IR, and the `fileName` of every diagnostic, so it is how a
   * consumer that holds a span says which of the author's files a statement came from.
   *
   * Defaults to `typeshade-input.ts`, the placeholder `compileTsSource` has always used for a
   * caller that named nothing. That default is fine for a compile whose output is shader
   * text, since nothing reads the name, but not for one whose output is stepped: a
   * `DebugBreakpoint` carries the path the editor knows the file by, and matches it against
   * `span.file`, so a session compiled under the placeholder silently arms no breakpoint at
   * all. An adapter that has a path should pass it.
   *
   * Nothing resolves or reads it: it is a label carried to the spans, not a path the compiler
   * opens. It is not carried verbatim, though: it becomes `ts.SourceFile.fileName`, and
   * TypeScript path-normalizes that, so `./a.ts` is stored as `a.ts` and `C:\\shaders\\a.ts`
   * as `C:/shaders/a.ts`. An adapter does not have to care: a `DebugBreakpoint`'s path is
   * normalized the same way before it is compared, so either spelling matches.
   */
  readonly fileName?: string;
  /** Host sink for `console.*` calls made by CPU/debug evaluation. */
  readonly consoleSink?: ConsoleSink;
  /**
   * Report DEPRECATION warnings for spellings whose meaning is scheduled to change. One
   * today: an integer-written literal in a declaration that declares no type still types as
   * `f32` and will type as `i32` (§13, #148).
   *
   * Off by default, and off is the whole of the compiler's behaviour: the flag adds
   * `category: 'warning'` diagnostics and moves no emitted byte, so `wgsl` and `glsl` are
   * byte-identical with it on and with it off. It is how a build finds the lines the flip
   * will move, one release ahead of it.
   */
  readonly deprecations?: boolean;
  /**
   * Where a `console` call is recorded. `'cpu'`, the default, is what `compile()` always did: the
   * CPU run delivers each call to {@link CompileOptions.consoleSink}, and the WGSL and GLSL
   * record nothing, so no emitted byte depends on a console call. `'gpu'` makes the WGSL also
   * record each call a compute or fragment entry reaches, in a `_console` storage buffer the
   * compiler binds at group 0 past the module's own bindings; {@link CompileResult.console}
   * says where, and {@link decodeConsole} turns the buffer the host copies back into the same
   * events. A call the WGSL cannot record is a `TS8071` warning. GLSL ES 3.00 records nothing
   * either way. Surface §66, Rule 11.9.
   */
  readonly console?: 'cpu' | 'gpu';
}

/**
 * Compile TypeShade TypeScript source into the module and generated shader outputs.
 *
 * The source must carry the `"use typeshade"` directive (`compileTsSource`'s
 * `requireDirective` default): without it the result has one `MISSING_DIRECTIVE` error and
 * nothing else. When the front end reports an error the backends are not run at all, so
 * `wgsl` and `glsl` are `undefined` and `eval` throws; a partial module is never packed into
 * shader text. When the front end reports no error, a WGSL emitter that throws anyway (a
 * literal the target cannot spell, an IR the emitter rejects) is reported as one `BACKEND`
 * error diagnostic rather than an exception, and `wgsl` and `glsl` are again `undefined`.
 * GLSL is attempted for every module whose WGSL exists; when the GLSL emitter throws on a
 * module with a render entry (a compute entry beside the render pair, a binding the GLSL
 * emulation cannot spell) the module has still compiled: `wgsl` stays, `glsl` is `undefined`,
 * and the throw is one `BACKEND` diagnostic with category `warning`. A compute-only module
 * gets `glsl: undefined` with no diagnostic, since GLSL ES 3.00 has no compute stage to
 * miss. See `CompileResult` for each field.
 *
 * `options.fileName` names the source; see {@link CompileOptions.fileName} for when the
 * default placeholder is not good enough.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const r = compileTsSource(source, {
    fileName: options.fileName,
    ...(options.deprecations === true ? { deprecations: true } : {}),
  });
  const module: ModuleDecl = {
    consts: [...r.consts],
    structs: emittedStructDecls(r.structs),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
    overrides: [...r.overrides],
    vars: [...r.vars],
    enables: [...r.enables],
    ...(r.directives.length > 0 ? { diagnostics: [...r.directives] } : {}),
  };
  const diagnostics = [...r.diagnostics];
  const firstError = (): TsCompilerDiagnostic | undefined =>
    diagnostics.find((d) => d.category === 'error');

  let wgsl: string | undefined;
  let glsl: CompileResult['glsl'];
  let consoleLog: ConsoleLog | undefined;
  if (!firstError()) {
    try {
      if (options.console === 'gpu') {
        const recorded = consoleBuffer(module);
        consoleLog = recorded.log;
        for (const n of recorded.notRecorded)
          diagnostics.push(notRecordedDiagnostic(n, r.sourceFile.fileName));
        wgsl = emitModule(recorded.module);
      } else {
        wgsl = r.wgsl ?? emitModule(module);
      }
    } catch (e) {
      diagnostics.push(backendDiagnostic(r.sourceFile, e));
    }
  }
  // GLSL is a second target of a module whose WGSL exists. Its emitter has no compute stage
  // and a narrower storage emulation, so it can refuse a module that compiled; for a module
  // with a render entry that shortfall is a warning that leaves `wgsl` in place, not an error
  // that would unsay the compile. A compute-only module has nothing GLSL ES 3.00 could serve,
  // so its refusal is not news and gets no diagnostic.
  if (wgsl !== undefined) {
    const hasRenderEntry = module.funcs.some((f) => f.stage === 'vertex' || f.stage === 'fragment');
    try {
      glsl = emitGlslStages(module);
    } catch (e) {
      if (hasRenderEntry) diagnostics.push(backendDiagnostic(r.sourceFile, e, 'warning'));
    }
  }

  return {
    diagnostics,
    module,
    wgsl,
    glsl,
    determinism: determinismReport(module),
    ...(wgsl !== undefined && consoleLog !== undefined ? { console: consoleLog } : {}),
    eval: (name, args = []) => {
      const err = firstError();
      if (err) {
        const code = err.code ? ` ${err.code}` : '';
        throw new Error(
          `Cannot evaluate "${name}": the module did not compile. ` +
            `${err.fileName}:${err.line}:${err.character}${code} ${err.message}`,
        );
      }
      return evalEntry(module, name, args, options.consoleSink);
    },
  };
}

/** The `TS8071` warning for a console call the WGSL does not record. */
function notRecordedDiagnostic(
  n: { readonly span?: SourceSpan; readonly method: string; readonly reason: string },
  fileName: string,
): TsCompilerDiagnostic {
  const at = n.span;
  return {
    message:
      `This console.${n.method}() is not recorded on the GPU, because ${n.reason}. ` +
      `It still reaches the sink when the function runs on the CPU.`,
    fileName: at?.file ?? fileName,
    line: (at?.line ?? 0) + 1,
    character: (at?.character ?? 0) + 1,
    endLine: (at?.endLine ?? 0) + 1,
    endCharacter: (at?.endCharacter ?? 0) + 1,
    category: 'warning',
    code: TS_CODES.CONSOLE_NOT_RECORDED,
    start: at?.start ?? 0,
    length: at?.length ?? 0,
  };
}
