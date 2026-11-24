// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { madeOf } from '../../core/kernel-made-face.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { hostFace } from './host-face.js';
import { warningsOf } from './growing-load.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

describe('what Route 1 and Route 2 cannot size runs on the CPU tier (change 0114, A12 form 2, Route 3)', () => {
  const H = `"use typeshade";\n`;
  const grows = (body: string, params = 'n: u32'): string =>
    `${H}export function f(${params}): f32[] { const out: f32[] = []; ${body} return out; }`;
  const routeOf = (source: string): KernelFace => {
    const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    return (f.exports!.find((e) => e.name === 'f') as { face: KernelFace }).face;
  };

  it('takes a nest whose inner start reads the outer counter and whose read the proof cannot show in range', () => {
    const source = grows(
      'for (let i: u32 = 0; i < n; i++) { for (let j: u32 = i + 1; j < n; j++) { out.push(xs[j]); } }',
      'n: u32, xs: f32[]',
    );
    expect(warningsOf(source)).toEqual([
      'typeshade TS8070: "for (let j: u32 = i + 1; j < n; j++)" pushes onto "out", and its start ' +
        'or bound reads a value the call does not know before it runs, so this function runs ' +
        'on the CPU, where the array grows as it is pushed to.',
    ]);
    expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
  });

  it('takes a branch whose condition reads a value the call does not know, with the warning of the proof', () => {
    const source = grows(
      'if (xs[0] > 0) { for (let i: u32 = 0; i < n; i++) { out.push(1.); } }',
      'n: u32, xs: f32[]',
    );
    const warnings = warningsOf(source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('typeshade TS8070: This function runs on the CPU because');
    expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
    expect(madeOf(routeOf(source))).not.toHaveProperty('capacity');
  });

  it('gives the TS8070 warning, not an error, for a program that runs on the CPU tier', () => {
    const halves = bothHalves(
      grows('if (c > 0) { for (let i: u32 = 0; i < n; i++) { out.push(1.); } }', 'n: u32, c: u32'),
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toHaveLength(1);
    expect(halves.editor[0]).toContain('TS8070');
  });
});
