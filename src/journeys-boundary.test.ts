// The engine boundary of the journeys (proposal 0064, PR-1, S6): `engineOffence` names a call an
// engine source may not make on a WebGPU pass. The typed pass methods of `RenderPass` are not in
// that pattern; `raw` and a `GPU…` name are. The test reads the methods from `surface.md`, so a new
// method is checked the day it lands.
//
// Verifies: Rule 11.11.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The module is plain JavaScript with no types: the path is a variable, so the import is `any`.
const boundary = '../journeys/engine-boundary.mjs';
const { engineOffence } = (await import(boundary)) as {
  engineOffence: (text: string) => string;
};

/** The member names of an interface line of `surface.md`, split at the semicolons outside brackets. */
function membersOf(line: string): string[] {
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ';' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((x) => /^\s*(\w+)\??\s*:/.exec(x)?.[1])
    .filter((x): x is string => x !== undefined);
}

describe('the engine boundary of the journeys (proposal 0064, PR-1)', () => {
  it('spares each RenderPass method of the surface, and refuses raw', () => {
    const surface = readFileSync(
      fileURLToPath(new URL('./__api__/surface.md', import.meta.url)),
      'utf8',
    );
    const line = surface
      .split('\n')
      .find((l) => l.startsWith('src/runtime/runtime.ts#RenderPass '));
    const methods = membersOf(line ?? '').filter((m) => m !== 'raw');
    expect(methods).toEqual(
      expect.arrayContaining(['draw', 'setBlendConstant', 'setScissorRect', 'setViewport']),
    );
    for (const name of methods) expect(engineOffence(`pass.${name}(0)`)).toBe('');
    expect(engineOffence('pass.raw')).not.toBe('');
    expect(engineOffence('pass.raw.setScissorRect(0, 0, 1, 1)')).not.toBe('');
  });
});
