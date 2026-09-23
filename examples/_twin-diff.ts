// ═══ Twin comparison — the side-by-side emit diff ═══
//
// A `.shade.ts` file carrying `twinOf` claims to be the SAME shader as an `fn()` EDSL
// example, written in the source language instead of built with `fn()` / `module()`. Two
// questions follow from that claim, and they fail differently:
//
//   1. ARE THE TWO PROGRAMS THE SAME PROGRAM? — answered by `semanticDiff()` from
//      `src/index.ts`, which is purpose-built for it: it compares the two modules across
//      four buckets (interface, resources, constants, control flow) and ignores identifier
//      spelling and declaration order by default, so backend and optimizer noise never
//      reaches the report. `shade-twins.test.ts` bakes its output directly.
//   2. WHAT DOES THE EMIT LOOK LIKE SIDE BY SIDE? — this file. A unified diff of the two
//      WGSL texts, which is what a reviewer reads when the answer to (1) is "not quite".
//      Textual, so it moves whenever either surface changes how it SPELLS this shader,
//      which `semanticDiff` deliberately does not report.
//
// An earlier version of this file also hand-rolled (1) — lowering both modules and
// rendering canonical statement lines. That was a worse copy of `semanticDiff`, reaching
// into `src/core/emit.js` and `src/core/backends/wgsl.js` to do it. Deleted: the public
// API exists, it is better, and an examples helper has no business reaching past
// `src/index.ts`.

/** Longest common subsequence over two line arrays, as the classic O(n·m) table. The inputs
 *  are single shaders (tens of lines), so the quadratic table is the right trade for not
 *  taking a dependency — and a diff that is itself a dependency is a diff nobody can read
 *  when it breaks. */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/**
 * A unified diff of two texts, with full context.
 *
 * Full context rather than the usual three lines: these are whole shaders of a few dozen
 * lines, and a golden that hides the unchanged body makes a reviewer open two other files to
 * see what the diff is a diff OF.
 *
 * @param original - the left text.
 * @param twin - the right text.
 * @param originalLabel - the `---` header label.
 * @param twinLabel - the `+++` header label.
 * @returns the diff, always ending in a newline.
 */
export function unifiedDiff(
  original: string,
  twin: string,
  originalLabel: string,
  twinLabel: string,
): string {
  const a = original.replace(/\n$/, '').split('\n');
  const b = twin.replace(/\n$/, '').split('\n');
  const table = lcs(a, b);
  const out: string[] = [`--- ${originalLabel}`, `+++ ${twinLabel}`];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]!}`);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push(`-${a[i]!}`);
      i++;
    } else {
      out.push(`+${b[j]!}`);
      j++;
    }
  }
  for (; i < a.length; i++) out.push(`-${a[i]!}`);
  for (; j < b.length; j++) out.push(`+${b[j]!}`);
  return `${out.join('\n')}\n`;
}
