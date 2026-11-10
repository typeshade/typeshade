// The hover on a field of a struct that another document declares shows the location the
// compiler gave it in the linked program (change 0135, amendment A1, deviation A of pull request
// #1169). A program is a file and the shader files it imports (Rule 3.9), so the number is the
// one `compile()` and `reflect()` give for the document the program starts from.
//
// Each case is read by both halves on the same files (Rule 12.7): `compile()` of the linked
// program for the diagnostics, the emitted `@location(n)` and `reflect()`, and the language
// service for the hover. Every hover's number is held to `reflect()`'s.
//
// Verifies: Rule 6.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import type ts from 'typescript';
import { compile } from '../compiler/ts/compile.js';
import { reflect } from '../core/reflect.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
  type TypeshadeLanguageService,
} from './service.js';

/** The files of one project, by the name each is opened and imported under. */
type Files = Readonly<Record<string, string>>;

/** The compiler half: the program that starts from `entry`, linked with what it imports. */
const compiled = (files: Files, entry: string) =>
  compile(files[entry]!, { fileName: entry, readDocument: (name) => files[name] });
const messagesOf = (files: Files, entry: string): string[] =>
  compiled(files, entry).diagnostics.map((d) => `${String(d.code)} ${d.message}`);

/** The code of the one diagnostic that `compile()` of the program that starts from `entry`
 *  reports on the field declared at the first `needle` of `file`. The hover's line for a
 *  refused field is held to this code. */
const refusalCodeOf = (files: Files, entry: string, file: string, needle: string): string => {
  const at = files[file]!.indexOf(needle);
  const on = compiled(files, entry).diagnostics.filter(
    (d) => d.fileName === file && d.start <= at && at < d.start + d.length,
  );
  expect(
    on.map((d) => d.category),
    `diagnostics of ${entry} on "${needle}"`,
  ).toEqual(['error']);
  return String(on[0]!.code);
};

/** `reflect()`'s location of the input or output `name` of the entry `fn` of the program that
 *  starts from `entry`: `undefined` for a built-in value and for a value with no location. */
const reflected = (
  files: Files,
  entry: string,
  fn: string,
  side: 'inputs' | 'outputs',
  name: string,
): number | undefined => {
  const info = reflect(compiled(files, entry).module).entries.find((e) => e.name === fn);
  expect(info, `entry "${fn}" of ${entry}`).toBeDefined();
  const field = info!.io[side].find((f) => f.name === name);
  expect(field, `${side} "${name}" of "${fn}"`).toBeDefined();
  return field!.location;
};

/** The editor half: a service with every file of `files` open. */
const opened = (
  files: Files,
  service: TypeshadeLanguageService = createTypeshadeLanguageService(),
) => {
  for (const [name, text] of Object.entries(files)) service.openDocument(name, text);
  return service;
};
/** The hover of `service` at the first `needle` of `text`, `skip` characters into it. */
const hoverAt = (
  service: TypeshadeLanguageService,
  name: string,
  text: string,
  needle: string,
  skip = 0,
): string => {
  const at = text.indexOf(needle);
  expect(at, `"${needle}" is in ${name}`).toBeGreaterThanOrEqual(0);
  return service.getHover(name, service.positionAt(name, at + skip))?.contents ?? '';
};
/** The hover in the file `name` of `files`, with every file open. */
const hover = (files: Files, name: string, needle: string, skip = 0): string =>
  hoverAt(opened(files), name, files[name]!, needle, skip);

/** A hover that is the signature alone: no line about a location. */
const bare = (signature: string): string => `\`\`\`ts\n${signature}\n\`\`\``;
/** A hover that is the signature and the line under it. */
const withLine = (signature: string, line: string): string => `${bare(signature)}\n\n${line}`;
/** A hover that is the signature and one line for each program, each a paragraph of its own. */
const lines = (signature: string, ...each: string[]): string =>
  [bare(signature), ...each].join('\n\n');

const IO = '/p/io.shade.ts';
const MAIN = '/p/main.shade.ts';

// The example of the proposal, with its structs in a file of their own.
const SHARED: Files = {
  [IO]: `"use typeshade";
export interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
export interface Color {
  color: vec4;
}
`,
  [MAIN]: `"use typeshade";
import { VsOut, Color } from "./io.shade.ts";
function shade(w: VsOut): f32 {
  return w.uv.x;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  const x = f32(i32(i) / 2) * 4. - 1.;
  const y = f32(i32(i) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}
@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, shade(v), 0.2, 1.) };
}
`,
};

describe('the hover shows the location of a field another document declares (change 0135)', () => {
  it('an imported struct: every use in the importing file shows the program’s number', () => {
    expect(messagesOf(SHARED, MAIN)).toEqual([]);
    expect(compiled(SHARED, MAIN).wgsl).toContain('  @location(0) uv: vec2<f32>,');
    expect(reflected(SHARED, MAIN, 'vs', 'outputs', 'uv')).toBe(0);
    expect(reflected(SHARED, MAIN, 'fs', 'inputs', 'uv')).toBe(0);
    // The signature is the compiler's, as in a file that declares the struct itself.
    const uv = withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)');
    // `uv` of `v.uv`, in the fragment entry.
    expect(hover(SHARED, MAIN, 'v.uv', 2)).toBe(uv);
    // `uv` of `w.uv`, in a helper, and the field the vertex entry's result writes.
    expect(hover(SHARED, MAIN, 'w.uv', 2)).toBe(uv);
    expect(hover(SHARED, MAIN, 'uv: vec2(x')).toBe(uv);
    // A render target.
    expect(reflected(SHARED, MAIN, 'fs', 'outputs', 'color')).toBe(0);
    expect(hover(SHARED, MAIN, 'color: vec4(')).toBe(
      withLine('(property) Color.color: vec4<f32>', 'render target at @location(0)'),
    );
    // A built-in value has no location, in `reflect()` and in the hover.
    expect(reflected(SHARED, MAIN, 'vs', 'outputs', 'pos')).toBeUndefined();
    expect(hover(SHARED, MAIN, 'pos: vec4(')).toBe(bare('(property) VsOut.pos: vec4<f32>'));
  });

  it('the declaring file shows the number of the program that imports it', () => {
    // `io.shade.ts` has no entry, so its own program numbers nothing.
    expect(messagesOf(SHARED, IO)).toEqual([]);
    expect(reflect(compiled(SHARED, IO).module).entries).toEqual([]);
    // The one open program that links it is `main.shade.ts`, and the hover shows its numbers.
    expect(reflected(SHARED, MAIN, 'vs', 'outputs', 'uv')).toBe(0);
    expect(hover(SHARED, IO, 'uv:')).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
    expect(reflected(SHARED, MAIN, 'fs', 'outputs', 'color')).toBe(0);
    expect(hover(SHARED, IO, 'color:')).toBe(
      withLine('(property) Color.color: vec4<f32>', 'render target at @location(0)'),
    );
    expect(hover(SHARED, IO, 'pos:')).toBe(bare('(property) VsOut.pos: vec4<f32>'));
    // With no open document that imports it, the declaring file has nothing to show: no
    // program lowered the struct, so the signature is TypeScript's quick info.
    const alone = createTypeshadeLanguageService();
    alone.openDocument(IO, SHARED[IO]!);
    expect(hoverAt(alone, IO, SHARED[IO]!, 'uv:')).toBe(bare('(property) VsOut.uv: vec2'));
  });

  it('an imported file that is not open is read through the host', () => {
    const service = createTypeshadeLanguageService({ readDocument: (uri) => SHARED[uri] });
    service.openDocument(MAIN, SHARED[MAIN]!);
    expect(hoverAt(service, MAIN, SHARED[MAIN]!, 'v.uv', 2)).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
  });

  it('a renamed import, beside a struct of the same name: the declaration decides, not the name', () => {
    // Both files declare a `VsOut` with a field `uv`, at two locations. The importing file
    // calls the imported one `V`, and the module emits it as `io_VsOut`.
    const files: Files = {
      [IO]: `"use typeshade";
export interface VsOut {
  pos: builtin<"position">;
  tint: vec3;
  uv: vec2;
}
`,
      [MAIN]: `"use typeshade";
import { VsOut as V } from "./io.shade.ts";
interface VsOut {
  uv: vec4;
}
@vertex
export function vs(i: builtin<"vertex_index">): V {
  return { pos: vec4(f32(i), 0., 0., 1.), tint: vec3(1., 0., 0.), uv: vec2(0., 0.) };
}
@fragment
export function fs(v: V): VsOut {
  return { uv: vec4(v.uv, v.tint.x, 1.) };
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct io_VsOut {');
    expect(wgsl).toContain('  @location(1) uv: vec2<f32>,');
    expect(wgsl).toContain('  @location(0) uv: vec4<f32>,');
    // The imported `VsOut.uv`, a value between stages at 1.
    expect(reflected(files, MAIN, 'vs', 'outputs', 'uv')).toBe(1);
    expect(reflected(files, MAIN, 'fs', 'inputs', 'uv')).toBe(1);
    // The importing file calls the struct `V`, and its hover shows that name. The declaring
    // file shows the name it declares.
    const line = 'value between stages at @location(1)';
    const imported = withLine('(property) V.uv: vec2<f32>', line);
    expect(hover(files, MAIN, 'v.uv', 2)).toBe(imported);
    expect(hover(files, MAIN, 'uv: vec2(0')).toBe(imported);
    expect(hover(files, IO, 'uv:')).toBe(withLine('(property) VsOut.uv: vec2<f32>', line));
    // The importing file's own `VsOut.uv`, a render target at 0.
    expect(reflected(files, MAIN, 'fs', 'outputs', 'uv')).toBe(0);
    const own = withLine('(property) VsOut.uv: vec4<f32>', 'render target at @location(0)');
    expect(hover(files, MAIN, 'uv: vec4;')).toBe(own);
    expect(hover(files, MAIN, 'uv: vec4(v')).toBe(own);
  });

  it('a re-export, under another name: the hover follows it to the declaration', () => {
    const files: Files = {
      [IO]: SHARED[IO]!,
      '/p/mid.shade.ts': `"use typeshade";
export { VsOut as Varyings, Color } from "./io.shade.ts";
`,
      [MAIN]: `"use typeshade";
import { Varyings, Color } from "./mid.shade.ts";
@vertex
export function vs(i: builtin<"vertex_index">): Varyings {
  return { pos: vec4(f32(i), 0., 0., 1.), uv: vec2(0., 0.) };
}
@fragment
export function fs(v: Varyings): Color {
  return { color: vec4(v.uv, 0., 1.) };
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([]);
    expect(reflected(files, MAIN, 'fs', 'inputs', 'uv')).toBe(0);
    const uv = withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)');
    expect(hover(files, MAIN, 'v.uv', 2)).toBe(uv);
    // The declaring file is linked by the program through the file that re-exports it.
    expect(hover(files, IO, 'uv:')).toBe(uv);
  });

  it('a struct in a namespace of the imported file', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export namespace Stage {
  export class VsOut {
    pos: builtin<"position">;
    uv: location<2, vec2>;
    tint: vec3;
  }
}
`,
      [MAIN]: `"use typeshade";
import { Stage } from "./io.shade.ts";
@vertex
export function vs(i: builtin<"vertex_index">): Stage.VsOut {
  return { pos: vec4(f32(i), 0., 0., 1.), uv: vec2(0., 0.), tint: vec3(1., 0., 0.) };
}
@fragment
export function fs(v: Stage.VsOut): vec4 {
  return vec4(v.uv, v.tint.x, 1.);
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([]);
    // The written location, and the one the compiler gave the field beside it.
    expect(reflected(files, MAIN, 'fs', 'inputs', 'uv')).toBe(2);
    expect(reflected(files, MAIN, 'fs', 'inputs', 'tint')).toBe(0);
    const uv = withLine(
      '(property) Stage_VsOut.uv: vec2<f32>',
      'value between stages at @location(2)',
    );
    const tint = withLine(
      '(property) Stage_VsOut.tint: vec3<f32>',
      'value between stages at @location(0)',
    );
    expect(hover(files, MAIN, 'v.uv', 2)).toBe(uv);
    expect(hover(files, MAIN, 'v.tint', 2)).toBe(tint);
    // The declaring file's own analysis records a class, so the signature there is the
    // compiler's, under the name the front end gives a class in a namespace. The importing
    // file reads the same text. The line is the importing program's.
    expect(hover(files, IO, 'uv:')).toBe(
      withLine('(property) Stage_VsOut.uv: vec2<f32>', 'value between stages at @location(2)'),
    );
    expect(hover(files, IO, 'tint:')).toBe(
      withLine('(property) Stage_VsOut.tint: vec3<f32>', 'value between stages at @location(0)'),
    );
  });

  it('a struct read through a namespace import, `io.VsOut`', () => {
    const files: Files = {
      [IO]: SHARED[IO]!,
      [MAIN]: `"use typeshade";
import * as io from "./io.shade.ts";
@vertex
export function vs(i: builtin<"vertex_index">): io.VsOut {
  return { pos: vec4(f32(i), 0., 0., 1.), uv: vec2(0., 0.) };
}
@fragment
export function fs(v: io.VsOut): vec4 {
  return vec4(v.uv, 0., 1.);
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([]);
    expect(reflected(files, MAIN, 'fs', 'inputs', 'uv')).toBe(0);
    const uv = withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)');
    expect(hover(files, MAIN, 'v.uv', 2)).toBe(uv);
    expect(hover(files, IO, 'uv:')).toBe(uv);
  });

  it('two programs that number one struct differently: the declaring file names each number with its file', () => {
    // A vertex attribute is numbered in the scope of its entry (Rule 6.8), and each file a
    // compile starts from is a program of its own (Rule 3.9).
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const files: Files = {
      [IO]: `"use typeshade";
export interface VsIn {
  position: vec3;
  uv: vec2;
}
`,
      [A]: `"use typeshade";
import { VsIn } from "./io.shade.ts";
@vertex
export function vs(v: VsIn): vec4 {
  return vec4(v.position, v.uv.x);
}
`,
      [B]: `"use typeshade";
import { VsIn } from "./io.shade.ts";
@vertex
export function vs(weight: f32, v: VsIn): vec4 {
  return vec4(v.position, v.uv.x * weight);
}
`,
    };
    expect(messagesOf(files, A)).toEqual([]);
    expect(messagesOf(files, B)).toEqual([]);
    expect(reflected(files, A, 'vs', 'inputs', 'uv')).toBe(1);
    expect(reflected(files, B, 'vs', 'inputs', 'uv')).toBe(2);
    expect(hover(files, A, 'v.uv', 2)).toBe(
      withLine('(property) VsIn.uv: vec2<f32>', 'vertex attribute at @location(1)'),
    );
    expect(hover(files, B, 'v.uv', 2)).toBe(
      withLine('(property) VsIn.uv: vec2<f32>', 'vertex attribute at @location(2)'),
    );
    // The declaring file belongs to both programs, and no one number is true of the field
    // there. The hover names each program's number with the file the program starts from, in
    // the order of the uris (the owner's decision of 2026-11-10).
    expect(hover(files, IO, 'uv:')).toBe(
      lines(
        '(property) VsIn.uv: vec2<f32>',
        'vertex attribute at @location(1) in a.shade.ts',
        'vertex attribute at @location(2) in b.shade.ts',
      ),
    );
    expect(reflected(files, A, 'vs', 'inputs', 'position')).toBe(0);
    expect(reflected(files, B, 'vs', 'inputs', 'position')).toBe(1);
    expect(hover(files, IO, 'position:')).toBe(
      lines(
        '(property) VsIn.position: vec3<f32>',
        'vertex attribute at @location(0) in a.shade.ts',
        'vertex attribute at @location(1) in b.shade.ts',
      ),
    );
    // The order is the uris', not the order the documents were opened in.
    const reversed = createTypeshadeLanguageService();
    for (const name of [B, A, IO]) reversed.openDocument(name, files[name]!);
    expect(hoverAt(reversed, IO, files[IO]!, 'uv:')).toBe(hover(files, IO, 'uv:'));
    // With one of the two programs closed, the other's number is the one number, and the line
    // names no file.
    const service = opened(files);
    service.closeDocument(B);
    expect(hoverAt(service, IO, files[IO]!, 'uv:')).toBe(
      withLine('(property) VsIn.uv: vec2<f32>', 'vertex attribute at @location(1)'),
    );
    // Opened again, the program has its line again.
    service.openDocument(B, files[B]!);
    expect(hoverAt(service, IO, files[IO]!, 'uv:')).toBe(hover(files, IO, 'uv:'));
  });

  it('three programs, two numbers: one line for each program, with its file', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const C = '/p/c.shade.ts';
    const entry = (params: string) => `"use typeshade";
import { VsIn } from "./io.shade.ts";
@vertex
export function vs(${params}): vec4 {
  return vec4(v.position, v.uv.x);
}
`;
    const files: Files = {
      [IO]: `"use typeshade";
export interface VsIn {
  position: vec3;
  uv: vec2;
}
`,
      [A]: entry('v: VsIn'),
      [B]: entry('weight: f32, v: VsIn'),
      [C]: entry('v: VsIn, weight: f32'),
    };
    for (const name of [A, B, C]) expect(messagesOf(files, name)).toEqual([]);
    expect(reflected(files, A, 'vs', 'inputs', 'uv')).toBe(1);
    expect(reflected(files, B, 'vs', 'inputs', 'uv')).toBe(2);
    expect(reflected(files, C, 'vs', 'inputs', 'uv')).toBe(1);
    // Each entry file shows its own program's number, and no file.
    for (const [name, n] of [
      [A, 1],
      [B, 2],
      [C, 1],
    ] as const)
      expect(hover(files, name, 'v.uv', 2)).toBe(
        withLine('(property) VsIn.uv: vec2<f32>', `vertex attribute at @location(${String(n)})`),
      );
    // The declaring file: a line for each program, the two that agree included.
    expect(hover(files, IO, 'uv:')).toBe(
      lines(
        '(property) VsIn.uv: vec2<f32>',
        'vertex attribute at @location(1) in a.shade.ts',
        'vertex attribute at @location(2) in b.shade.ts',
        'vertex attribute at @location(1) in c.shade.ts',
      ),
    );
    // With the one that differs closed, the two that are left agree: one line, no file.
    const service = opened(files);
    service.closeDocument(B);
    expect(hoverAt(service, IO, files[IO]!, 'uv:')).toBe(
      withLine('(property) VsIn.uv: vec2<f32>', 'vertex attribute at @location(1)'),
    );
  });

  it('two programs with one base name: each line names enough of the path to tell them apart', () => {
    const LIT = '/p/lit/main.shade.ts';
    const UNLIT = '/p/unlit/main.shade.ts';
    const files: Files = {
      [IO]: `"use typeshade";
export interface VsIn {
  position: vec3;
  uv: vec2;
}
`,
      [LIT]: `"use typeshade";
import { VsIn } from "../io.shade.ts";
@vertex
export function vs(normal: vec3, v: VsIn): vec4 {
  return vec4(v.position + normal, v.uv.x);
}
`,
      [UNLIT]: `"use typeshade";
import { VsIn } from "../io.shade.ts";
@vertex
export function vs(v: VsIn): vec4 {
  return vec4(v.position, v.uv.x);
}
`,
    };
    expect(messagesOf(files, LIT)).toEqual([]);
    expect(messagesOf(files, UNLIT)).toEqual([]);
    expect(reflected(files, LIT, 'vs', 'inputs', 'uv')).toBe(2);
    expect(reflected(files, UNLIT, 'vs', 'inputs', 'uv')).toBe(1);
    expect(hover(files, IO, 'uv:')).toBe(
      lines(
        '(property) VsIn.uv: vec2<f32>',
        'vertex attribute at @location(2) in lit/main.shade.ts',
        'vertex attribute at @location(1) in unlit/main.shade.ts',
      ),
    );
  });

  it('two programs with two numbers and two kinds: each line says what the field is there', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const files: Files = {
      [IO]: `"use typeshade";
export interface V {
  q: vec4;
  p: vec4;
}
`,
      [A]: `"use typeshade";
import { V } from "./io.shade.ts";
@vertex
export function vs(a: V): vec4 {
  return a.p + a.q;
}
`,
      [B]: `"use typeshade";
import { V } from "./io.shade.ts";
interface Out {
  pos: builtin<"position">;
  p: vec4;
  q: vec4;
}
@vertex
export function vs(i: builtin<"vertex_index">): Out {
  return { pos: vec4(f32(i), 0., 0., 1.), p: vec4(1., 0., 0., 1.), q: vec4(0., 1., 0., 1.) };
}
@fragment
export function fs(v: V): vec4 {
  return v.p + v.q;
}
`,
    };
    expect(messagesOf(files, A)).toEqual([]);
    expect(messagesOf(files, B)).toEqual([]);
    expect(reflected(files, A, 'vs', 'inputs', 'p')).toBe(1);
    expect(reflected(files, B, 'fs', 'inputs', 'p')).toBe(0);
    expect(hover(files, IO, 'p:')).toBe(
      lines(
        '(property) V.p: vec4<f32>',
        'vertex attribute at @location(1) in a.shade.ts',
        'value between stages at @location(0) in b.shade.ts',
      ),
    );
  });

  it('one program numbers the field and another refuses it (TS8010): a line for each', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const entry = (more: string, value: string) => `"use typeshade";
import { FsIn } from "./io.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;${more}
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.)${value} };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`;
    const files: Files = {
      [IO]: `"use typeshade";
export interface FsIn {
  n: vec3;
  uv: vec2;
}
`,
      [A]: entry('\n  n: vec3;', ', n: vec3(0., 0., 1.)'),
      [B]: entry('', ''),
    };
    // The program of `a.shade.ts` numbers `n`. The program of `b.shade.ts` refuses it.
    expect(messagesOf(files, A)).toEqual([]);
    expect(reflected(files, A, 'fs', 'inputs', 'n')).toBe(1);
    expect(messagesOf(files, B)).toEqual([
      'TS8010 "FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.',
    ]);
    expect(reflected(files, B, 'fs', 'inputs', 'n')).toBeUndefined();
    expect(hover(files, A, 'v.n', 2)).toBe(
      withLine('(property) FsIn.n: vec3<f32>', 'value between stages at @location(1)'),
    );
    expect(hover(files, B, 'v.n', 2)).toBe(bare('(property) FsIn.n: vec3<f32>'));
    // The declaring file: the line of the program that numbers the field, and a line for the
    // program that refuses it, with the code `compile()` of that program reports on the field
    // (the owner's decision of 2026-11-10).
    const code = refusalCodeOf(files, B, IO, 'n:');
    expect(code).toBe('TS8010');
    expect(hover(files, IO, 'n:')).toBe(
      lines(
        '(property) FsIn.n: vec3<f32>',
        'value between stages at @location(1) in a.shade.ts',
        `no location in b.shade.ts (${code})`,
      ),
    );
    // The field beside it has one number in both programs: one line, no file.
    expect(reflected(files, A, 'fs', 'inputs', 'uv')).toBe(0);
    expect(reflected(files, B, 'fs', 'inputs', 'uv')).toBe(0);
    expect(hover(files, IO, 'uv:')).toBe(
      withLine('(property) FsIn.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
    // With the program that numbers it closed, the refusal is the one line, with its file.
    const service = opened(files);
    service.closeDocument(A);
    expect(hoverAt(service, IO, files[IO]!, 'n:')).toBe(
      lines('(property) FsIn.n: vec3<f32>', 'no location in b.shade.ts (TS8010)'),
    );
    // With that program closed too, no open program uses the field, and there is no line.
    // No program lowers the struct now, so the signature is TypeScript's quick info.
    service.closeDocument(B);
    expect(hoverAt(service, IO, files[IO]!, 'n:')).toBe(bare('(property) FsIn.n: vec3'));
  });

  it('every program refuses the field: a line for each, and none for a program that does not use it', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const C = '/p/c.shade.ts';
    const entry = `"use typeshade";
import { FsIn } from "./io.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`;
    const files: Files = {
      [IO]: `"use typeshade";
export interface FsIn {
  n: vec3;
  uv: vec2;
  flag: bool;
}
`,
      [A]: entry,
      [B]: entry,
      // This program links the file and reads the struct in a helper only: no entry uses it.
      [C]: `"use typeshade";
import { FsIn } from "./io.shade.ts";
function sum(p: FsIn): f32 {
  return p.n.x + p.uv.x;
}
@fragment
export function fs(): vec4 {
  const p: FsIn = { n: vec3(0., 0., 1.), uv: vec2(0., 0.), flag: true };
  return vec4(sum(p), 0., 0., 1.);
}
`,
    };
    expect(messagesOf(files, C)).toEqual([]);
    for (const name of [A, B]) {
      expect(reflected(files, name, 'fs', 'inputs', 'n')).toBeUndefined();
      expect(refusalCodeOf(files, name, IO, 'n:')).toBe('TS8010');
    }
    expect(hover(files, IO, 'n:')).toBe(
      lines(
        '(property) FsIn.n: vec3<f32>',
        'no location in a.shade.ts (TS8010)',
        'no location in b.shade.ts (TS8010)',
      ),
    );
    // A field of a type that cannot cross is refused with another code, and the line has it.
    const flag = refusalCodeOf(files, A, IO, 'flag:');
    expect(flag).toBe('TS8003');
    expect(hover(files, IO, 'flag:')).toBe(
      lines(
        '(property) FsIn.flag: bool',
        `no location in a.shade.ts (${flag})`,
        `no location in b.shade.ts (${flag})`,
      ),
    );
    // The field both programs number has its one line, and no file.
    expect(hover(files, IO, 'uv:')).toBe(
      withLine('(property) FsIn.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
  });

  it('two programs that agree on the number: the declaring file says what the field is in both', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const files: Files = {
      [IO]: `"use typeshade";
export interface V {
  p: vec4;
}
`,
      [A]: `"use typeshade";
import { V } from "./io.shade.ts";
@vertex
export function vs(a: V): vec4 {
  return a.p;
}
`,
      [B]: `"use typeshade";
import { V } from "./io.shade.ts";
interface Out {
  pos: builtin<"position">;
  p: vec4;
}
@vertex
export function vs(i: builtin<"vertex_index">): Out {
  return { pos: vec4(f32(i), 0., 0., 1.), p: vec4(1., 0., 0., 1.) };
}
@fragment
export function fs(v: V): vec4 {
  return v.p;
}
`,
    };
    expect(messagesOf(files, A)).toEqual([]);
    expect(messagesOf(files, B)).toEqual([]);
    expect(reflected(files, A, 'vs', 'inputs', 'p')).toBe(0);
    expect(reflected(files, B, 'fs', 'inputs', 'p')).toBe(0);
    expect(hover(files, A, 'a.p', 2)).toBe(
      withLine('(property) V.p: vec4<f32>', 'vertex attribute at @location(0)'),
    );
    expect(hover(files, B, 'v.p', 2)).toBe(
      withLine('(property) V.p: vec4<f32>', 'value between stages at @location(0)'),
    );
    expect(hover(files, IO, 'p:')).toBe(
      withLine(
        '(property) V.p: vec4<f32>',
        'vertex attribute and value between stages at @location(0)',
      ),
    );
  });

  it('a fragment input no vertex result names (TS8010): no number, and the declaring file names the refusal', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface FsIn {
  n: vec3;
  uv: vec2;
}
`,
      [MAIN]: `"use typeshade";
import { FsIn } from "./io.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, v.uv.x);
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([
      'TS8010 "FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.',
    ]);
    expect(reflected(files, MAIN, 'fs', 'inputs', 'n')).toBeUndefined();
    expect(hover(files, MAIN, 'v.n', 2)).toBe(bare('(property) FsIn.n: vec3<f32>'));
    // The declaring file says that the one program that uses the field refused it, with the
    // code `compile()` of that program reports on the field.
    expect(refusalCodeOf(files, MAIN, IO, 'n:')).toBe('TS8010');
    expect(hover(files, IO, 'n:')).toBe(
      lines('(property) FsIn.n: vec3<f32>', 'no location in main.shade.ts (TS8010)'),
    );
    // The field beside it, which a vertex result names, has its location in both files.
    expect(reflected(files, MAIN, 'fs', 'inputs', 'uv')).toBe(0);
    const uv = withLine('(property) FsIn.uv: vec2<f32>', 'value between stages at @location(0)');
    expect(hover(files, MAIN, 'v.uv', 2)).toBe(uv);
    expect(hover(files, IO, 'uv:')).toBe(uv);
  });

  it('an imported struct no entry uses: only a written location is shown', () => {
    const files: Files = {
      [IO]: `"use typeshade";
export interface Pair {
  a: vec2;
  b: location<3, vec2>;
}
`,
      [MAIN]: `"use typeshade";
import { Pair } from "./io.shade.ts";
function sum(p: Pair): f32 {
  return p.a.x + p.b.x;
}
@fragment
export function fs(): vec4 {
  const p: Pair = { a: vec2(1., 0.), b: vec2(0., 1.) };
  return vec4(sum(p), 0., 0., 1.);
}
`,
    };
    expect(messagesOf(files, MAIN)).toEqual([]);
    // No entry's input or output is a field of `Pair`, so `reflect()` reports none of them.
    for (const e of reflect(compiled(files, MAIN).module).entries)
      expect([...e.io.inputs, ...e.io.outputs].map((f) => f.name)).toEqual(['_ret']);
    expect(hover(files, MAIN, 'p.a', 2)).toBe(bare('(property) Pair.a: vec2<f32>'));
    expect(hover(files, IO, 'a:')).toBe(bare('(property) Pair.a: vec2<f32>'));
    // The written location is in the emitted struct, and the hover names it as what it is.
    expect(compiled(files, MAIN).wgsl).toContain('  @location(3) b: vec2<f32>,');
    const b = withLine(
      '(property) Pair.b: vec2<f32>',
      'user-defined input or output at @location(3)',
    );
    expect(hover(files, MAIN, 'p.b', 2)).toBe(b);
    expect(hover(files, IO, 'b:')).toBe(b);
  });

  it('a hover runs no analysis that the service does not keep', () => {
    let runs: string[] = [];
    const analyze = (sf: ts.SourceFile, imports?: Parameters<typeof analyzeSourceFile>[1]) => {
      runs.push(sf.fileName);
      return analyzeSourceFile(sf, imports);
    };
    const fresh = () => {
      runs = [];
      return opened(SHARED, createTypeshadeLanguageServiceWith({}, analyze));
    };
    const inMain = (s: TypeshadeLanguageService) => hoverAt(s, MAIN, SHARED[MAIN]!, 'v.uv', 2);
    const inIo = (s: TypeshadeLanguageService) => hoverAt(s, IO, SHARED[IO]!, 'uv:');

    // In the importing file: its own analysis, once, as before this change.
    let service = fresh();
    inMain(service);
    expect(runs).toEqual([MAIN]);
    inMain(service);
    inMain(service);
    expect(runs).toEqual([MAIN]);

    // In the declaring file: its own analysis, and that of the open document that imports it,
    // each once. They are the cache entries the documents' diagnostics read.
    service = fresh();
    inIo(service);
    expect(runs).toEqual([IO, MAIN]);
    inIo(service);
    inMain(service);
    service.getDiagnostics(MAIN);
    service.getDiagnostics(IO);
    expect(runs).toEqual([IO, MAIN]);

    // With the diagnostics of both documents read first, as an editor does, a hover runs none.
    service = fresh();
    service.getDiagnostics(MAIN);
    service.getDiagnostics(IO);
    expect(runs).toEqual([MAIN, IO]);
    inIo(service);
    inMain(service);
    expect(runs).toEqual([MAIN, IO]);

    // An edit of the importing file is one new analysis of it at the next hover.
    service.updateDocument(MAIN, `${SHARED[MAIN]!}\n`);
    inIo(service);
    expect(runs).toEqual([MAIN, IO, MAIN]);
  });
});
