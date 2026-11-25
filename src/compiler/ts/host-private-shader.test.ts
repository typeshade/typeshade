// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';

const FRAGMENT = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

describe('a private name beside a public member of its name in a shader, both halves (Rule 12.7)', () => {
  const ACCEPT: readonly (readonly [string, string])[] = [
    [
      'a private field beside the accessor of its name',
      FRAGMENT(
        'class Counter {\n  #n: u32 = 0;\n  get n(): u32 { return this.#n; }\n  tick(): u32 { this.#n = this.#n + 1; return this.#n; }\n}',
        '  const c = new Counter();\n  c.tick();\n  const k: u32 = c.n;\n  return vec4(f32(k), 0., 0., 1.)',
      ),
    ],
    [
      'a private field beside the method of its name',
      FRAGMENT(
        'class Gauge {\n  #level: f32 = 0.;\n  level(): f32 { return this.#level; }\n}',
        '  const g = new Gauge();\n  return vec4(g.level(), 0., 0., 1.)',
      ),
    ],
  ];
  const REFUSE: readonly (readonly [string, string])[] = [
    [
      'the accessor beside a private field has the field type, not another',
      FRAGMENT(
        'class Counter {\n  #n: u32 = 0;\n  get n(): u32 { return this.#n; }\n}',
        '  const c = new Counter();\n  const k: f32 = c.n;\n  return vec4(k, 0., 0., 1.)',
      ),
    ],
    [
      'the private name read outside its class, beside the accessor of its name',
      FRAGMENT(
        'class Counter {\n  #n: u32 = 0;\n  get n(): u32 { return this.#n; }\n}',
        '  const c = new Counter();\n  return vec4(f32(c.#n), 0., 0., 1.)',
      ),
    ],
  ];

  for (const [name, source] of ACCEPT)
    it(`${name}: both halves take it`, () => {
      expect(() => bothTake(source)).not.toThrow();
    });

  for (const [name, source] of REFUSE)
    it(`${name}: both halves refuse it`, () => {
      const halves = bothHalves(source);
      expect({ compiler: halves.compiler.length > 0, editor: halves.editor.length > 0 }).toEqual({
        compiler: true,
        editor: true,
      });
    });
});
