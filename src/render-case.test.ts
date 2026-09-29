// ═══ The render case's picture and its comparison, without a GPU (issue #392) ═══
//
// `scripts/render-case.ts` is shared by the compile gate's two halves: the page draws the scene
// through the program runtime, and Node holds what it read back to the picture `reference()`
// computes. The gate proves the comparison on a device: the same frames drawn with a depth test
// the scene does not want must differ from the picture. This file proves what needs no device,
// so that a picture gone blank or a comparison that stopped seeing fails `bun run test` before
// the gate runs (AGENTS.md#gate-discipline):
//
//   - each picture holds the distinct colours its frame promises, and the pixels where the
//     scene's depth test puts them;
//   - `differences` counts a blank frame, a channel two steps off, a depth 1e-5 off, a value
//     that is not a number and a readback of another size, and forgives one step and 1e-7;
//   - each of the three programs is read clean by both halves, the compiler and the editor, and
//     a broken one is refused by both, so a clean verdict can fail.

import { describe, expect, it } from 'vitest';
import {
  colours,
  differences,
  expectedFrame,
  FRAMES,
  SIZE,
  SOURCES,
  type FrameName,
} from '../scripts/render-case.js';
import { compile } from './compiler/ts/compile.js';
import { createTypeshadeLanguageService } from './language-service/index.js';

const names = Object.keys(FRAMES) as FrameName[];

/** The colour and the depth at pixel (x, y) of a picture. */
function at(picture: { color: number[]; depth: number[] }, x: number, y: number) {
  const i = y * SIZE + x;
  return { color: picture.color.slice(i * 4, i * 4 + 4), depth: picture.depth[i] };
}

const SKY = [51, 102, 204, 255];
const GREEN = [0, 255, 0, 255];
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const BLACK = [0, 0, 0, 255];
const YELLOW = [255, 255, 0, 255];
const CYAN = [0, 255, 255, 255];

describe('the pictures a frame must hold', () => {
  it.each(names)('frame %s holds as many colours as it promises', (name) => {
    expect(colours(expectedFrame(name).color)).toBe(FRAMES[name].colours);
  });

  it('the passes frame: the sky behind everything, and a reversed depth test between the rest', () => {
    const a = expectedFrame('passes');
    // The sky covers the target and writes no depth.
    expect(at(a, 0, 0)).toEqual({ color: SKY, depth: 0 });
    // The near rectangle (0.8), the far one (0.4) and the middle triangle (0.6), alone.
    expect(at(a, 10, 6)).toEqual({ color: GREEN, depth: Math.fround(0.8) });
    expect(at(a, 3, 10)).toEqual({ color: RED, depth: Math.fround(0.4) });
    expect(at(a, 5, 3)).toEqual({ color: BLUE, depth: Math.fround(0.6) });
    // The middle triangle, drawn last, wins over the far rectangle and loses to the near one.
    expect(at(a, 4, 5)).toEqual({ color: BLUE, depth: Math.fround(0.6) });
    expect(at(a, 7, 3)).toEqual({ color: GREEN, depth: Math.fround(0.8) });
  });

  it('the pulled frame: the triangle is drawn first and wins over the rectangle where they meet', () => {
    const d = expectedFrame('pulled');
    expect(at(d, 0, 0)).toEqual({ color: BLACK, depth: 0 });
    expect(at(d, 4, 10)).toEqual({ color: YELLOW, depth: Math.fround(0.5) });
    expect(at(d, 12, 3)).toEqual({ color: CYAN, depth: Math.fround(0.7) });
    expect(at(d, 10, 5)).toEqual({ color: CYAN, depth: Math.fround(0.7) });
  });
});

describe('the comparison of a readback with its picture', () => {
  const picture = expectedFrame('passes');
  const copy = () => ({ color: [...picture.color], depth: [...picture.depth] });

  it('sees no difference in the picture itself', () => {
    expect(differences(copy(), picture)).toEqual({ color: 0, depth: 0 });
  });

  it('forgives one 8-bit step of colour and 1e-7 of depth', () => {
    const got = copy();
    got.color[0] = got.color[0]! + 1;
    got.depth[0] = got.depth[0]! + 1e-7;
    expect(differences(got, picture)).toEqual({ color: 0, depth: 0 });
  });

  it('sees a channel two steps off, and a depth 1e-5 off, each in its own pixel', () => {
    const got = copy();
    got.color[7] = got.color[7]! + 2;
    got.depth[9] = got.depth[9]! + 1e-5;
    expect(differences(got, picture)).toEqual({ color: 1, depth: 1 });
  });

  it('sees a blank frame', () => {
    const blank = { color: picture.color.map(() => 0), depth: picture.depth.map(() => 0) };
    const d = differences(blank, picture);
    expect(d.color).toBeGreaterThan(SIZE * SIZE * 0.9);
    expect(d.depth).toBeGreaterThan(0);
    expect(colours(blank.color)).toBe(1);
  });

  it('counts a value that is not a number, and a readback of another size, as different', () => {
    const nan = copy();
    nan.color[3] = NaN;
    nan.depth[3] = NaN;
    expect(differences(nan, picture)).toEqual({ color: 1, depth: 1 });
    const short = { color: picture.color.slice(4), depth: picture.depth.slice(1) };
    expect(differences(short, picture)).toEqual({ color: SIZE * SIZE, depth: SIZE * SIZE });
  });
});

describe('the three programs, read by both halves', () => {
  const FILE = 'render-case.shade.ts';
  const service = createTypeshadeLanguageService();

  /** How many diagnostics the compiler and the editor give the same source. */
  function halves(source: string): { compiler: number; editor: number } {
    service.openDocument(FILE, source);
    return {
      compiler: compile(source, { fileName: FILE }).diagnostics.length,
      editor: service.getDiagnostics(FILE).length,
    };
  }

  it.each(Object.entries(SOURCES))('%s: neither half reports anything', (_name, source) => {
    expect(halves(source)).toEqual({ compiler: 0, editor: 0 });
  });

  it('a broken program is refused by both halves', () => {
    const broken = SOURCES.mesh.replace('v.position', 'v.nowhere');
    expect(broken).not.toBe(SOURCES.mesh);
    const r = halves(broken);
    expect(r.compiler).toBeGreaterThan(0);
    expect(r.editor).toBeGreaterThan(0);
  });
});
