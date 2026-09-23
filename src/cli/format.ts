// === How `typeshade check` prints a report: text, short, or JSON ===
//
// `text` is `tsc --pretty`'s layout without the colour: a `file:line:col - error TSxxxx:`
// header, then the offending line under a line-number gutter with `~` beneath the span. It is
// the shape a reader, and a model trained on a great deal of `tsc` output, already knows how to
// act on, and it makes every diagnostic readable without opening the file. `short` is the
// header alone, one line per diagnostic, for a log or a grep. `json` is the report itself, for
// a tool.

import type { CheckDiagnostic, CheckReport } from '../language-service/check.js';

/** The output formats `typeshade check --format` accepts. */
export const CHECK_FORMATS = ['text', 'short', 'json'] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

/** The version of the JSON shape `--format json` prints. Bumped only by a change that could
 *  break a reader: a field removed, renamed or re-typed. A new field does not bump it. */
export const CHECK_JSON_VERSION = 1;

/** At most this many lines of one span are printed; a longer span shows its first lines, an
 *  elision marker and its last line. */
const MAX_SPAN_LINES = 4;

const header = (d: CheckDiagnostic): string =>
  `${d.file}:${d.line}:${d.column} - ${d.severity} ${d.code}: ${d.message.split('\n').join('\n  ')}`;

/** The source lines `d` covers, each with the `~` run under the part the span covers. */
function frame(d: CheckDiagnostic, text: string): string[] {
  const lines = text.split('\n');
  const last = d.length === 0 ? d.line : d.endLine;
  const numbers: number[] = [];
  for (let n = d.line; n <= last && n <= lines.length; n++) numbers.push(n);
  const shown =
    numbers.length > MAX_SPAN_LINES
      ? [...numbers.slice(0, MAX_SPAN_LINES - 1), -1, numbers[numbers.length - 1]!]
      : numbers;
  const gutter = String(Math.max(...numbers)).length;
  const out: string[] = [];
  for (const n of shown) {
    if (n === -1) {
      out.push(`${'.'.repeat(gutter)}`);
      continue;
    }
    const src = (lines[n - 1] ?? '').replace(/\r$/, '');
    const from = n === d.line ? d.column - 1 : src.search(/\S|$/);
    const to = n === last ? (d.length === 0 ? from + 1 : d.endColumn - 1) : src.length;
    out.push(`${String(n).padStart(gutter)} ${src}`.trimEnd());
    out.push(`${' '.repeat(gutter)} ${' '.repeat(from)}${'~'.repeat(Math.max(to - from, 1))}`);
  }
  return out;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The closing line: what was found, in how many files, out of how many checked. */
export function summaryLine(report: CheckReport): string {
  const checked = plural(report.files.length, 'file');
  if (report.errors === 0 && report.warnings === 0) return `No problems found in ${checked}.`;
  const parts = [plural(report.errors, 'error')];
  if (report.warnings > 0) parts.push(plural(report.warnings, 'warning'));
  const affected = new Set(
    report.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.file),
  ).size;
  return `Found ${parts.join(' and ')} in ${plural(affected, 'file')} (${checked} checked).`;
}

/**
 * Renders `report` in `format`. `sources` maps each reported file to its text, for the code
 * frames of the `text` format; a file with no entry is printed without one.
 */
export function formatCheckReport(
  report: CheckReport,
  format: CheckFormat,
  sources: ReadonlyMap<string, string> = new Map(),
): string {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        version: CHECK_JSON_VERSION,
        files: report.files,
        diagnostics: report.diagnostics,
        summary: {
          errors: report.errors,
          warnings: report.warnings,
          files: report.files.length,
        },
      },
      null,
      2,
    )}\n`;
  }
  const blocks = report.diagnostics.map((d) => {
    if (format === 'short') return header(d);
    const text = sources.get(d.file);
    return text === undefined ? header(d) : [header(d), '', ...frame(d, text)].join('\n');
  });
  const body = blocks.join(format === 'short' ? '\n' : '\n\n');
  return `${body}${body === '' ? '' : format === 'short' ? '\n' : '\n\n'}${summaryLine(report)}\n`;
}
