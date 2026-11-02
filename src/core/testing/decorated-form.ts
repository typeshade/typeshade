// The `TS8028` warning the migration release gives each decorator of the decorated form
// (change 0111, milestone 4, `src/compiler/ts/decorated-form.ts`). A test whose point is not the
// decorated form, and which reads a source written in it on purpose (a partial program, a
// decorator refusal, a form the stage calls do not have), drops these warnings and keeps every
// other diagnostic it asserted. A test about the decorated form asserts the warning itself.

/** The words every decorated-form warning says. */
export const DECORATED_FORM = 'is the decorated form, which the next release refuses';

/** A diagnostic as the compiler (`category`) or the language service (`severity`) gives it. */
interface AnyDiagnostic {
  readonly code?: string | number;
  readonly message: string | { toString(): string };
  readonly category?: string;
  readonly severity?: string;
}

/** Whether `d` is the decorated-form warning. */
export function isDecoratedFormWarning(d: AnyDiagnostic): boolean {
  return (
    String(d.code) === 'TS8028' &&
    (d.category ?? d.severity) === 'warning' &&
    String(d.message).includes(DECORATED_FORM)
  );
}

/** `diagnostics` without the decorated-form warnings. */
export function withoutDecoratedForm<T extends AnyDiagnostic>(diagnostics: readonly T[]): T[] {
  return diagnostics.filter((d) => !isDecoratedFormWarning(d));
}
