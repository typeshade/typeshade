// The console buffer (changes/0014, surface §66): what the WGSL records under
// `compile(src, { console: 'gpu' })`, and that the decoder reads it back as the CPU's events.
//
// The encoder and the decoder are held together with no GPU: the LOWERED module runs on the CPU
// oracle with the buffer bound to a plain value, and `decodeConsole` of what it wrote must equal
// what the sink received from the unlowered module, event for event, invocation included. The
// same comparison on WebGPU (Tint and SwiftShader) is the `gpu-console` journey.
//
// Verifies: Rule 6.11, Rule 11.9 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { decodeConsole, type ConsoleEvent } from '../console.js';
import { reflect } from '../reflect.js';
import { consoleBuffer, CONSOLE_NAMES } from './console-buffer.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const KERNEL = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
class P {
  a: f32;
  b: vec3;
}
function scaleOf(v: f32): f32 {
  const s = v * 2.;
  if (s > 10.) {
    console.warn("large", s);
  }
  return s;
}
@compute([8])
export function scale(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  const p: P = { a: xs[gid.x], b: vec3(1., 2., 3.) };
  const a: array<i32, 2> = [i32(gid.x), -1];
  console.log("i =", gid.x, p, gid.x > 3, a, mat2x2(1., 2., 3., f32(gid.x)));
  out[gid.x] = scaleOf(xs[gid.x]);
}`;

const N = 12;
const XS = Array.from({ length: N }, (_, i) => Math.fround(i * 1.7));

type Plain = Pick<ConsoleEvent, 'method' | 'args' | 'invocation'>;
const plain = (e: ConsoleEvent): Plain => ({
  method: e.method,
  args: e.args,
  invocation: e.invocation,
});

/** The sink's events for one dispatch of the unlowered module. */
function sinkEvents(src: string): Plain[] {
  const out: Plain[] = [];
  const cpu = compileModule(compile(src).module, { consoleSink: (e) => out.push(plain(e)) });
  cpu.setBinding('xs', XS);
  cpu.setBinding('out', new Array(16).fill(0));
  cpu.dispatch('scale', [2, 1, 1]);
  return out;
}

/** The lowered module run on the oracle, its buffer decoded. */
function bufferEvents(src: string, capacity: number): { events: Plain[]; dropped: number } {
  const { module, log } = consoleBuffer(compile(src).module);
  if (!log) throw new Error('nothing recorded');
  const cpu = compileModule(module);
  cpu.setBinding('xs', XS);
  cpu.setBinding('out', new Array(16).fill(0));
  const buf = { cursor: 0, dropped: 0, words: new Array<number>(capacity).fill(0) };
  cpu.setBinding(CONSOLE_NAMES.binding, buf as never);
  cpu.dispatch('scale', [2, 1, 1]);
  const d = decodeConsole(new Uint32Array([buf.cursor, buf.dropped, ...buf.words]), log);
  return { events: d.events.map(plain), dropped: d.dropped };
}

describe('the console buffer (surface §66)', () => {
  it('sanity: the kernel logs, so an equality below is not two empty lists', () => {
    const events = sinkEvents(KERNEL);
    expect(events.length).toBeGreaterThan(N);
    expect(events.some((e) => e.method === 'warn')).toBe(true);
  });

  it('decodes into the events the CPU sink receives, in its order, with the invocation', () => {
    const want = sinkEvents(KERNEL);
    const got = bufferEvents(KERNEL, 4096);
    expect(got.dropped).toBe(0);
    expect(got.events).toEqual(want);
    expect(want[0]).toEqual({
      method: 'log',
      args: ['i =', 0, { a: 0, b: [1, 2, 3] }, false, [0, -1], [1, 2, 3, 0]],
      invocation: [0, 0, 0],
    });
  });

  it('decodes a console.table as the CPU delivers it: an array of structs, a matrix by column', () => {
    // changes/0019: a table site records the same words as a log of one value; only the matrix
    // is reshaped, on both sides, into its columns.
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
class P {
  pos: vec2;
  speed: f32;
}
@compute([8])
export function scale(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= 2) {
    return;
  }
  const x = xs[gid.x];
  const ps: array<P, 2> = [{ pos: vec2(x, 1.), speed: 2. }, { pos: vec2(3., x), speed: x }];
  console.table(ps);
  console.table(mat2x3(1., 2., 3., 4., 5., x));
  out[gid.x] = x;
}`;
    const want = sinkEvents(src);
    expect(want.map((e) => e.method)).toEqual(['table', 'table', 'table', 'table']);
    expect(want[1]!.args).toEqual([
      [
        [1, 2, 3],
        [4, 5, 0],
      ],
    ]);
    const got = bufferEvents(src, 256);
    expect(got.dropped).toBe(0);
    expect(got.events).toEqual(want);
  });

  it('drops what does not fit, counts it, and never decodes a partial entry', () => {
    const want = sinkEvents(KERNEL).map((e) => JSON.stringify(e));
    const got = bufferEvents(KERNEL, 60);
    expect(got.events.length).toBeGreaterThan(0);
    expect(got.events.length + got.dropped).toBe(want.length);
    for (const e of got.events) expect(want).toContain(JSON.stringify(e));
  });

  it('adds nothing and moves no byte under the default option', () => {
    const plainWgsl = compile(KERNEL).wgsl!;
    expect(compile(KERNEL, { console: 'cpu' }).wgsl).toBe(plainWgsl);
    expect(plainWgsl).not.toContain(CONSOLE_NAMES.binding);
    expect(compile(KERNEL).console).toBeUndefined();
  });

  it('binds the buffer at group 0 past the module bindings, and reflect reports it when asked', () => {
    const r = compile(KERNEL, { console: 'gpu' });
    expect(r.diagnostics).toEqual([]);
    expect(r.console).toMatchObject({ group: 0, binding: 2 });
    expect(r.wgsl).toContain('@group(0) @binding(2) var<storage, read_write> _console: _Console;');
    const names = (opts?: { console: 'gpu' }): string[] =>
      reflect(r.module, opts).bindGroups.flatMap((g) => g.entries.map((e) => e.name));
    expect(names()).toEqual(['xs', 'out']);
    expect(names({ console: 'gpu' })).toEqual(['xs', 'out', '_console']);
  });

  it('keeps the write an argument makes, recorded or not', () => {
    const src = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let n: u32 = 0;
function bump(): u32 {
  n = n + 1;
  return n;
}
@compute([1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  console.log(bump());
  out[gid.x] = n;
}`;
    for (const opt of ['cpu', 'gpu'] as const) {
      const wgsl = compile(src, { console: opt }).wgsl!;
      expect(wgsl, opt).toMatch(/bump\(\)/);
    }
  });
});

describe('TS8071: a console call the WGSL does not record', () => {
  const warn = (src: string): string[] =>
    compile(src, { console: 'gpu' }).diagnostics.map((d) => `${d.category} ${d.code} ${d.message}`);
  const editor = (src: string): readonly unknown[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', src);
    return service.getDiagnostics('a.ts');
  };

  it('in a function a vertex entry reaches', () => {
    const src = `"use typeshade";
function lift(x: f32): f32 {
  console.log(x);
  return x;
}
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(lift(f32(vi)), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(lift(p.x));
}`;
    expect(warn(src)).toEqual([
      'warning TS8071 This console.log() is not recorded on the GPU, because the vertex entry ' +
        '"vs" reaches it, and a vertex stage cannot write a storage buffer. It still reaches ' +
        'the sink when the function runs on the CPU.',
    ]);
    expect(compile(src, { console: 'gpu' }).wgsl).not.toContain(CONSOLE_NAMES.binding);
    // Under the default option the program has no diagnostic, and the editor agrees.
    expect(compile(src).diagnostics).toEqual([]);
    expect(editor(src)).toEqual([]);
  });

  it('with an argument that has no fixed size', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
@compute([1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  console.log(xs);
}`;
    expect(warn(src)).toEqual([
      'warning TS8071 This console.log() is not recorded on the GPU, because a runtime-sized ' +
        'array has no fixed size to write. It still reaches the sink when the function runs on ' +
        'the CPU.',
    ]);
    expect(editor(src)).toEqual([]);
  });

  it('when a stage already binds eight storage buffers', () => {
    const decls = Array.from(
      { length: 8 },
      (_, i) => `declare const b${i}: storage<array<f32>, "read_write">;`,
    ).join('\n');
    const reads = Array.from({ length: 8 }, (_, i) => `b${i}[0] = 1.;`).join('\n  ');
    const src = `"use typeshade";
${decls}
@compute([1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ${reads}
  console.log(gid.x);
}`;
    expect(warn(src)).toEqual([
      'warning TS8071 This console.log() is not recorded on the GPU, because "k" already binds ' +
        "8 storage buffers, WebGPU's default limit for a stage. It still reaches the sink when " +
        'the function runs on the CPU.',
    ]);
  });

  it('adds the invocation builtin to an entry that does not take it', () => {
    const src = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function k(): void {
  console.log(1.5);
  out[0] = 1.;
}`;
    const r = compile(src, { console: 'gpu' });
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@builtin(global_invocation_id) _console_id: vec3<u32>');
    expect(r.wgsl).toContain('_console_inv = _console_id;');
  });
});
