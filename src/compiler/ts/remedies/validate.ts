// Batch validation owns edited compilation, error comparison and the bounded cache.
// Analysis supplies source regions and projection spans; re-entry uses only the callback.

import type ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { TS_CODES } from '../codes.js';
import { NO_DIVISION } from './contracts.js';
import type { BatchItem, DivisionEditCheck, SourceChange } from './contracts.js';

/** An editor-only annotation removed before checking the authored text. */
export interface ProjectionSpan {
  readonly at: number;
  readonly length: number;
}

/** True while a named edit is being compiled: the refusals of that compile name their preferred
 *  edit unchecked, so a check never starts another. */
let checkingEdit = false;

/**
 * Checks the edits every refused `/` of the module names (the trees of written integers, the
 * bindings that hold one and the constants of no fixed type): the owner's decision of
 * 2026-11-12, "name only verified edits". Each refusal's edit takes its type from where the
 * quotient flows (provided by use analysis). Every edit is made at once and the program compiled
 * once; the edits are named when that adds no error the unedited program does not give at the
 * same place, and no type error where a quotient flows. Else one more set is compiled, where
 * a refusal that only an integer of either type decides takes `u32` and one nothing decides
 * takes `i32`. Where that adds an error too, or where a refusal's positions ask two types or
 * cannot be followed, no refusal of the module names an edit: each says what to write around
 * which operand. At most two edited programs are compiled a module.
 */
export function checkModuleEdits(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  items: readonly BatchItem[],
  regions: readonly (readonly [number, number])[],
  projections: readonly ProjectionSpan[],
  check: DivisionEditCheck,
): void {
  if (items.length === 0) return;
  // A module with one refusal whose positions ask one type names no wrap it has not verified:
  // the text names no edit only where refusals conflict (D4 of 2026-11-12).
  const unverified = (it: BatchItem): void =>
    items.length === 1 && !it.conflict && it.bare !== undefined ? it.bare() : it.generic();
  if (items.some((it) => it.conflict || it.sets[0] === undefined)) {
    for (const it of items) unverified(it);
    return;
  }
  const own = new Set(items.map((it) => it.diagnostic()));
  const keyOf = (at: number | undefined, e: { code?: string; message: string }) =>
    `${String(at ?? -1)}|${lineOf(e)}`;
  // The unedited program's errors, by place and text, counted: an equal error elsewhere does not
  // hide an added one.
  const original = new Map<string, number>();
  for (const d of diagnostics) {
    if (d.category !== 'error' || own.has(d)) continue;
    const k = keyOf(d.start, d);
    original.set(k, (original.get(k) ?? 0) + 1);
  }
  // A type error the edited program gives where a quotient flows is the edits' even where the
  // unedited program gives it too (`let z = q * r; let j: i32 = z`).
  const clean = (set: 0 | 1): boolean => {
    const changes = new Map<string, SourceChange>();
    for (const it of items) {
      const c = it.sets[set];
      if (c === undefined) return false;
      changes.set(`${String(c.start)}:${String(c.end)}:${c.text}`, c);
    }
    const sorted = [...changes.values()].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start < sorted[i - 1]!.end) return false;
    }
    const left = new Map(original);
    return compileEditedAll(sourceFile, sorted, projections, check).every((e) => {
      const typed = e.code === TS_CODES.TYPE_MISMATCH || e.code === TS_CODES.MATH_ARGUMENT;
      if (typed && e.at !== undefined && regions.some(([a, b]) => e.at! >= a && e.at! < b)) {
        return false;
      }
      const k = keyOf(e.at, e);
      const count = left.get(k) ?? 0;
      if (count === 0) return false;
      left.set(k, count - 1);
      return true;
    });
  };
  const same = (c: SourceChange | undefined, d: SourceChange | undefined) =>
    c !== undefined &&
    d !== undefined &&
    c.start === d.start &&
    c.end === d.end &&
    c.text === d.text;
  const differs = items.some((it) => !same(it.sets[0], it.sets[1]));
  const named: 0 | 1 | undefined = clean(0) ? 0 : differs && clean(1) ? 1 : undefined;
  for (const it of items) {
    if (named === undefined) unverified(it);
    else it.name(named);
  }
  if (named === undefined) return;
  // The refusals as they now stand (naming an edit replaced some) stay.
  for (const it of items) {
    const d = it.diagnostic();
    if (d !== undefined) own.add(d);
  }
  // The edited program gives no type error where a quotient flows: such an error of the
  // unedited program (`let k: u32 = g()` beside `function g() { return (1 | 2) / 2; }`) is the
  // refusal said again (Rule 12.4).
  for (let i = diagnostics.length - 1; i >= 0; i--) {
    const d = diagnostics[i]!;
    if (own.has(d) || d.category !== 'error' || d.message.includes(NO_DIVISION)) continue;
    if (d.code !== TS_CODES.TYPE_MISMATCH && d.code !== TS_CODES.MATH_ARGUMENT) continue;
    if (regions.some(([a, b]) => d.start >= a && d.start < b)) diagnostics.splice(i, 1);
  }
}

/** A diagnostic as one comparable line. */
function lineOf(d: { readonly code?: string; readonly message: string }): string {
  return `${d.code ?? ''}: ${d.message}`;
}

let editCompiles = 0;

/** Whether the program being compiled is an edited copy that a checked edit compiles. Such a
 *  compile is read for its type errors alone, so the passes an edit's type cannot change (the
 *  uniformity walk, the kernel-loop proof) are skipped in it. */
export function compilingCheckedEdit(): boolean {
  return checkingEdit;
}

/** How many edited programs the checked edits have compiled in this process (for tests that
 *  bound the cost of the check). */
export function checkedEditCompiles(): number {
  return editCompiles;
}

/** The errors of `sourceFile`'s text with `changes` made, each with its offset in the original
 *  text (the change's own offset inside a change). In the editor the projection's insertions
 *  are taken out first, so the author's text is compiled, with the edits made, as `compile()`
 *  reads it; an insertion a change replaces goes with it. */
function compileEditedAll(
  sourceFile: ts.SourceFile,
  changes: readonly { readonly start: number; readonly end: number; readonly text: string }[],
  projections: readonly ProjectionSpan[],
  check: DivisionEditCheck,
): { readonly code?: string; readonly message: string; readonly at: number | undefined }[] {
  const edits = changes.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  for (const { at, length } of projections) {
    if (changes.every((c) => at + length <= c.start || at >= c.end)) {
      edits.push({ start: at, end: at + length, text: '' });
    }
  }
  edits.sort((a, b) => a.start - b.start);
  let text = '';
  let from = 0;
  // Each piece of the edited text, with the original offset it starts at.
  const pieces: { at: number; original: number; length: number; inside?: boolean }[] = [];
  for (const e of edits) {
    pieces.push({ at: text.length, original: from, length: e.start - from });
    text += sourceFile.text.slice(from, e.start);
    // An error inside a change stands where the change does.
    pieces.push({ at: text.length, original: e.start, length: e.text.length, inside: true });
    text += e.text;
    from = e.end;
  }
  pieces.push({ at: text.length, original: from, length: sourceFile.text.length - from });
  text += sourceFile.text.slice(from);
  const back = (offset: number | undefined): number | undefined => {
    if (offset === undefined) return undefined;
    for (const p of pieces) {
      if (offset >= p.at && offset < p.at + Math.max(p.length, 1)) {
        return p.inside === true ? p.original : p.original + (offset - p.at);
      }
    }
    return undefined;
  };
  const key = `${sourceFile.fileName}\n${text}`;
  let errors = editedErrors.get(key);
  if (errors === undefined) {
    checkingEdit = true;
    editCompiles++;
    try {
      errors = check(text, undefined);
    } finally {
      checkingEdit = false;
    }
    editedErrors.set(key, errors);
    // A few recent programs: the editor checks the same edits again in its next pass.
    if (editedErrors.size > 16) editedErrors.delete(editedErrors.keys().next().value!);
  }
  return errors.map((d) => ({
    ...(d.code !== undefined ? { code: d.code } : {}),
    message: d.message,
    at: back(d.start),
  }));
}

/** The errors of each edited program compiled lately, by its file and text: the compile is a
 *  function of the text, and the editor checks one module's edits on each of its passes. */
const editedErrors = new Map<string, ReturnType<DivisionEditCheck>>();
