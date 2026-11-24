// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { callGrowing, onCpuTier } from '../../core/host-kernel-made/growing.js';
import { tierFit, type CheckedCall } from '../../core/host-kernel.js';
import { defaultOwner } from '../../core/owner.js';
import { madeOf } from '../../core/kernel-made-face.js';
import { configure } from '../../runtime.js';
import { facesOf, load, warningsOf, type Loaded } from './growing-load.js';
import {
  FIRST_MATCHES,
  firstMatchesJs,
  HEADER,
  OPEN_PROGRAMS,
  f32s,
  NEST_PROGRAMS,
  WHILE_PROGRAMS,
  type Program,
} from './growing-programs/index.js';

afterEach(() => {
  configure({});
});

const UNREAD_WARNING =
  '"for (let j: u32 = 0; j < counts[at[i]]; j++)" pushes onto "out", and its start or bound ' +
  'reads a value the call does not know before it runs, so this function runs on the CPU, ' +
  'where the array grows as it is pushed to.';

const GROWS_ONLY_WHERE_RUNNING =
  'it grows "out" with push in a loop whose number of pushes the call cannot know before it ' +
  'runs, and only the CPU tier grows an array while it runs; a run that grows an array on ' +
  'WebGPU or WebGL2 is not supported yet';

const REPEATED = `export function repeated(xs: f32[], counts: u32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = 0; j < counts[i]; j++) {
      out.push(xs[i]);
    }
  }
  return out;
}`;

const SOURCE = HEADER + [...OPEN_PROGRAMS.map((p) => p.source), FIRST_MATCHES, REPEATED].join('\n');
const declared = (p: Program): string => /const (\w+): \w+\[\] = \[\]/.exec(p.source)![1]!;

describe('a nest, a branch and a write that Route 1 and Route 2 cannot size take Route 3, in both halves (change 0114, A12, S3)', () => {
  for (const p of OPEN_PROGRAMS)
    it(`gives no error for ${p.name}, one text of each warning in both halves, and the hover of the parameter form`, () => {
      const halves = bothHalves(HEADER + p.source);
      expect(halves.compiler).toEqual([]);
      expect(halves.editor).toEqual(
        halves.result.diagnostics
          .filter((d) => d.category === 'warning')
          .map((d) => `typeshade ${d.code}: ${d.message}`),
      );
      expect(halves.hover(`${declared(p)}: `)).toContain('array<');
    });

  it('warns on the loop whose header the compiler cannot read, with one sentence in both halves (R3-Q2)', () => {
    const ragged = OPEN_PROGRAMS.find((p) => p.name === 'ragged')!;
    expect(warningsOf(HEADER + ragged.source)).toEqual([`typeshade TS8070: ${UNREAD_WARNING}`]);
  });

  it('warns with the same sentence on a loop up to the length of the array it appends to, in both halves (R3-Q2)', () => {
    const appendPast = OPEN_PROGRAMS.find((p) => p.name === 'appendPast')!;
    const halves = bothHalves(HEADER + appendPast.source);
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([
      'typeshade TS8070: "for (let j: u32 = 0; j < out.length; j++)" writes an element of "out" ' +
        'that can append to it, and its start or bound reads a value the call does not know ' +
        'before it runs, so this function runs on the CPU, where the array grows as it is ' +
        'pushed to.',
    ]);
    expect(warningsOf(HEADER + appendPast.source)).toEqual(halves.editor);
  });

  it('compiles the unguarded write one past the index of a loop up to its length, in both halves', () => {
    const source =
      HEADER +
      'export function f(n: u32): f32[] { const out: f32[] = []; ' +
      'for (let i: u32 = 0; i < n; i++) { out.push(1.); } ' +
      'for (let j: u32 = 0; j < out.length; j++) { out[j + 1] = 2.; } return out; }';
    const halves = bothHalves(source);
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual(warningsOf(source));
    expect(halves.editor).toHaveLength(1);
    const k = facesOf(source).get('f')!;
    expect(madeOf(k)).toMatchObject({ grown: true, growing: true });
    expect(madeOf(k)!.capacity).toBeUndefined();
  });

  it('keeps the reason a shape already carries, and adds no warning of the new sentence', () => {
    for (const name of ['guarded', 'halving', 'appendAt', 'lengthBound']) {
      const p = OPEN_PROGRAMS.find((q) => q.name === name)!;
      for (const w of warningsOf(HEADER + p.source))
        expect(w).not.toContain('where the array grows as it is pushed to');
    }
  });

  it('keeps a counted for that reads an element at the top level refused', () => {
    const source =
      HEADER +
      'export function f(xs: u32[]): u32[] { const out: u32[] = []; ' +
      'for (let i: u32 = 0; i < xs[0]; i++) { out.push(i); } return out; }';
    expect(bothHalves(source).compiler).toHaveLength(1);
    expect(bothHalves(source).editor).toEqual(bothHalves(source).compiler);
  });
});

describe('the face and the route of each shape (change 0114, A12, S3)', () => {
  const faces = facesOf(SOURCE);

  for (const p of OPEN_PROGRAMS)
    it(`records growing, no capacity and no GPU tier for ${p.name}, and never counted with it`, () => {
      const k = faces.get(p.name)!;
      expect(madeOf(k)).toMatchObject({ grown: true, growing: true });
      expect(madeOf(k)!.capacity).toBeUndefined();
      expect(madeOf(k)!.counted).toBeUndefined();
      expect(k.gpu).toBeUndefined();
      expect(k.gl).toBeUndefined();
    });

  it('gives the growing reason where the proof accepts every loop, and the reason a shape has otherwise', () => {
    expect(faces.get('ragged')!.noGpu).toBe(GROWS_ONLY_WHERE_RUNNING);
    expect(faces.get('guarded')!.noGpu).toBe("its body is not the kernel call's shape (TS8070)");
    expect(faces.get('halving')!.noGpu).toBe('a loop of it runs on the CPU (TS8070)');
    expect(faces.get('appendAt')!.noGpu).toBe('a loop of it runs on the CPU (TS8070)');
  });

  it('chooses Route 1, then Route 2, then Route 3', () => {
    const route = (name: string): number => {
      const made = madeOf(faces.get(name)!)!;
      expect(made.counted === true && made.growing === true).toBe(false);
      return made.growing === true ? 3 : made.counted === true ? 2 : 1;
    };
    expect(route('repeated')).toBe(2);
    expect(faces.get('repeated')!.gpu).toBeDefined();
    expect(route('ragged')).toBe(3);
    const all = facesOf(
      HEADER + [...WHILE_PROGRAMS, ...NEST_PROGRAMS].map((p) => p.source).join('\n'),
    );
    expect(
      [...all.values()].some((k) => {
        const made = madeOf(k)!;
        return made.counted === true && made.growing === true;
      }),
    ).toBe(false);
  });

  for (const tier of ['webgpu', 'webgl2'] as const)
    it(`names the reason for ${tier}, and runs on the CPU tier after it`, async () => {
      const checked = { hosts: [], held: [], ranges: undefined } as unknown as CheckedCall;
      expect(await tierFit(faces.get('ragged')!, checked, defaultOwner, tier)).toEqual({
        why: `it runs on the CPU, ${GROWS_ONLY_WHERE_RUNNING}`,
      });
      expect(await tierFit(faces.get('ragged')!, checked, defaultOwner, 'cpu')).toEqual({
        tier: 'cpu',
      });
      expect(await tierFit(faces.get('guarded')!, checked, defaultOwner, tier)).toEqual({
        why: "it runs on the CPU, its body is not the kernel call's shape (TS8070)",
      });
    });
});

describe('each shape gives the elements and the order of a JavaScript run on the CPU tier (change 0114, A12, OD-5)', () => {
  let m: Loaded;
  beforeAll(async () => {
    m = await load(SOURCE);
  });
  afterAll(() => m.dispose());

  for (const p of OPEN_PROGRAMS)
    it(`runs ${p.name}`, async () => {
      for (const [args, expected] of p.runs) {
        const got = (await m.call[p.name]!(...args)) as Iterable<number>;
        expect([...got]).toEqual(expected);
      }
    });

  for (const tier of ['webgpu', 'webgl2'] as const)
    it(`runs ragged where the list is ${tier} then cpu, and names the reason where it is ${tier} alone`, async () => {
      const ragged = OPEN_PROGRAMS.find((p) => p.name === 'ragged')!;
      const [args, expected] = ragged.runs[0]!;
      configure({ prefer: [tier, 'cpu'] });
      expect([...((await m.call['ragged']!(...args)) as Float32Array)]).toEqual(expected);
      configure({ prefer: [tier] });
      await expect(m.call['ragged']!(...args)).rejects.toThrow(
        `ragged(): no tier it may use can run it (${tier}: it runs on the CPU, ${GROWS_ONLY_WHERE_RUNNING}).`,
      );
    });

  it('checks a write past the length at the call, as the parameter form does', async () => {
    await expect(m.call['appendAt']!(1, 1)).rejects.toThrow(
      new RangeError(
        'appendAt(): "out[at]" writes index 1 of "out", whose length is 0 there. A write past the length is not supported yet.',
      ),
    );
  });

  it('leaves the arrays of the caller as they were', async () => {
    const xs = f32s(8, 3);
    await m.call['halving']!(xs);
    expect([...xs]).toEqual([8, 3]);
  });
});

describe('a capacity Route 1 cannot use, in a function Route 2 does not serve (change 0114, A17, R3-Q1 (B))', () => {
  const OVER = 100000;
  const xs = f32s(1);
  let m: Loaded;
  beforeAll(async () => {
    m = await load(SOURCE);
  });
  afterAll(() => m.dispose());

  it('has a capacity of n * n + 1 past the limit, and no count pass', () => {
    expect(m.made('firstMatches')).toMatchObject({ grown: true });
    expect(m.made('firstMatches').counted).toBeUndefined();
    expect(m.made('firstMatches').growing).toBeUndefined();
    expect(m.made('firstMatches').capacity).toBeDefined();
  });

  it('returns the JavaScript array on a runtime with a CPU tier', async () => {
    for (const prefer of [['cpu'], ['webgpu', 'cpu'], ['webgl2', 'cpu']] as const) {
      configure({ prefer });
      const got = (await m.call['firstMatches']!(xs, OVER, 0.5)) as Uint32Array;
      expect([...got]).toEqual(firstMatchesJs([1], OVER, 0.5));
    }
  });

  it('throws the sentence of the limit on a WebGPU-only runtime', async () => {
    for (const prefer of [['webgpu'], ['webgl2'], ['webgpu', 'webgl2']] as const) {
      configure({ prefer });
      await expect(m.call['firstMatches']!(xs, OVER, 0.5)).rejects.toThrow(
        new RangeError(
          'firstMatches(): the array it grows with push, "out", needs room for 10000000001 ' +
            'elements, the most its loops can push, and a length past 4294967295 is not ' +
            'supported yet.',
        ),
      );
    }
  });

  it('leaves the arrays of the caller as they were, whichever way it goes', async () => {
    configure({ prefer: ['webgpu'] });
    await m.call['firstMatches']!(xs, OVER, 0.5).catch(() => undefined);
    configure({ prefer: ['cpu'] });
    await m.call['firstMatches']!(xs, 3, 0.5);
    expect([...xs]).toEqual([1]);
  });

  it('keeps the injected limit of the growing store on the CPU face of the call', async () => {
    const face = onCpuTier(m.face['firstMatches']!, m.made('firstMatches'));
    expect(face.gpu).toBeUndefined();
    expect(face.gl).toBeUndefined();
    expect(typeof face.noGpu).toBe('string');
    expect(onCpuTier(m.face['firstMatches']!, m.made('firstMatches'))).toBe(face);
    const run = (n: number): Promise<unknown> =>
      callGrowing(m.cpu, face, m.made('firstMatches'), [xs, n, 0.5], undefined, 1000);
    await expect(run(5000)).rejects.toThrow(
      new RangeError(
        'firstMatches(): the array it grows with push, "out", needs room for 1000 or more ' +
          'elements, the number its loops push, and a length past 999 is not supported yet.',
      ),
    );
    expect(((await run(900)) as Uint32Array).length).toBe(900);
  });
});
