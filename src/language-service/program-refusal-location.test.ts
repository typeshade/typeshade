// A refusal that is true of a program, about a declaration another file of the program holds,
// is reported in the file the program starts from, at the use that makes it a refusal (#1186).
// The declaring file's own program accepts the declaration, so its document shows nothing, and
// the declaration is the diagnostic's related site.
//
// Each case is read by both halves on the same files (Rule 12.7): `compile()` of each program,
// and the language service's `getDiagnostics` of each open document. The code and the text are
// the compiler's in both (Rule 12.5), and each program that refuses reports once (Rule 12.4).
// `tshc check` reports what the documents report.
//
// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/). It also holds Rules 12.4 and
// 12.7 on these programs, which their own test files verify.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { relatedSitesOf } from '../compiler/ts/diagnostic.js';
import { runCli, type CliHost } from '../cli/run.js';
import { createTypeshadeLanguageService, type TypeshadeLanguageService } from './service.js';

/** The files of one project, by the name each is opened and imported under. */
type Files = Readonly<Record<string, string>>;

/** One diagnostic as both halves must say it. */
interface Said {
  readonly code: string;
  readonly message: string;
  /** The file the diagnostic is in. */
  readonly file: string;
  /** The text it underlines. */
  readonly at: string;
  /** The text of each related site, with its file: `io.shade.ts: n: vec3;`. */
  readonly related: readonly string[];
}

const IO = '/p/io.shade.ts';
const A = '/p/a.shade.ts';
const B = '/p/b.shade.ts';
const C = '/p/c.shade.ts';
const short = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/** The compiler half: every diagnostic of the program that starts from `entry`. */
const compilerSays = (files: Files, entry: string): Said[] =>
  compile(files[entry]!, { fileName: entry, readDocument: (name) => files[name] })
    .diagnostics.filter((d) => d.code !== 'TS8015')
    .map((d) => ({
      code: String(d.code),
      message: d.message,
      file: short(d.fileName),
      at: files[d.fileName]!.slice(d.start, d.start + d.length),
      related: relatedSitesOf(d).map(
        (s) => `${short(s.fileName)}: ${files[s.fileName]!.slice(s.start, s.start + s.length)}`,
      ),
    }));

const offsetOf = (text: string, p: { line: number; character: number }): number =>
  text.split('\n').slice(0, p.line).join('\n').length + (p.line === 0 ? 0 : 1) + p.character;
const textAt = (
  text: string,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
): string => text.slice(offsetOf(text, range.start), offsetOf(text, range.end));

const opened = (files: Files): TypeshadeLanguageService => {
  const service = createTypeshadeLanguageService();
  for (const [name, text] of Object.entries(files)) service.openDocument(name, text);
  return service;
};
/** The editor half: the list of the document `uri`. */
const editorSays = (service: TypeshadeLanguageService, files: Files, uri: string): Said[] =>
  service.getDiagnostics(uri).map((d) => ({
    code: String(d.code),
    message: d.message,
    file: short(d.uri),
    at: textAt(files[d.uri]!, d.range),
    related: (d.relatedInformation ?? []).map(
      (r) => `${short(r.location.uri)}: ${textAt(files[r.location.uri]!, r.location.range)}`,
    ),
  }));

/** `tshc check` over the folder of `files`: the exit status and what it prints. */
const check = (files: Files): { status: number; text: string } => {
  const disk: Record<string, string> = { ...files };
  const out: string[] = [];
  const host: CliHost = {
    cwd: '/p',
    readFile: (path) => disk[path],
    writeFile: (path, text) => void (disk[path] = text),
    kind(path) {
      if (disk[path] !== undefined) return 'file';
      return Object.keys(disk).some((f) => f.startsWith(`${path}/`)) ? 'directory' : undefined;
    },
    list(path) {
      const names = new Set<string>();
      for (const f of Object.keys(disk))
        if (f.startsWith(`${path}/`)) names.add(f.slice(path.length + 1).split('/')[0]!);
      return [...names];
    },
    stdout: (text) => void out.push(text),
    stderr: (text) => void out.push(text),
  };
  const status = runCli(['check', '--format', 'short'], host, { version: '0.0.0' });
  return { status, text: out.join('') };
};

/** The line and character `at` begins at in `text`, one-based, as `tshc check` prints them. */
const lineAndCharacter = (text: string, at: number): string => {
  const before = text.slice(0, at).split('\n');
  return `${String(before.length)}:${String(before[before.length - 1]!.length + 1)}`;
};

/** Both halves say exactly `expected` for each file of `files`: `compile()` of the program
 *  that starts from it, and the document's list with every file open. A program's list holds
 *  what the program reports in any file; a document's list holds what is located in it.
 *  `tshc check` over the folder then prints each distinct diagnostic once, where it is, and
 *  exits 1 when there is one. */
const bothSay = (files: Files, expected: Readonly<Record<string, readonly Said[]>>): void => {
  const service = opened(files);
  const distinct = new Map<string, Said>();
  for (const name of Object.keys(files)) {
    const want = expected[name] ?? [];
    expect(compilerSays(files, name), `compile(${short(name)})`).toEqual(want);
    expect(editorSays(service, files, name), `getDiagnostics(${short(name)})`).toEqual(
      want.filter((d) => d.file === short(name)),
    );
    for (const d of want)
      distinct.set(`${d.file}\u0000${d.at}\u0000${d.code}\u0000${d.message}`, d);
  }
  const ran = check(files);
  expect(ran.status, ran.text).toBe(distinct.size > 0 ? 1 : 0);
  for (const d of distinct.values()) {
    const text = files[`/p/${d.file}`]!;
    const row = `${d.file}:${lineAndCharacter(text, text.indexOf(d.at))} - error ${d.code}: ${d.message}`;
    expect(ran.text.split(row), ran.text).toHaveLength(2);
  }
  expect(ran.text.match(/ - error /g) ?? []).toHaveLength(distinct.size);
};

const VS = `interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
`;
const FS_IN = `"use typeshade";
export interface FsIn {
  n: vec3;
  uv: vec2;
}
`;
/** A program whose vertex result names no `n`, so the fragment input `FsIn.n` has no location. */
const REFUSES = (fs: string): string => `"use typeshade";
import { FsIn } from "./io.shade.ts";
${VS}@fragment
export function ${fs}(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`;
/** A program whose vertex result names `n`, so the same field has a location. */
const ACCEPTS = `"use typeshade";
import { FsIn } from "./io.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
  n: vec3;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.), n: vec3(0., 0., 1.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`;
const NO_LOCATION: Said = {
  code: 'TS8010',
  message:
    '"FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.',
  file: 'b.shade.ts',
  at: 'v: FsIn',
  related: ['io.shade.ts: n: vec3;'],
};

describe('a program reports a refusal of an imported declaration at its own use (#1186)', () => {
  it('a field with no location: once, in the program that refuses it, at the parameter', () => {
    const files: Files = { [IO]: FS_IN, [A]: ACCEPTS, [B]: REFUSES('fs') };
    // The declaring file and the program that accepts the struct say nothing.
    bothSay(files, { [B]: [NO_LOCATION] });
  });

  it('two programs that refuse the field: each reports it once, in its own document', () => {
    const files: Files = { [IO]: FS_IN, [B]: REFUSES('fs'), [C]: REFUSES('fs2') };
    bothSay(files, { [B]: [NO_LOCATION], [C]: [{ ...NO_LOCATION, file: 'c.shade.ts' }] });
  });

  it('closing the importer removes it, and the declaring file shows nothing either way', () => {
    const files: Files = { [IO]: FS_IN, [B]: REFUSES('fs') };
    const service = opened(files);
    expect(editorSays(service, files, B)).toEqual([NO_LOCATION]);
    expect(editorSays(service, files, IO)).toEqual([]);
    service.closeDocument(B);
    expect(editorSays(service, files, IO)).toEqual([]);
    expect(service.getDiagnostics(B)).toEqual([]);
  });

  it('with the declaring file not open, the importer still reports it', () => {
    const files: Files = { [IO]: FS_IN, [B]: REFUSES('fs') };
    const service = createTypeshadeLanguageService({ readDocument: (name) => files[name] });
    service.openDocument(B, files[B]!);
    expect(editorSays(service, files, B)).toEqual([NO_LOCATION]);
  });

  it('a field two entries number differently: at the first use, with the field related', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface S {
  a: vec2;
}
`,
      [B]: `"use typeshade";
import { S } from "./io.shade.ts";
@vertex
export function v1(x: f32, first: S): builtin<"position"> {
  return vec4(first.a, x, 1.);
}
@vertex
export function v2(second: S): builtin<"position"> {
  return vec4(second.a, 0., 1.);
}
`,
    };
    bothSay(files, {
      [B]: [
        {
          code: 'TS8010',
          message:
            '"S.a" has no location and its uses give it 1 as an input of "v1" and 0 as an input of "v2": write location<n, T> on it.',
          file: 'b.shade.ts',
          at: 'first: S',
          related: ['io.shade.ts: a: vec2;'],
        },
      ],
    });
  });

  it('a field a vertex input numbers and a fragment input then numbers differently: at the first use', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface S {
  a: vec2;
}
`,
      [B]: `"use typeshade";
import { S } from "./io.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  k: f32;
  a: vec2;
}
@vertex
export function vs(first: S): VsOut {
  return { pos: vec4(first.a, 0., 1.), k: 1., a: first.a };
}
@fragment
export function fs(second: S): vec4 {
  return vec4(second.a, 0., 1.);
}
`,
    };
    bothSay(files, {
      [B]: [
        {
          code: 'TS8010',
          message:
            '"S.a" has no location and its uses give it 0 as an input of "vs" and 1 as an input of "fs": write location<n, T> on it.',
          file: 'b.shade.ts',
          at: 'first: S',
          related: ['io.shade.ts: a: vec2;'],
        },
      ],
    });
  });

  it('a bool field at a location (TS8003): at the parameter, with the field related', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface P {
  uv: vec2;
  on: bool;
}
`,
      [B]: `"use typeshade";
import { P } from "./io.shade.ts";
${VS}@fragment
export function fs(v: P): vec4 {
  return vec4(v.uv, v.on ? 1. : 0., 1.);
}
`,
    };
    const said = compilerSays(files, B);
    expect(said.map((d) => [d.code, d.file, d.at, d.related])).toEqual([
      ['TS8003', 'b.shade.ts', 'v: P', ['io.shade.ts: on: bool;']],
    ]);
    expect(said[0]!.message).toMatch(/^"P\.on" is at a location and is "bool"; /);
    bothSay(files, { [B]: said });
  });

  it('an f64 field at a location (TS8038): at the parameter, with the field related', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface P {
  uv: vec2;
  d: f64;
}
`,
      [B]: `"use typeshade";
import { P } from "./io.shade.ts";
${VS}@fragment
export function fs(v: P): vec4 {
  return vec4(v.uv, f32(v.d), 1.);
}
`,
    };
    const said = compilerSays(files, B);
    expect(said.map((d) => [d.code, d.file, d.at, d.related])).toEqual([
      ['TS8038', 'b.shade.ts', 'v: P', ['io.shade.ts: d: f64;']],
    ]);
    expect(said[0]!.message).toMatch(/^Struct "P" field "d", a fragment input, carries f64: /);
    bothSay(files, { [B]: said });
  });

  it('an entry the entry file re-exports: on the name the re-export brings', () => {
    // `frag.shade.ts` compiles on its own: its own vertex entry names `n`. The program of
    // `b.shade.ts` has another vertex entry, and the use is in `frag.shade.ts`, not in the
    // entry file, so the refusal stands on the re-export that brings `fs` into the program.
    const files: Files = {
      [IO]: FS_IN,
      '/p/frag.shade.ts': `"use typeshade";
import { FsIn } from "./io.shade.ts";
interface Wide {
  pos: builtin<"position">;
  n: vec3;
  uv: vec2;
}
@vertex
export function wide(i: builtin<"vertex_index">): Wide {
  return { pos: vec4(0., 0., 0., 1.), n: vec3(0.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`,
      [B]: `"use typeshade";
export { fs } from "./frag.shade.ts";
${VS}`,
    };
    bothSay(files, { [B]: [{ ...NO_LOCATION, at: 'fs' }] });
  });
});

const SAME = `"use typeshade";
export function same<T>(a: T, b: T): bool {
  return a === b;
}
export function both<T>(a: T, b: T): bool {
  return same(a, b);
}
export function twice<T>(a: T, b: T): bool {
  const first = a === b;
  return first && b === a;
}
`;
/** A fragment entry of `b.shade.ts` over a struct `P`, with `imports` and `body`. */
const USES = (imports: string, body: string, helpers = ''): string => `"use typeshade";
import { ${imports} } from "./io.shade.ts";
interface P {
  a: f32;
}
${helpers}${VS}@fragment
export function fs(v: VsOut): vec4 {
  const p: P = { a: v.uv.x };
${body}
}
`;
const NO_IDENTITY =
  'Cannot === P: a struct is a value with no identity here, and WGSL compares scalars and vectors only. Compare its fields one by one.';
const refused = (at: string, related: readonly string[]): Said => ({
  code: 'TS8003',
  message: NO_IDENTITY,
  file: 'b.shade.ts',
  at,
  related,
});

describe('a refusal in the body of an imported generic declaration stands at the use (#1186)', () => {
  it('a call that instantiates an imported generic function: at the call, once', () => {
    // The instance of `same` at `P` is made once, by the first call that asks for it, so the
    // program reports it once (Rule 12.4): the second call reaches the same instance.
    const files: Files = {
      [IO]: SAME,
      [B]: USES(
        'same',
        '  const x = same(v.uv.x, v.uv.y);\n  const y = same(p, p);\n  const z = same(p, p);\n' +
          '  return vec4(x ? 1. : 0., y ? 1. : 0., z ? 1. : 0., 1.);',
      ),
    };
    bothSay(files, { [B]: [refused('same(p, p)', ['io.shade.ts: a === b'])] });
  });

  it('reached through another imported generic function: at the call the entry file writes', () => {
    const files: Files = {
      [IO]: SAME,
      [B]: USES('both', '  return vec4(both(p, p) ? 1. : 0., 0., v.uv);'),
    };
    bothSay(files, { [B]: [refused('both(p, p)', ['io.shade.ts: a === b'])] });
  });

  it('reached through a generic function of the entry file: at the outermost call', () => {
    // Two uses are in the entry file: `same(a, a)` in `mine`, and `mine(p)`, which makes that
    // instance of `mine`. The outermost one is where the author chose the type.
    const files: Files = {
      [IO]: SAME,
      [B]: USES(
        'same',
        '  return vec4(mine(p) ? 1. : 0., 0., v.uv);',
        'function mine<T>(a: T): bool {\n  return same(a, a);\n}\n',
      ),
    };
    bothSay(files, { [B]: [refused('mine(p)', ['io.shade.ts: a === b'])] });
  });

  it('two refusals of one instance with one sentence: one diagnostic, with both sites', () => {
    const files: Files = {
      [IO]: SAME,
      [B]: USES('twice', '  return vec4(twice(p, p) ? 1. : 0., 0., v.uv);'),
    };
    bothSay(files, {
      [B]: [refused('twice(p, p)', ['io.shade.ts: a === b', 'io.shade.ts: b === a'])],
    });
  });

  it('an imported function that takes a function: at the call that hands it one', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface Q {
  a: f32;
}
export function fixed(f: (q: Q) => Q, q: Q): bool {
  return f(q) === q;
}
`,
      [B]: `"use typeshade";
import { fixed, Q } from "./io.shade.ts";
function keep(q: Q): Q {
  return q;
}
${VS}@fragment
export function fs(v: VsOut): vec4 {
  const q: Q = { a: v.uv.x };
  return vec4(fixed(keep, q) ? 1. : 0., 0., v.uv);
}
`,
    };
    bothSay(files, {
      [B]: [
        {
          code: 'TS8003',
          message: NO_IDENTITY.replace('=== P', '=== Q'),
          file: 'b.shade.ts',
          at: 'fixed(keep, q)',
          related: ['io.shade.ts: f(q) === q'],
        },
      ],
    });
  });

  it('a method of an imported generic class: where the entry file first writes the instance', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export class Box<T> {
  x: T;
  same(o: T): bool {
    return this.x === o;
  }
}
`,
      [B]: USES(
        'Box',
        '  const first: Box<P> = { x: p };\n  const second: Box<P> = { x: p };\n' +
          '  return vec4(first.same(p) ? 1. : 0., second.same(p) ? 1. : 0., v.uv);',
      ),
    };
    const said = refused('Box<P>', ['io.shade.ts: this.x === o']);
    bothSay(files, { [B]: [said] });
    // The first `Box<P>` of the two, on the line of `first`.
    const at = compile(files[B]!, { fileName: B, readDocument: (name) => files[name] })
      .diagnostics[0]!;
    expect(files[B]!.slice(at.start - 'const first: '.length, at.start)).toBe('const first: ');
  });

  it('an imported generic interface (TS8010): at the type that reaches it', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface Pair<T> {
  a: T;
  uv: vec2;
}
`,
      [B]: `"use typeshade";
import { Pair } from "./io.shade.ts";
${VS}@fragment
export function fs(v: Pair<vec3>): vec4 {
  return vec4(v.a, v.uv.x);
}
`,
    };
    bothSay(files, {
      [B]: [
        {
          code: 'TS8010',
          message:
            '"Pair" is a generic interface; a generic struct is written as a class, class Pair<T> { a: T; uv: vec2 } (surface §32).',
          file: 'b.shade.ts',
          at: 'Pair<vec3>',
          related: ['io.shade.ts: Pair'],
        },
      ],
    });
  });
});

describe('what does not move (#1186)', () => {
  it('a program of one file keeps the diagnostic on the field, with no related site', () => {
    const files: Files = {
      [B]: `"use typeshade";
interface FsIn {
  n: vec3;
  uv: vec2;
}
${VS}@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`,
    };
    bothSay(files, { [B]: [{ ...NO_LOCATION, at: 'n: vec3;', related: [] }] });
  });

  it('a generic function of the entry file keeps the diagnostic in its body', () => {
    const files: Files = {
      [B]: `"use typeshade";
function twice<T>(x: T): T {
  return x + x;
}
${VS}@fragment
export function fs(v: VsOut): vec4 {
  return vec4(twice(true) ? 1. : 0., v.uv, 1.);
}
`,
    };
    expect(compilerSays(files, B).map((d) => [d.code, d.file, d.at, d.related])).toEqual([
      ['TS8003', 'b.shade.ts', 'x + x', []],
    ]);
  });

  it('a mistake of the imported file itself stays in that file, in both halves', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface S {
  a: f32;
  b: Foo;
}
`,
      [B]: `"use typeshade";
import { S } from "./io.shade.ts";
${VS}declare const u: uniform<S>;
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(u.a, v.uv, 1.);
}
`,
    };
    const unknown: Said = {
      code: 'TS8002',
      message:
        'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
      file: 'io.shade.ts',
      at: 'Foo',
      related: [],
    };
    // Both programs report it, in the declaring file, and only that document shows it.
    bothSay(files, { [IO]: [unknown], [B]: [unknown] });
  });

  it('a mistake in the body of an imported generic function stays in that file, once', () => {
    // The declaring file's own program reports the unknown name, so the program that
    // instantiates the function adds no second diagnostic at its call (Rule 12.4).
    const files: Files = {
      [IO]: `"use typeshade";
export function id<T>(x: T): T {
  let y: f32 = nope;
  return x;
}
`,
      [B]: `"use typeshade";
import { id } from "./io.shade.ts";
${VS}@fragment
export function fs(v: VsOut): vec4 {
  return vec4(id(1.), 0., v.uv);
}
`,
    };
    const unknown: Said = {
      code: 'TS8022',
      message: 'Unknown identifier "nope".',
      file: 'io.shade.ts',
      at: 'nope',
      related: [],
    };
    bothSay(files, { [IO]: [unknown], [B]: [unknown] });
  });

  it('the diagnostics of the entry file are in document order after a refusal moved', () => {
    const files: Files = {
      [IO]: SAME,
      [B]: USES(
        'same',
        '  const k: i32 = 1.5;\n  const y = same(p, p);\n  const m: i32 = 2.5;\n' +
          '  return vec4(y ? 1. : 0., f32(k + m), v.uv);',
      ),
    };
    const at = compilerSays(files, B).map((d) => d.at);
    expect(at).toEqual(['k: i32 = 1.5', 'same(p, p)', 'm: i32 = 2.5']);
    expect(editorSays(opened(files), files, B).map((d) => d.at)).toEqual(at);
  });

  it('an imported builtin<N> the compiler refused: the importer adds nothing about its value', () => {
    // The ambient type of the refused field is `never`, and TypeScript reported the write of it
    // in the importing document (`Type 'number[]' is not assignable to type 'never'`).
    const files: Files = {
      [IO]: `"use typeshade";
export interface VsOut {
  pos: builtin<"position">;
  cd: builtin<"clip_distances">;
}
`,
      [B]: `"use typeshade";
import { VsOut } from "./io.shade.ts";
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  let out: VsOut = { pos: vec4(f32(i), 0., 0., 1.), cd: [0.] };
  out.cd[0] = 1.;
  return out;
}
`,
    };
    const refused: Said = {
      code: 'TS8003',
      message:
        'Builtin "clip_distances" has no single type: write builtin<"clip_distances", array<f32, N>> with N from 1 to 8.',
      file: 'io.shade.ts',
      at: 'builtin<"clip_distances">',
      related: [],
    };
    bothSay(files, { [IO]: [refused], [B]: [refused] });
  });
});

describe("TypeScript's never error stays where the compiler refused nothing (#1186)", () => {
  /** The TypeScript errors of the importing document. */
  const typescriptSays = (files: Files): string[] =>
    opened(files)
      .getDiagnostics(B)
      .filter((d) => d.source === 'typescript')
      .map((d) => `${String(d.code)} ${d.message}`);

  it('a read of another builtin<N> field of the struct that holds the refused one', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface O {
  pos: builtin<"position">;
  cd: builtin<"clip_distances">;
}
`,
      [B]: `"use typeshade";
import { O } from "./io.shade.ts";
@vertex
export function vs(i: builtin<"vertex_index">): O {
  let o: O = { pos: vec4(f32(i), 0., 0., 1.), cd: [0.] };
  let n: never = o.pos;
  return o;
}
`,
    };
    // The write of `cd` in the literal is dropped; the one about `pos` is no repeat of the
    // refusal of `cd`.
    expect(typescriptSays(files)).toEqual(["2322 Type 'vec4' is not assignable to type 'never'."]);
  });

  it('a builtin<N> field with a refusal of another kind', () => {
    // `TS8028` on the option: the field has its type, and nothing about its value is a repeat.
    const files: Files = {
      [IO]: `"use typeshade";
export interface O {
  m: builtin<"sample_mask", { interpolate: "wrong" }>;
  uv: vec2;
}
export function f(o: O): f32 {
  return 1.;
}
`,
      [B]: `"use typeshade";
import { O } from "./io.shade.ts";
${VS}@fragment
export function fs(o: O): vec4 {
  let n: never = o.m;
  return vec4(o.uv, 0., 1.);
}
`,
    };
    expect(compilerSays(files, IO).map((d) => d.code)).toEqual(['TS8028']);
    const kept = typescriptSays(files);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^2322 Type .* is not assignable to type 'never'\.$/);
  });
});

describe('an exported struct is checked in the file that declares it (#1186)', () => {
  // The owner's decision of 2026-11-10: what the entry-IO attributes of a struct say of the
  // struct alone is the declaring file's mistake, though nothing in that file uses the struct.
  // The importing program reports the same diagnostic in the declaring file, and adds none.
  const USER = `"use typeshade";
import { S } from "./io.shade.ts";
${VS}@fragment
export function fs(v: S): vec4 {
  return vec4(0., 0., 0., 1.);
}
`;
  const CASES: readonly (readonly [string, string, Omit<Said, 'file' | 'related'>])[] = [
    [
      'two fields at one location',
      'a: location<3, vec2>;\n  b: location<3, vec2>;',
      {
        code: 'TS8010',
        message: 'Struct "S" puts "a" and "b" both at location<3, …>; each slot carries one value.',
        at: 'S',
      },
    ],
    [
      'one blend_src of a pair',
      'a: location<3, vec4, { blend_src: 0 }>;',
      {
        code: 'TS8010',
        message:
          'Struct "S" declares { blend_src: 0 } and not { blend_src: 1 }; a dual-source blend mixes two colours, so both sit at the same location<…>.',
        at: 'S',
      },
    ],
    [
      'interpolate on a builtin<N>',
      'pos: builtin<"position", { interpolate: "flat" }>;',
      {
        code: 'TS8010',
        message:
          'The interpolate option belongs on a location<…> field: it says how a VARYING is interpolated, and a builtin<…> carries its own rule.',
        at: 'pos: builtin<"position", { interpolate: "flat" }>;',
      },
    ],
    [
      'invariant off position',
      'ff: builtin<"front_facing", { invariant: true }>;',
      {
        code: 'TS8010',
        message:
          'The invariant option belongs on builtin<"position">: it is WGSL\'s promise that this position is computed the same way in two pipelines, and no other output has that meaning.',
        at: 'ff: builtin<"front_facing", { invariant: true }>;',
      },
    ],
  ];
  for (const [name, fields, said] of CASES) {
    it(`${name}: in the declaring file, once, and the importing program adds none`, () => {
      const io = `"use typeshade";\nexport interface S {\n  ${fields}\n}\n`;
      const own: Said = { ...said, file: 'io.shade.ts', related: [] };
      // The declaring file alone.
      bothSay({ [IO]: io }, { [IO]: [own] });
      // The program that uses the struct reports the same one, and only the declaring
      // document shows it.
      const files: Files = { [IO]: io, [B]: USER };
      expect(compilerSays(files, B).filter((d) => d.message === said.message)).toEqual([own]);
      const service = opened(files);
      expect(editorSays(service, files, IO)).toEqual([own]);
      expect(editorSays(service, files, B).filter((d) => d.message === said.message)).toEqual([]);
      expect(check(files).text.split(said.message)).toHaveLength(2);
      expect(check(files).status).toBe(1);
    });
  }

  it('a written location on a bool (TS8003): in the declaring file, once', () => {
    const io = `"use typeshade";\nexport interface S {\n  on: location<3, bool>;\n}\n`;
    const said = compilerSays({ [IO]: io }, IO);
    expect(said.map((d) => [d.code, d.file, d.at])).toEqual([['TS8003', 'io.shade.ts', 'S']]);
    expect(said[0]!.message).toMatch(/^"S\.on" is at a location and is "bool"; /);
    bothSay({ [IO]: io }, { [IO]: said });
    const files: Files = { [IO]: io, [B]: USER };
    expect(compilerSays(files, B).filter((d) => d.code === 'TS8003')).toEqual(said);
    expect(editorSays(opened(files), files, B).filter((d) => d.code === 'TS8003')).toEqual([]);
  });

  it('the valid neighbour, and a struct the file does not export, say nothing', () => {
    bothSay(
      {
        [IO]: `"use typeshade";\nexport interface S {\n  a: location<3, vec2>;\n  b: location<4, vec2>;\n}\n`,
      },
      {},
    );
    // Unchanged: a struct that is neither exported nor used is not read.
    bothSay(
      {
        [IO]: `"use typeshade";\ninterface S {\n  a: location<3, vec2>;\n  b: location<3, vec2>;\n}\n`,
      },
      {},
    );
    // A host-shaped declaration is no struct, exported or not.
    expect(
      compilerSays(
        { [IO]: `"use typeshade";\nexport interface Config {\n  seed: number;\n}\n` },
        IO,
      ),
    ).toEqual([]);
  });
});

describe('tshc check reports what the documents report (#1186)', () => {
  it('the folder of a program that refuses an imported field: one error, a non-zero exit', () => {
    const ran = check({ [IO]: FS_IN, [A]: ACCEPTS, [B]: REFUSES('fs') });
    expect(ran.status).toBe(1);
    expect(ran.text).toContain(`b.shade.ts:12:20 - error TS8010: ${NO_LOCATION.message}`);
    expect(ran.text.match(/TS8010/g)).toHaveLength(1);
    expect(ran.text).toContain('Found 1 error in 1 file (3 files checked).');
  });

  it('the same folder without the program that refuses: no problem, a zero exit', () => {
    // The instrument: the exit follows the refusal, not the folder.
    const ran = check({ [IO]: FS_IN, [A]: ACCEPTS });
    expect(ran.status).toBe(0);
    expect(ran.text).not.toContain('TS8010');
  });
});
