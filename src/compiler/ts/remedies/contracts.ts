import type { TsCompilerDiagnostic } from '../source-file.js';

/** The clause shared by division refusals and their batch validation. */
export const NO_DIVISION = 'does not say which division it is';

/** One change to the source: `[start, end)` replaced by `text`. */
export interface SourceChange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One refusal in the module's check: the change each of the two sets makes (`undefined`: the
 *  refusal names no edit that can be checked), and how it names a set's edit or none. */
export interface BatchItem {
  readonly diagnostic: () => TsCompilerDiagnostic | undefined;
  readonly sets: readonly [SourceChange | undefined, SourceChange | undefined];
  readonly conflict: boolean;
  readonly name: (set: 0 | 1) => void;
  readonly generic: () => void;
  /** States the refusal with no remedy: what is true of it, where no wrap verifies in a module
   *  with this one refusal (the fourteenth review of #1272, F4). Absent: `generic` is said. */
  readonly bare?: () => void;
}

/** One edit a refusal can name: the text to write, the division it makes, and how it changes
 *  the source, to check that it compiles where the quotient stands (Rule 5.1). */
export interface DivisionEdit {
  readonly text: string;
  readonly kind: 'integer' | 'float';
  /** `[start, end)` of the source and the text that replaces it; `undefined` for a `/=`, whose
   *  edit declares its variable (`declarationChange` makes that change). */
  readonly change?: SourceChange;
}

/** Compiles `text`, a whole source with one edit made, and returns its errors. `starts` are the
 *  editor projection's insertions in `text`, moved past the edit. */
export type DivisionEditCheck = (
  text: string,
  starts: readonly number[] | undefined,
) => readonly { readonly code?: string; readonly message: string; readonly start?: number }[];
