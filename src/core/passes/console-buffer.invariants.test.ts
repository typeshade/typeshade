import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { decodeConsole } from '../console.js';
import { consoleBuffer, CONSOLE_NAMES, CONSOLE_ENTRY_HEADER } from './console-buffer.js';

const kernel = (body: string, prelude = ''): string => `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
${prelude}
@compute([1]) export function k(gid: builtin<"global_invocation_id">): void {
${body}
  out[0] = 1.;
}`;

interface Buf {
  cursor: number;
  dropped: number;
  words: number[];
}

function run(src: string, capacity: number): { buf: Buf; events: unknown[]; dropped: number } {
  const { module, log } = consoleBuffer(compile(src).module);
  if (!log) throw new Error('nothing recorded');
  const cpu = compileModule(module);
  cpu.setBinding('out', new Array(4).fill(0));
  const buf: Buf = { cursor: 0, dropped: 0, words: new Array<number>(capacity).fill(0) };
  cpu.setBinding(CONSOLE_NAMES.binding, buf as never);
  cpu.dispatch('k', [1, 1, 1]);
  const d = decodeConsole(new Uint32Array([buf.cursor, buf.dropped, ...buf.words]), log);
  return { buf, events: d.events.map((e) => e.args), dropped: d.dropped };
}

describe('console buffer invariants', () => {
  it('keeps the bits of an i32', () => {
    const r = run(kernel(`  const i: i32 = -7;\n  console.log(i);`), 64);
    expect(r.dropped).toBe(0);
    expect(r.events).toEqual([[-7]]);
    expect(r.buf.words[CONSOLE_ENTRY_HEADER]).toBe(0xfffffff9);
  });

  it('writes an f64 as its high word, then the residual of its narrowing as the low word', () => {
    const src = kernel(`  const x: f64 = f64(f32(gid.x) + 1.) / f64(3.);\n  console.log(x);`);
    const r = run(src, 64);
    expect((r.events[0] as number[])[0]).toBeCloseTo(1 / 3, 6);
    const wgsl = compile(src, { console: 'gpu' }).wgsl!;
    expect(wgsl).toContain('_console.words[_console_0] = bitcast<u32>(df64_narrow(x));');
    expect(wgsl).toContain(
      '_console.words[(_console_0 + 1u)] = bitcast<u32>(df64_narrow(df64_sub(df64_add(x,',
    );
    expect(wgsl).toContain('df64_add(vec2<f32>(df64_narrow(x), 0.0),');
  });

  it('evaluates each argument once, in order, before the reservation', () => {
    const src = kernel(
      `  console.log(next(), next(), next());`,
      `let n: u32 = 0;
function next(): u32 {
  n = n * 10 + 1;
  return n;
}`,
    );
    const r = run(src, 64);
    expect(r.events).toEqual([[1, 11, 111]]);
  });

  it('binds every argument with a let before the let that calls the reservation', () => {
    const src = kernel(`  console.log(next(), next());`, `function next(): u32 { return 1; }`);
    const k = consoleBuffer(compile(src).module).module.funcs.find((f) => f.name === 'k')!;
    const lets = k.body.flatMap((s) => (s.s === 'let' ? [s] : []));
    const names = lets.map((s) => s.name);
    const reserve = lets.findIndex(
      (s) => s.expr.op === 'call' && s.expr.fn === CONSOLE_NAMES.reserve,
    );
    expect(names.slice(0, reserve)).toEqual(['_console_0_0', '_console_0_1']);
    expect(lets.slice(0, reserve).every((s) => s.expr.op === 'call')).toBe(true);
    expect(JSON.stringify(lets[reserve]!.expr)).not.toContain('next');
  });

  it('writes an entry that fits the buffer exactly', () => {
    const entry = CONSOLE_ENTRY_HEADER + 1;
    const r = run(kernel(`  console.log(1.);`), entry);
    expect(r.events).toEqual([[1]]);
    expect(r.dropped).toBe(0);
    expect(r.buf.cursor).toBe(entry);
  });

  it.each([
    ['a function', `function _console_reserve(): void {}`, '_console_reserve'],
    ['a class', `class _Console { a: f32; }`, '_Console'],
  ])(
    'does not record a call when the module declares %s of the buffer name',
    (_n, prelude, taken) => {
      const r = consoleBuffer(compile(kernel(`  console.log(1.);`, prelude)).module);
      expect(r.log).toBeUndefined();
      expect(r.notRecorded.map((n) => [n.method, n.reason])).toEqual([
        ['log', `the module declares "${taken}", the name the console buffer takes`],
      ]);
    },
  );

  it('writes the site word of an entry that straddles the end, and counts it as dropped', () => {
    const src = kernel(`  console.log(1.);\n  console.log(2.);`);
    const entry = CONSOLE_ENTRY_HEADER + 1;
    const r = run(src, entry + 2);
    expect(r.events).toEqual([[1]]);
    expect(r.dropped).toBe(1);
    expect(r.buf.words[entry]).toBe(1);
    expect(r.buf.words[entry + 1]).toBe(0);
    expect(r.buf.cursor).toBe(entry * 2);
  });

  it('declares the three-field struct and reserves with one atomicAdd on the cursor', () => {
    const wgsl = compile(kernel('  console.log(1.);'), { console: 'gpu' }).wgsl!;
    expect(wgsl).toMatch(
      /struct _Console \{\s*cursor: atomic<u32>,\s*dropped: atomic<u32>,\s*words: array<u32>,?\s*\}/,
    );
    expect(wgsl.match(/atomicAdd\(&_console\.cursor, /g)).toHaveLength(1);
  });

  it('returns the same module when no call is recorded', () => {
    const m = compile(kernel('')).module;
    const r = consoleBuffer(m);
    expect(r.module).toBe(m);
    expect(r.log).toBeUndefined();
  });

  it('takes the invocation of a fragment entry from its position', () => {
    const src = `"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(vi), 0., 0., 1.) }; }
@fragment export function fs(v: VsOut): Color {
  console.log(1.);
  return { c: v.p };
}`;
    const r = compile(src, { console: 'gpu' });
    expect(r.wgsl).toContain('_console_inv = vec3<u32>(u32(v.p.x), u32(v.p.y), 0u);');
  });
});
