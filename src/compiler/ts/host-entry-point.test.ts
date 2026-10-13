// The generated host of an entry the WGSL spells differently (Proposal 0070, C5). The host calls
// the entry by its authored name; the pipeline takes the name the WGSL declares. An entry spelled
// alike gets no `entryPoint` in its generated text, so existing hosts do not move.
//
// Verifies: Proposal 0070 (C5, the generated host).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hostFace } from './host-face.js';

const EXAMPLE = new URL(
  '../../../examples/hosts/host-compute/host-compute.shade.ts',
  import.meta.url,
);
const SOURCE = readFileSync(EXAMPLE, 'utf8');

describe('the generated host of a respelled entry (Proposal 0070, C5)', () => {
  it('passes the emitted entry name as entryPoint and keeps the authored name for the host', () => {
    // `fract` is a WGSL predeclared function. The module does not call it, so it compiles.
    const source = SOURCE.replace('export function scale(', 'export function fract(');
    const face = hostFace(source, {
      fileName: 'fract.shade.ts',
      readDocument: () => undefined,
    });
    expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(face.code).toContain('"fn":"fract"');
    expect(face.code).toContain('"entryPoint":"fract_"');
    expect(face.code).toContain('fn fract_(');
  });

  it('writes no entryPoint for an entry the WGSL spells as authored', () => {
    const face = hostFace(SOURCE, { fileName: 'scale.shade.ts', readDocument: () => undefined });
    expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(face.code).not.toContain('entryPoint');
  });
});
