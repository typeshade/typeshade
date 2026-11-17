// The two readings of one `"use typeshade"` program (Rule 12.7): `compile()` and the editor.
//
// A test of a form an author can write, or of a refusal, asserts both readings of the same
// source. `bothHalves` returns them in one shape, so a test cannot read one and forget the
// other. `src/both-halves-policy.test.ts` requires a test that reads `compile()`'s diagnostics
// to read the editor too.

import { compile, type CompileOptions } from '../../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** The two readings of one program. A diagnostic is written `source code: text`. */
export interface BothHalves {
  /** What `compile()` returned. */
  readonly result: ReturnType<typeof compile>;
  /** The error diagnostics of `compile()`, each `typeshade TS8xxx: text`. */
  readonly compiler: readonly string[];
  /** The diagnostics of the language service, each `typeshade TS8xxx: text` or
   *  `typescript NNNN: text`. */
  readonly editor: readonly string[];
  /** The hover text at the first occurrence of `needle` in the source, or `undefined`. */
  hover(needle: string): string | undefined;
}

/** Options of {@link bothHalves}. */
export interface BothHalvesOptions {
  /** The name both halves read the source under. Default: `a.shade.ts`. */
  readonly fileName?: string;
  /** Further options of `compile()`. */
  readonly compile?: Omit<CompileOptions, 'fileName'>;
}

/** Reads `source` with `compile()` and with the language service. */
export function bothHalves(source: string, options: BothHalvesOptions = {}): BothHalves {
  const fileName = options.fileName ?? 'a.shade.ts';
  const result = compile(source, { ...options.compile, fileName });
  const service = createTypeshadeLanguageService();
  service.openDocument(fileName, source);
  return {
    result,
    compiler: result.diagnostics
      .filter((d) => d.category === 'error')
      .map((d) => `typeshade ${d.code}: ${d.message}`),
    editor: service
      .getDiagnostics(fileName)
      .map((d) => `${d.source} ${String(d.code)}: ${d.message}`),
    hover(needle) {
      const offset = source.indexOf(needle);
      if (offset < 0) throw new Error(`bothHalves.hover: "${needle}" is not in the source`);
      const before = source.slice(0, offset).split('\n');
      return service.getHover(fileName, {
        line: before.length - 1,
        character: before[before.length - 1]!.length,
      })?.contents;
    },
  };
}

/** Both halves take `source`: returns the readings, or throws with the half that refused. */
export function bothTake(source: string, options: BothHalvesOptions = {}): BothHalves {
  const halves = bothHalves(source, options);
  const all = halves.result.diagnostics.map((d) => `typeshade ${d.code}: ${d.message}`);
  if (all.length > 0) throw new Error(`compile() reported:\n${all.join('\n')}`);
  if (halves.editor.length > 0) {
    throw new Error(`the editor reported:\n${halves.editor.join('\n')}`);
  }
  return halves;
}

/** Both halves refuse `source` with exactly `sentences` (one sentence, or a list), under `code`
 *  (Rule 12.5): returns the readings, or throws with the half that differs. */
export function bothRefuse(
  source: string,
  code: string,
  sentences: string | readonly string[],
  options: BothHalvesOptions = {},
): BothHalves {
  const halves = bothHalves(source, options);
  const want = (typeof sentences === 'string' ? [sentences] : sentences).map(
    (s) => `typeshade ${code}: ${s}`,
  );
  const differs = (got: readonly string[]): boolean =>
    got.length !== want.length || got.some((g, i) => g !== want[i]);
  const show = (lines: readonly string[]): string =>
    lines.length === 0 ? '  (nothing)' : lines.map((l) => `  ${l}`).join('\n');
  if (differs(halves.compiler)) {
    throw new Error(`compile() reported:\n${show(halves.compiler)}\nexpected:\n${show(want)}`);
  }
  if (differs(halves.editor)) {
    throw new Error(`the editor reported:\n${show(halves.editor)}\nexpected:\n${show(want)}`);
  }
  return halves;
}
