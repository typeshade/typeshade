// The editor reads the plain-TypeScript entry forms of change 0111 as it reads the decorated
// ones (milestone 1, amendment 2): a stage call is an entry in the document symbols and in the
// semantic tokens, and the id of a `builtin<"…", T>` type is hovered and completed as the
// argument of a `builtin("…")` decorator is, filtered by the stage the call names.
//
// Verifies: Rule 1.7, Rule 6.6, Rule 6.7, Rule 8.1, Rule 8.22 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTypeshadeLanguageService } from './service.js';
import { compile } from '../compiler/ts/compile.js';

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

// Change 0130 (The editor): the language service keeps a stage attribute as written, so
// references, rename, definition, hover and completion inside it are TypeScript's; it drops
// TypeScript's TS1206 on it and reports the compiler's own check of it instead (Rule 1.7).
const ATTRIBUTES = `"use typeshade";
declare const buf: storage<array<f32>, "read_write">;
const WG: u32 = 8;
class VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}
@vertex
export function vs(i: builtin<"vertex_index", u32>): VsOut {
  const o = new VsOut();
  o.pos = vec4(f32(i), 0., 0., 1.);
  o.uv = vec2(0.);
  return o;
}
@fragment
export function fs(v: VsOut): location<0, vec4> {
  return vec4(v.uv.x, 0., 0., 1.);
}
@compute([WG, 8])
export function blur(gid: builtin<"global_invocation_id", vec3u>) {
  buf[gid.x] = 1.;
}
@workgroup_size([WG])
export function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
}
`;

describe('the editor reads a stage attribute as an entry (change 0130)', () => {
  const service = () => {
    const s = createTypeshadeLanguageService();
    s.openDocument('b.ts', ATTRIBUTES);
    return s;
  };
  const pos = (needle: string, offset = 0) => {
    const before = ATTRIBUTES.slice(0, ATTRIBUTES.indexOf(needle) + offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1]!.length };
  };

  it('reports nothing in either half: no TS1206 on the attributes, no TS2564 on the fields', () => {
    expect(service().getDiagnostics('b.ts')).toEqual([]);
    expect(compile(ATTRIBUTES).diagnostics).toEqual([]);
  });

  it('lists the entries with their stage, and a kernel function as a function', () => {
    const symbols = service()
      .getDocumentSymbols('b.ts')
      .map((s) => [s.name, s.kind, s.detail ?? null]);
    expect(symbols).toContainEqual(['vs', 'entry', 'vertex']);
    expect(symbols).toContainEqual(['fs', 'entry', 'fragment']);
    expect(symbols).toContainEqual(['blur', 'entry', 'compute']);
    expect(symbols).toContainEqual(['scale', 'function', null]);
  });

  it('hovers an attribute with its documentation, and a constant in its extents with its type', () => {
    expect(service().getHover('b.ts', pos('@compute', 3))?.contents).toContain(
      '@compute([64]) export function main',
    );
    expect(service().getHover('b.ts', pos('@workgroup_size', 3))?.contents).toContain(
      'Without it the compiler chooses the size',
    );
    expect(service().getHover('b.ts', pos('[WG, 8]', 1))?.contents).toContain('WG');
  });

  it('completes a module constant inside the extents', () => {
    const labels = service()
      .getCompletions('b.ts', pos('[WG, 8]', 2))
      .map((c) => c.label);
    expect(labels).toContain('WG');
  });

  it('answers definition inside a call attribute, and nothing, without throwing, at @vertex', () => {
    const s = service();
    expect(s.getDefinition('b.ts', pos('[WG, 8]', 1)).map((l) => l.range.start.line)).toEqual([
      pos('const WG').line,
    ]);
    expect(s.getDefinition('b.ts', pos('@vertex', 2))).toEqual([]);
    expect(s.getDefinition('b.ts', pos('@fragment', 2))).toEqual([]);
  });

  it('renames a constant used in @compute([WG]) everywhere, and the compiler takes the result', () => {
    const s = service();
    expect(s.prepareRename('b.ts', pos('[WG, 8]', 1))?.placeholder).toBe('WG');
    const edits = s.rename('b.ts', pos('[WG, 8]', 1), 'SIZE')['b.ts'] ?? [];
    // The declaration, the extent of @compute and the extent of @workgroup_size.
    expect(edits).toHaveLength(3);
    const lines = ATTRIBUTES.split('\n');
    const ordered = [...edits].sort(
      (a, b) =>
        b.range.start.line - a.range.start.line ||
        b.range.start.character - a.range.start.character,
    );
    for (const e of ordered) {
      const l = lines[e.range.start.line]!;
      lines[e.range.start.line] =
        l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
    }
    const renamed = lines.join('\n');
    expect(renamed).toContain('@compute([SIZE, 8])');
    expect(renamed).toContain('@workgroup_size([SIZE])');
    expect(compile(renamed).diagnostics).toEqual([]);
    // An attribute's own name is the library's, which no rename reaches.
    expect(s.prepareRename('b.ts', pos('@compute', 3))).toBeUndefined();
    expect(s.prepareRename('b.ts', pos('@vertex', 3))).toBeUndefined();
  });

  it('reports no TS1206 and no TS2564 on any example (Rule 6.6)', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../examples');
    const s = createTypeshadeLanguageService({
      readDocument: (uri: string) => {
        try {
          return readFileSync(new URL(uri), 'utf8');
        } catch {
          return undefined;
        }
      },
    } as Parameters<typeof createTypeshadeLanguageService>[0]);
    // Every `*.shade.ts` under `examples/`, its subdirectories included: the host example
    // modules and the pass files carry entries too.
    const files = (readdirSync(dir, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.shade.ts'))
      .sort();
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.some((f) => f.startsWith('hosts')) && files.some((f) => f.startsWith('passes')),
    ).toBe(true);
    const found: string[] = [];
    let attributes = 0;
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      attributes += text.match(/^@(?:vertex|fragment|compute)\b/gm)?.length ?? 0;
      const uri = pathToFileURL(join(dir, file)).href;
      s.openDocument(uri, text);
      for (const d of s.getDiagnostics(uri))
        if (d.code === 1206 || d.code === 2564 || d.code === 'TS1206' || d.code === 'TS2564')
          found.push(`${file}: ${String(d.code)}`);
    }
    // The check reads what it is for: the examples write the stage attributes (change 0130),
    // on which a plain `tsc` reports TS1206 (AGENTS.md#gate-discipline).
    expect(attributes).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});
