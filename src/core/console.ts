// ═══ TypeShade console bridge ═══
//
// The source-level API intentionally uses the JavaScript Console API names. This file only
// describes the host-side bridge used by the CPU/debug execution path; it is not a new source
// syntax or a TypeShade-specific console object.

import type { SourceSpan } from './ir/span.js';
import type { CpuStruct, CpuValue } from './cpu-runtime.js';
import type { FuncDecl } from './ir/nodes.js';
import type { ShaderType } from './ir/types.js';

/** Console methods currently lowered by the TypeShade source compiler. */
export type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error' | 'table';

/** A console event produced by a TypeShade CPU/debug invocation. */
export interface ConsoleEvent {
  readonly method: ConsoleMethod;
  /** The arguments as the author wrote them: a value for each value, and the text of each
   *  string literal, which is a label the host keeps (surface §66). */
  readonly args: readonly (CpuValue | string)[];
  readonly span?: SourceSpan;
  /** Which invocation made the call, as three numbers: `global_invocation_id` for a compute entry, the pixel for
   *  a fragment entry (`[x, y, 0]`). Present on an event decoded from the GPU, and on one the
   *  CPU delivers while running an entry that takes that builtin. */
  readonly invocation?: readonly number[];
}

/** The event's arguments in the order written: `values` are the evaluated value arguments and
 *  `labels` the call's `labels` field (a string for a label, a number for an index into
 *  `values`). With no `labels`, the values alone, in order.
 *
 *  `tableRows` is {@link consoleTableRows} of the call: set, the one value is a matrix that a
 *  `console.table` delivers as its columns, each `tableRows` long (Rule 11.9). */
export function consoleArgs(
  values: readonly CpuValue[],
  labels: readonly (string | number)[] | undefined,
  tableRows?: number,
): (CpuValue | string)[] {
  const vs = tableRows === undefined ? values : values.map((v) => columnsOf(v, tableRows));
  if (labels === undefined) return [...vs];
  return labels.map((l) => (typeof l === 'string' ? l : vs[l]!));
}

/** The row count a `console.table` of a matrix delivers its columns at, or undefined for every
 *  other call: another method, or a value that is not a matrix (Rule 11.9). */
export function consoleTableRows(method: string, types: readonly ShaderType[]): number | undefined {
  const t = types[0];
  return method === 'table' && t?.kind === 'mat' ? t.rows : undefined;
}

/** A flat column-major matrix, as its columns. */
function columnsOf(v: CpuValue, rows: number): CpuValue {
  if (!Array.isArray(v)) return v;
  const flat = v as readonly number[];
  // An array of vectors, the shape `CpuValue` spells as an array of arrays by a cast wherever
  // one is built (an `array<vec2, N>` value is one too).
  return Array.from({ length: flat.length / rows }, (_, j) =>
    flat.slice(j * rows, (j + 1) * rows),
  ) as unknown as CpuValue;
}

/** Host callback used by the Playground, tests, and editor debug adapters. */
export type ConsoleSink = (event: ConsoleEvent) => void;

/** The invocation an entry called with `args` runs as, for {@link ConsoleEvent.invocation}:
 *  its `global_invocation_id` (compute), or the pixel `[x, y, 0]` its `position` names
 *  (fragment), the id a decoded GPU event carries (surface §66). Undefined for an entry that
 *  takes neither, or a value that is not a vector. */
export function consoleInvocation(
  decl: FuncDecl,
  args: readonly unknown[],
): readonly number[] | undefined {
  const at = decl.params.findIndex(
    (p) => p.builtin === 'global_invocation_id' || p.builtin === 'position',
  );
  if (at < 0) return undefined;
  const v = args[at];
  if (!Array.isArray(v)) return undefined;
  const n = v.map((x) => Math.max(0, Math.floor(Number(x))));
  return decl.params[at]!.builtin === 'position'
    ? [n[0] ?? 0, n[1] ?? 0, 0]
    : [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
}

/** The JavaScript Console API methods TypeShade recognizes in shader source today. */
export const CONSOLE_METHODS: ReadonlySet<ConsoleMethod> = new Set([
  'log',
  'info',
  'debug',
  'warn',
  'error',
  'table',
]);

/** Whether `name` is one of the console methods the source compiler lowers, narrowing it to
 *  {@link ConsoleMethod}. The front end asks this for every `console.<name>(...)` it meets, and
 *  refuses the rest by name rather than inventing a TypeShade console of its own. */
export function isConsoleMethod(name: string): name is ConsoleMethod {
  return CONSOLE_METHODS.has(name as ConsoleMethod);
}

/** The shape of one value the console buffer carries, as the decoder reads it back: a scalar,
 *  an `f64` (two words, hi and lo), a vector, a column-major matrix, a fixed-size array, or a
 *  struct's fields in order. Each rebuilds the value the CPU delivers for that type. */
export type ConsoleShape =
  | 'f32'
  | 'i32'
  | 'u32'
  | 'bool'
  | 'f64'
  | { readonly vec: 2 | 3 | 4; readonly of: 'f32' | 'i32' | 'u32' | 'bool' | 'f64' }
  | { readonly mat: readonly [2 | 3 | 4, 2 | 3 | 4]; readonly of: 'f32' | 'f64' }
  | { readonly array: ConsoleShape; readonly n: number }
  | { readonly struct: readonly (readonly [string, ConsoleShape])[] };

/** One console call the WGSL records: its method, where it was written, its arguments in the
 *  order written (a label's text, or a value's shape), and the words its entry takes. */
export interface ConsoleSite {
  readonly method: ConsoleMethod;
  readonly span?: SourceSpan;
  readonly args: readonly ({ readonly label: string } | { readonly shape: ConsoleShape })[];
  readonly words: number;
}

/** Where the console buffer is bound and what each entry in it means (surface §66). Plain data,
 *  so a worker can post it. `CompileResult.console` under `compile(src, { console: 'gpu' })`. */
export interface ConsoleLog {
  readonly group: number;
  readonly binding: number;
  /** One per recorded call; an entry's first word is its index here. */
  readonly sites: readonly ConsoleSite[];
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
const I32 = new Int32Array(F32.buffer);

/**
 * Decode a console buffer the host copied back into the events the CPU sink would receive.
 *
 * `buffer` is the whole storage buffer as `u32` words: the cursor, the dropped count, then the
 * entries. The events come back in the order the CPU tier runs a dispatch in, by invocation
 * (z, then y, then x) and, within one invocation, in the order the calls ran; each carries its
 * `invocation`. `dropped` counts the calls that did not fit the buffer.
 *
 * Exported from `typeshade`.
 */
export function decodeConsole(
  buffer: Uint32Array,
  log: ConsoleLog,
): { events: ConsoleEvent[]; dropped: number } {
  const cursor = buffer[0] ?? 0;
  const dropped = buffer[1] ?? 0;
  const data = buffer.subarray(2);
  const end = Math.min(cursor, data.length);
  const out: { e: ConsoleEvent; seq: number }[] = [];
  let p = 0;
  let q = 0;
  const f32 = (w: number): number => {
    U32[0] = w;
    return F32[0]!;
  };
  const read = (shape: ConsoleShape): CpuValue => {
    if (typeof shape === 'string') {
      const w = data[q++]!;
      switch (shape) {
        case 'u32':
          return w;
        case 'i32':
          U32[0] = w;
          return I32[0]!;
        case 'bool':
          return w !== 0;
        case 'f32':
          return f32(w);
        case 'f64':
          return f32(w) + f32(data[q++]!);
      }
    }
    if ('vec' in shape)
      return Array.from({ length: shape.vec }, () => read(shape.of)) as number[] | boolean[];
    if ('mat' in shape)
      return Array.from({ length: shape.mat[0] * shape.mat[1] }, () => read(shape.of)) as number[];
    if ('array' in shape)
      return Array.from({ length: shape.n }, () => read(shape.array)) as unknown as number[];
    const v: CpuStruct = {};
    for (const [name, s] of shape.struct) v[name] = read(s);
    return v;
  };
  while (p < end) {
    const site = log.sites[data[p]!];
    if (site === undefined) break;
    // The entry that straddles the end wrote its site word only: it, and every later one, was
    // dropped.
    if (p + site.words > data.length) break;
    const invocation = [data[p + 1]!, data[p + 2]!, data[p + 3]!] as const;
    q = p + 4;
    const args = site.args.map((a) => {
      if ('label' in a) return a.label;
      const v = read(a.shape);
      // A table of a matrix is its columns, as the CPU delivers it (Rule 11.9).
      return site.method === 'table' && typeof a.shape === 'object' && 'mat' in a.shape
        ? columnsOf(v, a.shape.mat[1])
        : v;
    });
    out.push({
      e: { method: site.method, args, ...(site.span ? { span: site.span } : {}), invocation },
      seq: out.length,
    });
    p += site.words;
  }
  out.sort((a, b) => {
    const x = a.e.invocation!;
    const y = b.e.invocation!;
    return x[2] - y[2] || x[1] - y[1] || x[0] - y[0] || a.seq - b.seq;
  });
  return { events: out.map((o) => o.e), dropped };
}
