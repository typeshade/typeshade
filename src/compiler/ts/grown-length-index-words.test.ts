// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import type { KernelFace } from '../../core/host-kernel.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const PUSH = 'for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }';
const program = (body: string): string =>
  `"use typeshade";\nexport function f(xs: f32[], k: u32): f32[] { const out: f32[] = []; ${body} return out; }\n`;

const reason = (source: string): string | undefined => {
  const face = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  const kernel = face.exports?.find((e) => e.name === 'f');
  return kernel !== undefined && 'face' in kernel ? (kernel.face as KernelFace).noGpu : undefined;
};

async function failure(source: string, k: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-length-index-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!);
  const m = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    f: (xs: Float32Array, k: number) => Promise<unknown>;
  };
  return await m.f(new Float32Array([1, 2, 3]), k).then(
    () => 'no error',
    (e: Error) => e.message,
  );
}

const cannotProve = (verb: string, text: string): string =>
  `it ${verb} "${text}", an element of "out" at an index the compiler cannot prove is below ` +
  `its length, and only the CPU tier checks such an index at the call`;
const pastLength = (text: string, verb: string, index: number): string =>
  `f(): "${text}" ${verb} index ${String(index)} of "out", whose length is 3 there. ` +
  `A ${verb === 'reads' ? 'read' : 'write'} past the length is not supported yet.`;

describe('the words of an access past the length of a grown array quote the index as written', () => {
  const cases: readonly (readonly [
    string,
    string,
    string | undefined,
    string | undefined,
    number?,
  ])[] = [
    [
      'a write at out.length',
      `${PUSH} out[out.length] = 9.;`,
      cannotProve('writes', 'out[out.length]'),
      undefined,
    ],
    [
      'a write at out.length + 1',
      `${PUSH} out[out.length + 1] = 9.;`,
      cannotProve('writes', 'out[out.length + 1]'),
      pastLength('out[out.length + 1]', 'writes', 4),
    ],
    [
      'a compound write at out.length',
      `${PUSH} out[out.length] += 1.;`,
      cannotProve('reads', 'out[out.length]'),
      pastLength('out[out.length]', 'reads', 3),
    ],
    [
      'a read at out.length',
      `${PUSH} const x = out[out.length]; out[0] = x;`,
      undefined,
      pastLength('out[out.length]', 'reads', 3),
    ],
    [
      'an index that is a read of the array',
      `${PUSH} out[0] = out[u32(out[k])];`,
      undefined,
      pastLength('out[u32(out[k])]', 'reads', 3),
      2,
    ],
    [
      'an index that reads the array',
      `${PUSH} out[k + 5] = out[u32(out[k + 1])];`,
      cannotProve('writes', 'out[k + 5]'),
      pastLength('out[k + 1]', 'reads', 8),
      7,
    ],
  ];
  for (const [name, body, gpu, thrown, k = 7] of cases) {
    it(`${name}: both halves take it, and the reasons print the author's text`, async () => {
      const source = program(body);
      bothTake(source);
      if (gpu !== undefined) expect(reason(source)).toBe(gpu);
      if (thrown !== undefined) expect(await failure(source, k)).toBe(thrown);
    });
  }

  it('warns of a store at out.length in a later loop with the author text in both halves', () => {
    const body = `${PUSH} for (let j: u32 = 0; j < xs.length; j++) { out[out.length] = 1.; }`;
    const halves = bothHalves(program(body));
    const sentence =
      'This loop runs on the CPU because line 2 writes "out[out.length]", an element two ' +
      'iterations can share. Write at an index made from "j".';
    const warnings = halves.result.diagnostics.filter((d) => d.category === 'warning');
    expect(warnings.map((d) => d.message)).toEqual([sentence]);
    expect(halves.editor).toEqual([`typeshade ${warnings[0]!.code}: ${sentence}`]);
  });

  it('warns of a read of out.length in the pushing loop with the author text in both halves', () => {
    const body = 'for (let i: u32 = 0; i < xs.length; i++) { out.push(out[out.length]); }';
    const halves = bothHalves(program(body));
    const sentence =
      'This loop runs on the CPU because line 2 reads "out.length", and "out" is an array the ' +
      'loop pushes onto, whose length and elements depend on the iterations before. Read it ' +
      'after the loop.';
    const warnings = halves.result.diagnostics.filter((d) => d.category === 'warning');
    expect(warnings.map((d) => d.message)).toEqual([sentence]);
    expect(halves.editor).toEqual([`typeshade ${warnings[0]!.code}: ${sentence}`]);
  });
});
