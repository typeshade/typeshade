// ═══ The printed console line (change 0025, Rule 8.24, surface §66) ═══
//
// Every `console.*` event the call layer or the program runtime prints goes through here, from
// the GPU's console buffer and from the CPU tier alike, so a line says where it ran the same way
// on both:
//
//    GPU  particles.shade.ts:14  [3, 0, 0]  x 4.5
//
// The tier is a label a browser draws with `%c`, which Node skips. The prefix is the format
// string and the event's arguments follow it, so a label that holds `%d` prints as written. The
// method stays, so `console.warn` is still a warning. A host that shows the events itself takes
// them through a sink and never reaches this file.

import type { ConsoleEvent, ConsoleMethod } from './console.js';

/** Where an event ran: decoded from the GPU's console buffer, or delivered by the CPU tier. */
export type ConsoleTier = 'GPU' | 'CPU';

/** One call of the host's console: the method and its arguments. */
export interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

/** The label's style for each tier, and the location's. A browser applies them; Node skips them. */
const TIER_STYLE: Readonly<Record<ConsoleTier, string>> = {
  GPU: 'background:#6d28d9;color:#fff;border-radius:3px;padding:0 4px',
  CPU: 'background:#0f766e;color:#fff;border-radius:3px;padding:0 4px',
};
const WHERE_STYLE = 'color:#888';

/** Text for a format string that holds no directive: each `%` doubled. */
const literal = (s: string): string => s.replace(/%/g, '%%');

/** The prefix of an event's line: the tier, then `file:line` and the invocation when the event
 *  has them, as a format string and the styles its two `%c` take. */
function prefix(tier: ConsoleTier, where: readonly string[]): [string, string, string] {
  const rest = where.length === 0 ? ' ' : ` ${literal(where.join('  '))} `;
  return [`%c ${tier} %c${rest}`, TIER_STYLE[tier], WHERE_STYLE];
}

/** The source line of `e` as `file:line`, the file's last path segment and a one-based line,
 *  or undefined when the event has no span. */
function sourceOf(e: ConsoleEvent): string | undefined {
  if (e.span === undefined) return undefined;
  const file = e.span.file.split(/[\\/]/).pop() ?? e.span.file;
  return `${file}:${e.span.line + 1}`;
}

/**
 * The console calls that print `e` from `tier`: one call with the event's method, its prefix in
 * the format string and the event's arguments after it; for a `console.table`, the prefix on a
 * `console.log` call and then the table.
 */
export function consoleCalls(e: ConsoleEvent, tier: ConsoleTier): ConsoleCall[] {
  const where: string[] = [];
  const source = sourceOf(e);
  if (source !== undefined) where.push(source);
  if (e.invocation !== undefined) where.push(`[${e.invocation.join(', ')}]`);
  const head = prefix(tier, where);
  if (e.method === 'table')
    return [
      { method: 'log', args: head },
      { method: 'table', args: e.args },
    ];
  return [{ method: e.method, args: [...head, ...e.args] }];
}

/** The warning for `dropped` calls of `entry` that did not fit its console buffer, with the
 *  GPU's prefix. */
export function droppedCall(entry: string, dropped: number): ConsoleCall {
  const [format, ...styles] = prefix('GPU', []);
  return {
    method: 'warn',
    args: [
      `${format}${literal(entry)}(): ${dropped} console calls did not fit the console buffer.`,
      ...styles,
    ],
  };
}

/** Print `e` from `tier` on the host's console. */
export function printConsole(e: ConsoleEvent, tier: ConsoleTier): void {
  for (const c of consoleCalls(e, tier)) console[c.method](...c.args);
}

/** Print the warning for `dropped` calls of `entry` that did not fit, when there were any. */
export function printDropped(entry: string, dropped: number): void {
  if (dropped === 0) return;
  const c = droppedCall(entry, dropped);
  console[c.method](...c.args);
}
