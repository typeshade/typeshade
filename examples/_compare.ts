// ═══ The shared compare helper of the example checks (change 0145, amendment A2, M4.6) ═══
//
// Holds what a run gave back to what it should give: the pixels or the values of one part, within
// a tolerance. `path/_reference.ts`, `hosts/_reference.ts`, the CPU driver check (C4) and the
// oracle check (C5) share it, so one rule decides when two numbers agree.
//
// No imports and no environment: the gate reads `hosts/_reference.ts` under Bun, and that file
// reads this one.

/** A canvas the driver draws into, and how to read it back. */
export interface Surface {
  /** A fresh canvas of this size, into which nothing has drawn. */
  canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
  /** The canvas's pixels: RGBA, one byte to a channel, the top row first. */
  pixels(canvas: HTMLCanvasElement | OffscreenCanvas): number[] | Promise<number[]>;
}

/** What one run gave back: each part as numbers. */
export type Outputs = Readonly<Record<string, readonly number[]>>;

/** `_drive.ts`'s export, typed here so a caller can import the driver by a computed path and
 *  still type what it gets (`tsconfig.tests.json` cannot read the host files it imports). */
export type Drive = (
  surface: Surface,
  ids: readonly string[],
) => Promise<Readonly<Record<string, Outputs | string>>>;

/** How far two numbers may differ: `absolute + relative * max(1, |want|)`. */
export interface Tolerance {
  readonly absolute: number;
  readonly relative?: number;
}

/** One part of a reference: the values, and the tolerance of each. */
export interface Expected {
  readonly values: readonly number[];
  readonly tolerance: Tolerance;
}

/** Hold one part to its values.
 *  @returns one line when the part is missing, has another length, or differs, empty otherwise.
 *  A `NaN` never agrees. */
export function compareValues(
  label: string,
  ran: readonly number[] | undefined,
  want: readonly number[],
  tolerance: Tolerance,
): string[] {
  if (ran === undefined) return [`${label}: missing, expected ${want.length} values`];
  if (ran.length !== want.length)
    return [`${label}: ${ran.length} values, expected ${want.length}`];
  const { absolute, relative = 0 } = tolerance;
  let worst = -1;
  let at = -1;
  want.forEach((w, i) => {
    const d = Math.abs(ran[i]! - w);
    const excess = d - (absolute + relative * Math.max(1, Math.abs(w)));
    if (!(excess <= 0) && !(excess <= worst)) {
      worst = excess;
      at = i;
    }
  });
  return at < 0
    ? []
    : [
        `${label}: element ${at} is ${ran[at]}, expected ${want[at]} ` +
          `(allowed ${absolute} absolute, ${relative} relative)`,
      ];
}

/** Hold every part of a run to `want`, or report the run's failure.
 *  @param got - what the run gave back, or the error it threw, as a string. */
export function compareParts(
  id: string,
  got: Outputs | string | undefined,
  want: Readonly<Record<string, Expected>> | undefined,
): string[] {
  if (want === undefined) return [`${id}: no reference`];
  if (got === undefined) return [`${id}: did not run`];
  if (typeof got === 'string') return [`${id}: ${got}`];
  return Object.entries(want).flatMap(([part, { values, tolerance }]) =>
    compareValues(`${id}.${part}`, got[part], values, tolerance),
  );
}

/** The labels of the numbers in `got` that are not finite, empty when all are. */
export function nonFinite(got: Outputs): string[] {
  return Object.entries(got).flatMap(([part, values]) =>
    values.flatMap((v, i) => (Number.isFinite(v) ? [] : [`${part}[${i}] is ${v}`])),
  );
}
