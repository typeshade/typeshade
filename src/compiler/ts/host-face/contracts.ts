import type { HostExport } from '../host-face-contracts.js';
import type { TsCompilerDiagnostic } from '../source-file.js';

/** How {@link hostFace} is called. */
export interface HostFaceOptions {
  /** The shader module's path, carried into the diagnostics and named in the generated files. */
  readonly fileName: string;
  /** The exact identity of this module's fusion records (change 0122). Defaults to `fileName`;
   *  an empty string is an explicit identity. Distinct modules that can share a fusion scope
   *  need distinct identities. This does not change source paths, imports, diagnostics or
   *  views, and has no effect with `fuse: false`. */
  readonly origin?: string;
  /** The specifier the generated module imports its runtime from. Defaults to
   *  `typeshade/runtime/internal`; a test points it at the source file. A tool that runs the
   *  generated module without a bundler (change 0062) maps `typeshade/runtime/internal` to the
   *  package's own copy, as a bundler does: it is what a generated module imports, not API for
   *  a host to import. */
  readonly runtime?: string;
  /** `'gpu'` records each `console.*` call a GPU entry reaches into the `_console` buffer
   *  (change 0014). The Vite plugin sets it in `vite dev`. Production retains an optional
   *  manifest variant without recording; `'never'` omits that variant too. */
  readonly console?: 'gpu' | 'never';
  /** Put the program's portable IR in the manifest, the default export, so the load-time
   *  emitter (`typeshade/emit`) can emit it again (change 0025). */
  readonly ir?: boolean;
  /** Write into the face of each kernel function that lowers the facts of its loops and the
   *  lowered module they name as portable IR, which the planner of `typeshade/fuse` fuses a
   *  chain of its calls from (change 0058). Enabled by default (change 0085); `false` omits
   *  these facts to reduce generated size. Ordinary input projection remains independent. */
  readonly fuse?: boolean;
  /** Reads a shader file the module imports (Rule 3.9), and a package's `package.json`: the
   *  module and what it imports are one program, and its face is the module's own exports and
   *  re-exports. The Vite plugin reads from disk. */
  readonly readDocument?: (fileName: string) => string | undefined;
  /** The file a specifier written in `fromFile` names; defaults to the rule `compile()` uses. */
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

/** The host face of one shader module. */
export interface HostFace {
  /** The module's own diagnostics. When one is an error, the module does not compile and
   *  `exports`, `view` and `code` are absent: a build fails with these. */
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  readonly exports?: readonly HostExport[];
  /** The host view's text (`name.shade.typeshade.ts`). */
  readonly view?: string;
  /** The generated module's JavaScript. */
  readonly code?: string;
  /** Every file the compile read, the module first: what a bundler watches, so an edit to a
   *  file the module imports rebuilds it. */
  readonly files: readonly string[];
}
