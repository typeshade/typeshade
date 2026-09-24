// ═══ TypeShade console bridge ═══
//
// The source-level API intentionally uses the JavaScript Console API names. This file only
// describes the host-side bridge used by the CPU/debug execution path; it is not a new source
// syntax or a TypeShade-specific console object.

import type { SourceSpan } from './ir/span.js';
import type { CpuValue } from './cpu-runtime.js';

/** Console methods currently lowered by the TypeShade source compiler. */
export type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

/** A console event produced by a TypeShade CPU/debug invocation. */
export interface ConsoleEvent {
  readonly method: ConsoleMethod;
  /** The arguments as the author wrote them: a value for each value, and the text of each
   *  string literal, which is a label the host keeps (surface §66). */
  readonly args: readonly (CpuValue | string)[];
  readonly span?: SourceSpan;
}

/** The event's arguments in the order written: `values` are the evaluated value arguments and
 *  `labels` the call's `labels` field (a string for a label, a number for an index into
 *  `values`). With no `labels`, the values alone, in order. */
export function consoleArgs(
  values: readonly CpuValue[],
  labels: readonly (string | number)[] | undefined,
): (CpuValue | string)[] {
  if (labels === undefined) return [...values];
  return labels.map((l) => (typeof l === 'string' ? l : values[l]!));
}

/** Host callback used by the Playground, tests, and editor debug adapters. */
export type ConsoleSink = (event: ConsoleEvent) => void;

/** The JavaScript Console API methods TypeShade recognizes in shader source today. */
export const CONSOLE_METHODS: ReadonlySet<ConsoleMethod> = new Set([
  'log',
  'info',
  'debug',
  'warn',
  'error',
]);

/** Whether `name` is one of the console methods the source compiler lowers, narrowing it to
 *  {@link ConsoleMethod}. The front end asks this for every `console.<name>(...)` it meets, and
 *  refuses the rest by name rather than inventing a TypeShade console of its own. */
export function isConsoleMethod(name: string): name is ConsoleMethod {
  return CONSOLE_METHODS.has(name as ConsoleMethod);
}
