// The editor reads the plain-TypeScript entry forms of change 0111 as it reads the decorated
// ones (milestone 1, amendment 2): a stage call is an entry in the document symbols and in the
// semantic tokens, and the id of a `builtin<"…", T>` type is hovered and completed as the
// argument of a `builtin("…")` decorator is, filtered by the stage the call names.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';

const SOURCE = `"use typeshade";
interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
});
export const fs = fragment(function fs(v: VsOut): vec4 {
  return vec4(v.uv.x, 0., 0., 1.);
});
export const scale = workgroup_size([64], function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
});
`;

const open = () => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', SOURCE);
  return service;
};

/** The position of `needle` in SOURCE, moved `offset` characters into it. */
const at = (needle: string, offset = 0) => {
  const before = SOURCE.slice(0, SOURCE.indexOf(needle) + offset).split('\n');
  return { line: before.length - 1, character: before[before.length - 1]!.length };
};

describe('the editor reads a stage call as an entry (change 0111)', () => {
  it('lists the entries with their stage, and a workgroup_size kernel as a function', () => {
    const symbols = open()
      .getDocumentSymbols('a.ts')
      .map((s) => [s.name, s.kind, s.detail ?? null]);
    expect(symbols).toContainEqual(['vs', 'entry', 'vertex']);
    expect(symbols).toContainEqual(['fs', 'entry', 'fragment']);
    expect(symbols).toContainEqual(['scale', 'function', null]);
  });

  it('marks the entry names with the entry modifier and the builtin ids as builtins', () => {
    const lines = SOURCE.split('\n');
    const tokens = open()
      .getSemanticTokens('a.ts')
      .map((t) => ({
        text: lines[t.line]!.slice(t.character, t.character + t.length),
        type: t.type,
        modifiers: t.modifiers,
      }));
    const vs = tokens.filter((t) => t.text === 'vs');
    expect(vs.length).toBeGreaterThan(0);
    for (const t of vs) expect(t.modifiers).toContain('entry');
    expect(tokens).toContainEqual({ text: 'vertex_index', type: 'builtin', modifiers: [] });
    expect(tokens).toContainEqual({ text: 'position', type: 'builtin', modifiers: [] });
  });
});

describe('the id of a builtin<"…", T> type reads as a decorator argument does', () => {
  it('hovers with the builtin documentation', () => {
    const hover = open().getHover('a.ts', at('"vertex_index"', 3));
    expect(hover?.contents).toContain('`vertex_index`');
  });

  it("completes the ids of the call's stage only", () => {
    const labels = open()
      .getCompletions('a.ts', at('"vertex_index"', 1))
      .map((c) => c.label);
    expect(labels).toContain('vertex_index');
    expect(labels).toContain('instance_index');
    expect(labels).not.toContain('global_invocation_id');
    expect(labels).not.toContain('front_facing');
  });
});
