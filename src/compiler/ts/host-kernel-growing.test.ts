// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterEach, describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';
import { madeOf } from '../../core/kernel-made-face.js';
import { configure } from '../../runtime.js';
import { facesOf } from './growing-load.js';
import {
  ELEMENT_PROGRAMS,
  FOR_PROGRAMS,
  HEADER,
  NEST_PROGRAMS,
  WHILE_PROGRAMS,
  type Program,
} from './growing-programs/index.js';

afterEach(() => {
  configure({});
});

const GROWS_ONLY_WHERE_RUNNING = (shown: string): string =>
  `it grows "${shown}" with push in a loop whose number of pushes the call cannot know before ` +
  `it runs, and only the CPU tier grows an array while it runs; a run that grows an array on ` +
  `WebGPU or WebGL2 is not supported yet`;

const declared = (p: Program): string => /const (\w+): \w+\[\] = \[\]/.exec(p.source)![1]!;

describe('a loop that is not a counted for takes Route 3, in both halves (change 0114, A12)', () => {
  const refusedByProof = [...WHILE_PROGRAMS, ...FOR_PROGRAMS];
  const all = [...refusedByProof, ...NEST_PROGRAMS, ...ELEMENT_PROGRAMS];

  for (const p of all)
    it(`gives no error for ${p.name}, and one text of each warning in both halves`, () => {
      const halves = bothHalves(HEADER + p.source);
      expect(halves.compiler).toEqual([]);
      const warnings = halves.result.diagnostics
        .filter((d) => d.category === 'warning')
        .map((d) => `typeshade ${d.code}: ${d.message}`);
      expect(halves.editor).toEqual(warnings);
      expect(halves.hover(`${declared(p)}: `)).toContain('array<');
    });

  for (const p of refusedByProof)
    it(`gives the TS8070 warning of the parameter form for ${p.name}`, () => {
      const halves = bothHalves(HEADER + p.source);
      expect(halves.editor.length).toBeGreaterThan(0);
      for (const text of halves.editor) expect(text).toContain('typeshade TS8070');
    });

  it('keeps a counted for that reads an element refused, where the same while is taken', () => {
    const counted =
      'export function f(xs: u32[]): u32[] { const out: u32[] = []; ' +
      'for (let i: u32 = 0; i < xs[0]; i++) { out.push(i); } return out; }';
    const open =
      'export function f(xs: u32[]): u32[] { const out: u32[] = []; let i: u32 = 0; ' +
      'while (i < xs[0]) { out.push(i); i++; } return out; }';
    bothRefuse(
      HEADER + counted,
      'TS8099',
      '"for (let i: u32 = 0; i < xs[0]; i++)" pushes onto "out", and its start or bound reads a ' +
        'value the call does not know before it runs. It reads the value parameters, their ' +
        'components and fields, module constants, the length of an array parameter, number ' +
        'literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, ' +
        'min and max; any other operand is not supported yet.',
    );
    expect(bothHalves(HEADER + open).compiler).toEqual([]);
  });
});

describe('the face of a function that takes Route 3 (change 0114, A12, section 3)', () => {
  const growing = [...WHILE_PROGRAMS, ...FOR_PROGRAMS, ...ELEMENT_PROGRAMS].filter(
    (p) => p.name !== 'countedAppended',
  );
  const faces = facesOf(HEADER + [...growing, ...NEST_PROGRAMS].map((p) => p.source).join('\n'));

  for (const p of [...growing, ...NEST_PROGRAMS].filter(
    (q) => q.name !== 'inside' && q.name !== 'switched',
  ))
    it(`records growing, no capacity and no GPU tier for ${p.name}`, () => {
      const k = faces.get(p.name)!;
      expect(madeOf(k)).toMatchObject({ grown: true, growing: true });
      expect(madeOf(k)!.capacity).toBeUndefined();
      expect(madeOf(k)!.counted).toBeUndefined();
      expect(k.gpu).toBeUndefined();
      expect(k.gl).toBeUndefined();
      expect(typeof k.noGpu).toBe('string');
    });

  it('gives the reason of the proof for a loop the proof refuses', () => {
    expect(faces.get('walk')!.noGpu).toBe('a loop of it runs on the CPU (TS8070)');
  });

  it('gives the growing reason where the proof accepts every loop', () => {
    expect(faces.get('innerWhile')!.noGpu).toBe(GROWS_ONLY_WHERE_RUNNING('out'));
  });

  it('names the reason on WebGPU and on WebGL2 when no CPU tier is listed', async () => {
    const { load } = await import('./growing-load.js');
    const m = await load(HEADER + NEST_PROGRAMS.find((p) => p.name === 'innerWhile')!.source);
    try {
      for (const tier of ['webgpu', 'webgl2'] as const) {
        configure({ prefer: [tier] });
        await expect(m.call['innerWhile']!(3)).rejects.toThrow(
          `innerWhile(): no tier it may use can run it (${tier}: it runs on the CPU, ` +
            `${GROWS_ONLY_WHERE_RUNNING('out')}).`,
        );
        configure({ prefer: [tier, 'cpu'] });
        expect([...((await m.call['innerWhile']!(4)) as Uint32Array)]).toEqual([0, 0, 1, 0, 1, 2]);
      }
    } finally {
      m.dispose();
    }
  });
});
