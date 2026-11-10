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

/** Both halves say exactly `expected` for each file of `files`: `compile()` of the program
 *  that starts from it, and the document's list with every file open. A program's list holds
 *  what the program reports in any file; a document's list holds what is located in it. */
const bothSay = (files: Files, expected: Readonly<Record<string, readonly Said[]>>): void => {
  const service = opened(files);
  for (const name of Object.keys(files)) {
    const want = expected[name] ?? [];
    expect(compilerSays(files, name), `compile(${short(name)})`).toEqual(want);
    expect(editorSays(service, files, name), `getDiagnostics(${short(name)})`).toEqual(
      want.filter((d) => d.file === short(name)),
    );
  }
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
export function v1(x: f32, s: S): builtin<"position"> {
  return vec4(s.a, x, 1.);
}
@vertex
export function v2(s: S): builtin<"position"> {
  return vec4(s.a, 0., 1.);
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
          at: 's: S',
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

  it('a call that instantiates an imported generic function: at the call', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export function twice<T>(x: T): T {
  return x + x;
}
export function quad<T>(x: T): T {
  return twice(twice(x));
}
`,
      [B]: `"use typeshade";
import { quad, twice } from "./io.shade.ts";
${VS}@fragment
export function fs(v: VsOut): vec4 {
  const a = twice(v.uv.x);
  const b = twice(true);
  const c = quad(false);
  return vec4(a, b ? 1. : 0., c ? 1. : 0., 1.);
}
`,
    };
    const message =
      'Cannot + bool: WGSL has no arithmetic on a bool. Convert it to a number first, e.g. u32(a).';
    // The compiler half. The instance `twice` at `bool` is made once, by the first call that
    // asks for it, so the program reports it once (Rule 12.4): `quad(false)` reaches the same
    // instance.
    expect(compilerSays(files, B)).toEqual([
      {
        code: 'TS8003',
        message,
        file: 'b.shade.ts',
        at: 'twice(true)',
        related: ['io.shade.ts: x + x'],
      },
    ]);
    expect(compilerSays(files, IO)).toEqual([]);
    // The editor half shows the compiler's diagnostic in the importing document, at the call.
    const service = opened(files);
    expect(editorSays(service, files, B).filter((d) => d.code === 'TS8003')).toEqual(
      compilerSays(files, B),
    );
  });

  it('an imported generic function reached through another one: at the call the entry writes', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export function twice<T>(x: T): T {
  return x + x;
}
export function quad<T>(x: T): T {
  return twice(twice(x));
}
`,
      [B]: `"use typeshade";
import { quad } from "./io.shade.ts";
${VS}@fragment
export function fs(v: VsOut): vec4 {
  return vec4(quad(true) ? 1. : 0., v.uv, 1.);
}
`,
    };
    expect(compilerSays(files, B).map((d) => [d.code, d.file, d.at, d.related])).toEqual([
      ['TS8003', 'b.shade.ts', 'quad(true)', ['io.shade.ts: x + x']],
    ]);
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

describe('tshc check reports what the documents report (#1186)', () => {
  /** A host over `files` (absolute path → text). */
  const check = (files: Record<string, string>) => {
    const out: string[] = [];
    const host: CliHost = {
      cwd: '/p',
      readFile: (path) => files[path],
      writeFile: (path, text) => void (files[path] = text),
      kind(path) {
        if (files[path] !== undefined) return 'file';
        return Object.keys(files).some((f) => f.startsWith(`${path}/`)) ? 'directory' : undefined;
      },
      list(path) {
        const names = new Set<string>();
        for (const f of Object.keys(files))
          if (f.startsWith(`${path}/`)) names.add(f.slice(path.length + 1).split('/')[0]!);
        return [...names];
      },
      stdout: (text) => void out.push(text),
      stderr: (text) => void out.push(text),
    };
    const status = runCli(['check', '--format', 'short'], host, { version: '0.0.0' });
    return { status, text: out.join('') };
  };

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
