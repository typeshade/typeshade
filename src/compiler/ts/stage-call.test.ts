// The refusal of the stage call of change 0111 (changes 0130 and 0140): an entry point written
// as `export const vs = vertex(function vs(…) { … })`, an entry written as a `const`, an arrow
// function or a function expression through such a call, and a kernel function's size written
// `workgroup_size([n], f)`. Each is one `TS8028`, an error, on the name called, in the compiler
// and in the editor, and nothing else is said about it (Rule 12.4). The text names the attribute
// that replaces the call and `tshc migrate`, which writes it.
//
// Every test here reads both halves on the same source (Rule 12.7): `compile()`'s diagnostics
// and the language service's `getDiagnostics`, each with its code, its text and the text its
// range covers. `stage3.test.ts` pins the refusal of `export default` on an entry.
//
// Verifies: Rule 1.8, Rule 6.7, Rule 8.1, Rule 12.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { reflect } from '../../core/reflect.js';
import { migrateSource } from '../../cli/migrate.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = '/runtime.ts';

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });

/** Every diagnostic `compile()` gives `source`: severity, code, the text the range covers, and
 *  the message. */
const compiler = (source: string): string[] =>
  compiled(source).diagnostics.map(
    (d) =>
      `${d.category} ${String(d.code)} «${source.slice(d.start, d.start + d.length)}» ${d.message}`,
  );

/** Every diagnostic the language service gives `source`, TypeScript's included, in the same
 *  form. */
const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service
    .getDiagnostics('a.ts')
    .map(
      (d) =>
        `${d.severity} ${String(d.code)} «${source.slice(d.span.start, d.span.start + d.span.length)}» ${d.message}`,
    );
};

/** Both halves give `source` exactly `expected`, in any order. */
const bothSay = (source: string, expected: readonly string[]): void => {
  expect([...compiler(source)].sort()).toEqual([...expected].sort());
  expect([...editor(source)].sort()).toEqual([...expected].sort());
};

/** The refusal of a stage call that is a `const` at the top of the file or of a namespace. */
const refused = (callee: string, written: string, options = ''): string =>
  `error TS8028 «${callee}» ${callee === 'workgroup_size' ? `a kernel's size` : 'a stage'} is an ` +
  `attribute on the function declaration: write "${written}", or run "tshc migrate" ` +
  `(change 0130)${options}`;

/** The refusal of a stage call anywhere else, which `tshc migrate` does not rewrite. */
const refusedElsewhere = (callee: string, written: string): string =>
  `error TS8028 «${callee}» a stage is an attribute on the function declaration: write ` +
  `"${written}" at the top of the file or of a namespace (change 0130)`;

const IO = `interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}
`;

const FORMS: readonly {
  name: string;
  attribute: string;
  called: string;
  refusals: readonly string[];
}[] = [
  {
    name: 'vertex(f) and fragment(f), the fragment an arrow function',
    attribute: `"use typeshade";
${IO}
@vertex
export function vs(i: builtin<"vertex_index", u32>): VsOut {
  const x = i === 1 ? 0.8 : -0.8;
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.) };
}
@fragment
export function fs(v: VsOut): vec4 { return vec4(v.uv.x, v.uv.y, 0.2, 1.); }
`,
    called: `"use typeshade";
${IO}
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  const x = i === 1 ? 0.8 : -0.8;
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.) };
});
export const fs = fragment((v: VsOut): vec4 => vec4(v.uv.x, v.uv.y, 0.2, 1.));
`,
    refusals: [
      refused('vertex', '@vertex export function vs(…)'),
      refused('fragment', '@fragment export function fs(…)'),
    ],
  },
  {
    name: 'compute([x, y, z], f) and workgroup_size([n], f), the size a module constant',
    attribute: `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
const TILE: u32 = 128;
@compute([8, 8, 1])
export function main(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x >= src.length) { return; }
  dst[gid.x] = src[gid.x] * 2.;
}
@workgroup_size([TILE])
export function scale(xs: array<f32>, k: f32): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * k; }
}
`,
    called: `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
const TILE: u32 = 128;
export const main = compute([8, 8, 1], function main(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x >= src.length) { return; }
  dst[gid.x] = src[gid.x] * 2.;
});
export const scale = workgroup_size([TILE], function scale(xs: array<f32>, k: f32): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * k; }
});
`,
    refusals: [
      refused('compute', '@compute([8, 8, 1]) export function main(…)'),
      refused('workgroup_size', '@workgroup_size([TILE]) export function scale(…)'),
    ],
  },
  {
    // An entry that is not exported, one that declares a local function and hands an arrow to
    // a helper, and a function expression with no name of its own.
    name: 'a function expression with no name, and an entry that is not exported',
    attribute: `"use typeshade";
function twice(f: (x: f32) => f32, x: f32): f32 { return f(f(x)); }
@vertex
function vs(): builtin<"position", vec4> { return vec4(0., 0., 0., 1.); }
@fragment
export function fs(p: builtin<"position", vec4>): vec4 {
  const r = 0.1;
  const petal = (q: vec2): f32 => length(q) - r;
  return vec4(petal(p.xy), twice((x) => x * r, p.x), 0., 1.);
}
`,
    called: `"use typeshade";
function twice(f: (x: f32) => f32, x: f32): f32 { return f(f(x)); }
const vs = vertex((): builtin<"position", vec4> => vec4(0., 0., 0., 1.));
export const fs = fragment(function (p: builtin<"position", vec4>): vec4 {
  const r = 0.1;
  const petal = (q: vec2): f32 => length(q) - r;
  return vec4(petal(p.xy), twice((x) => x * r, p.x), 0., 1.);
});
`,
    refusals: [
      refused('vertex', '@vertex function vs(…)'),
      refused('fragment', '@fragment export function fs(…)'),
    ],
  },
];

describe('a stage call is refused with one TS8028, in the compiler and in the editor (change 0140)', () => {
  for (const { name, attribute, called, refusals } of FORMS) {
    it(`${name}: one refusal on each name called, and nothing else`, () => {
      bothSay(called, refusals);
      expect(compiled(called).wgsl).toBeUndefined();
    });

    it(`${name}: the attribute form beside it compiles, with no diagnostic in either half`, () => {
      bothSay(attribute, []);
      expect(compiled(attribute).wgsl).toBeDefined();
    });

    it(`${name}: "tshc migrate" rewrites the refused form to one that compiles to the same WGSL, GLSL ES 3.00 and reflection`, () => {
      const migrated = migrateSource(called);
      expect(migrated.skipped).toEqual([]);
      expect(migrated.changes).toBe(refusals.length);
      bothSay(migrated.text, []);
      const a = compiled(attribute);
      const b = compiled(migrated.text);
      expect(b.wgsl).toBe(a.wgsl);
      expect(JSON.stringify(b.glsl)).toBe(JSON.stringify(a.glsl));
      expect(JSON.stringify(reflect(b.module))).toBe(JSON.stringify(reflect(a.module)));
    });
  }

  it('in a namespace', () => {
    bothSay(
      `"use typeshade";
namespace N {
  export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
    return vec4(p.x, 0., 0., 1.);
  });
}
`,
      [refused('fragment', '@fragment export function fs(…)')],
    );
  });

  it('a function expression named otherwise takes the name of the constant', () => {
    bothSay(
      `"use typeshade";
export const fs = fragment(function main(): vec4 { return vec4(1., 0., 0., 1.); });
`,
      [refused('fragment', '@fragment export function fs(…)')],
    );
  });

  it('in a program of two files, on the file that writes it', () => {
    const lib = `"use typeshade";\nexport function half(x: f32): f32 { return x * 0.5; }\n`;
    const main = `"use typeshade";
import { half } from "./lib.shade.ts";
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(half(p.x), 0., 0., 1.);
});
`;
    const readDocument = (path: string) => (path === '/app/lib.shade.ts' ? lib : undefined);
    const expected = [refused('fragment', '@fragment export function fs(…)')];
    expect(
      compile(main, { fileName: '/app/main.shade.ts', readDocument }).diagnostics.map(
        (d) =>
          `${d.category} ${String(d.code)} «${main.slice(d.start, d.start + d.length)}» ${d.message}`,
      ),
    ).toEqual(expected);
    const service = createTypeshadeLanguageService({ readDocument });
    service.openDocument('/app/main.shade.ts', main);
    expect(
      service
        .getDiagnostics('/app/main.shade.ts')
        .map(
          (d) =>
            `${d.severity} ${String(d.code)} «${main.slice(d.span.start, d.span.start + d.span.length)}» ${d.message}`,
        ),
    ).toEqual(expected);
  });

  it('a constant named as the stage it calls', () => {
    bothSay(
      `"use typeshade";
export const vertex = vertex(function vertex(): builtin<"position", vec4> {
  return vec4(0., 0., 0., 1.);
});
`,
      [refused('vertex', '@vertex export function vertex(…)')],
    );
  });
});

describe('a refused stage call says its options with the call, once (changes 0131 and 0132)', () => {
  const SAMPLE = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
export const fs = fragment(
  function fs(p: builtin<"position", vec4>): vec4 {
    if (p.x > 10.) { return textureSample(t, s, p.xy); }
    return vec4(0.);
  },
  OPTIONS
);
`;
  const withOptions = (written: string): string[] => [
    refused(
      'fragment',
      '@fragment export function fs(…)',
      `. The attribute takes no options: delete "${written}"`,
    ),
  ];

  it('a diagnostic filter', () => {
    bothSay(
      SAMPLE.replace('OPTIONS', '{ diagnostic: ["off", "derivative_uniformity"] },'),
      withOptions('diagnostic: [...]'),
    );
  });

  it('another option', () => {
    bothSay(SAMPLE.replace('OPTIONS', '{ blend: "add" },'), withOptions('blend: "add"'));
  });

  it('an option on workgroup_size, where TypeScript counts the arguments', () => {
    bothSay(
      `"use typeshade";
export const scale = workgroup_size([128], function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
}, { numerics: [1] });
`,
      [
        refused(
          'workgroup_size',
          '@workgroup_size([128]) export function scale(…)',
          '. The attribute takes no options: delete "numerics: [1]"',
        ),
      ],
    );
  });

  it('"tshc migrate" deletes the filter with the call, and the sample is rewritten (Rule 8.5)', () => {
    const migrated = migrateSource(
      SAMPLE.replace('OPTIONS', '{ diagnostic: ["off", "derivative_uniformity"] },'),
    );
    expect(migrated.skipped).toEqual([]);
    bothSay(migrated.text, []);
    expect(compiled(migrated.text).wgsl).toContain('textureSampleGrad(');
    expect(compiled(migrated.text).wgsl).not.toContain('diagnostic(');
  });
});

describe('a stage call that declares no entry is refused where it is written', () => {
  const FS = `@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x, 0., 0., 1.);
}
`;

  it('in the body of a function, which is not at the top level', () => {
    bothSay(
      `"use typeshade";
function h(x: f32): f32 {
  const g = compute([8], function k(): void {});
  return x;
}
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  const inner = fragment(function shade(q: vec4): vec4 { return q; });
  return vec4(h(p.x), 0., 0., 1.);
}
`,
      [
        refusedElsewhere('compute', '@compute([8]) export function k(…)'),
        refusedElsewhere('fragment', '@fragment export function shade(…)'),
      ],
    );
  });

  it('after export default, where the call declares no name', () => {
    bothSay(
      `"use typeshade";
export default fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x, 0., 0., 1.);
});
`,
      [refusedElsewhere('fragment', '@fragment export function fs(…)')],
    );
  });

  it('as a statement at the top of the file', () => {
    bothSay(
      `"use typeshade";
vertex(function vs(): builtin<"position", vec4> { return vec4(0., 0., 0., 1.); });
${FS}`,
      [refusedElsewhere('vertex', '@vertex export function vs(…)')],
    );
  });

  it('in a let, and in a list of constants', () => {
    bothSay(
      `"use typeshade";
let vs = vertex(function vs(): builtin<"position", vec4> { return vec4(0., 0., 0., 1.); });
const a: f32 = 1., k = compute([4, 4], function k(): void {});
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x * a, 0., 0., 1.);
}
`,
      [
        refusedElsewhere('vertex', '@vertex export function vs(…)'),
        refusedElsewhere('compute', '@compute([4, 4]) export function k(…)'),
      ],
    );
  });

  it('with no function to wrap, and in a pattern', () => {
    bothSay(
      `"use typeshade";
export const k = compute(1);
const { a } = vertex(function vs(): builtin<"position", vec4> { return vec4(0., 0., 0., 1.); });
${FS}`,
      [
        refusedElsewhere('compute', '@compute export function k(…)'),
        refusedElsewhere('vertex', '@vertex export function vs(…)'),
      ],
    );
  });
});

describe("the four names are the file's when the file declares them (Rule 2.1)", () => {
  // The valid neighbours of the refusal: `vertex`, `fragment`, `compute` and `workgroup_size`
  // are attribute names, and a declaration of the file under one of them is the file's. Each
  // program compiles, and neither half says anything.
  const programs: Record<string, string> = {
    'a function named vertex, called with a number': `"use typeshade";
function vertex(x: f32): f32 { return x * 2.; }
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(vertex(p.x), 0., 0., 1.);
}
`,
    'a function named vertex that takes a function, called with an arrow function': `"use typeshade";
function vertex(f: (x: f32) => f32, x: f32): f32 { return f(x); }
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(vertex((x) => x * 2., p.x), 0., 0., 1.);
}
`,
    'a local arrow function named compute': `"use typeshade";
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  const compute = (x: f32): f32 => x * 2.;
  return vec4(compute(p.x), 0., 0., 1.);
}
`,
    'a module constant named fragment and a parameter named vertex': `"use typeshade";
const fragment: f32 = 2.;
function h(vertex: f32): f32 { return vertex * fragment; }
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(h(p.x), 0., 0., 1.);
}
`,
    "a namespace's function named workgroup_size": `"use typeshade";
namespace N {
  export function workgroup_size(x: f32): f32 { return x * 2.; }
  export function g(x: f32): f32 { return workgroup_size(x); }
}
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(N.g(p.x), N.workgroup_size(1.), 0., 1.);
}
`,
  };
  for (const [name, source] of Object.entries(programs)) {
    it(`${name}: compiles, and neither half reports anything`, () => {
      bothSay(source, []);
      expect(compiled(source).wgsl).toBeDefined();
    });
  }

  it("a module constant from a call of the file's own vertex is that constant's refusal, not a stage call", () => {
    bothSay(
      `"use typeshade";
function vertex(f: (x: f32) => f32): f32 { return f(1.); }
const k = vertex((x: f32): f32 => x * 2.);
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(k, 0., 0., 1.);
}
`,
      [
        'error TS8003 «k = vertex((x: f32): f32 => x * 2.)» Module const "k" must be constant, and "vertex((x: f32): f32 => x * 2.)" calls a function this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.',
      ],
    );
  });
});

describe('a refused stage call is still read as the entry it stood for (Rule 12.4)', () => {
  it('nothing is said of the struct, the helper, the constant or the binding only it reads', () => {
    bothSay(
      `"use typeshade";
${IO}
declare const tint: uniform<vec4>;
const GAIN: f32 = 2.;
function lit(c: vec2): vec4 { return vec4(c * GAIN, 0., 1.) * tint; }
@vertex
export function vs(i: builtin<"vertex_index", u32>): VsOut {
  return { pos: vec4(f32(i), 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
export const fs = fragment((v: VsOut) => lit(v.uv));
`,
      [refused('fragment', '@fragment export function fs(…)')],
    );
  });

  it('a mistake in its body is that mistake, said once beside the refusal', () => {
    bothSay(
      `"use typeshade";
export const fs = fragment((p: builtin<"position", vec4>): vec4 => vec4(nope(p.x), 0., 0., 1.));
`,
      [
        refused('fragment', '@fragment export function fs(…)'),
        'error TS8004 «nope» Unknown function "nope". Declare it in this file, or import it from another shader module.',
      ],
    );
  });

  it('a parameter of function type is the entry check it is under the attribute (Rule 8.18)', () => {
    const check =
      "An entry's parameters come from the pipeline, and a function is nothing the pipeline can supply: take the function in a helper the entry calls (Rule 8.18).";
    bothSay(
      `"use typeshade";
export const fs = fragment(function fs(f: (x: f32) => f32): vec4 {
  return vec4(1.);
});
`,
      [
        refused('fragment', '@fragment export function fs(…)'),
        `error TS8020 «f: (x: f32) => f32» ${check}`,
      ],
    );
    bothSay(
      `"use typeshade";
@fragment export function fs(f: (x: f32) => f32): vec4 {
  return vec4(1.);
}
`,
      [`error TS8020 «f: (x: f32) => f32» ${check}`],
    );
  });

  it('a generic entry is the entry check it is under the attribute (Rule 8.9)', () => {
    const check =
      '"fs" is an entry, which the pipeline calls with no type arguments, so a generic entry has no instance to compile: write its types out, or move the generic code into a helper the entry calls (Rule 8.9).';
    bothSay(
      `"use typeshade";
export const fs = fragment(function fs<T>(p: builtin<"position", vec4>): vec4 {
  return p;
});
`,
      [refused('fragment', '@fragment export function fs(…)'), `error TS8020 «T» ${check}`],
    );
    bothSay(
      `"use typeshade";
@fragment
export function fs<T>(p: builtin<"position", vec4>): vec4 {
  return p;
}
`,
      [`error TS8020 «T» ${check}`],
    );
  });

  it('the module has no host face until it is migrated, and then the face of the attribute form', () => {
    const called = `"use typeshade";
declare const data: storage<array<f32>, "read_write">;
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x, 0., 0., 1.);
});
export const main = compute([64], function main(gid: builtin<"global_invocation_id", vec3u>): void {
  data[gid.x] = 1.;
});
export const scale = workgroup_size([128], function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
});
`;
    const face = (source: string) =>
      hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    const refusedFace = face(called);
    expect(refusedFace.exports).toBeUndefined();
    expect(
      refusedFace.diagnostics
        .filter((d) => d.category === 'error')
        .map((d) => `${String(d.code)} «${called.slice(d.start, d.start + d.length)}»`),
    ).toEqual(['TS8028 «fragment»', 'TS8028 «compute»', 'TS8028 «workgroup_size»']);
    const kinds = Object.fromEntries(
      (face(migrateSource(called).text).exports ?? []).map((e) => [e.name, e.kind]),
    );
    expect(kinds).toEqual({ fs: 'fragment', main: 'compute', scale: 'kernel' });
  });
});

describe('the editor offers no call signature for a stage name (change 0140)', () => {
  const at = (source: string, after: string): { line: number; character: number } => {
    const lines = source.slice(0, source.indexOf(after) + after.length).split('\n');
    return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
  };
  const signatures = (source: string, after: string): string[] | undefined => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    return service.getSignatureHelp('a.ts', at(source, after))?.signatures.map((s) => s.label);
  };

  it('none inside a refused call, for each of the four names', () => {
    const source = `"use typeshade";
export const vs = vertex(function vs(): builtin<"position", vec4> { return vec4(0., 0., 0., 1.); });
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 { return p; });
export const main = compute([8], function main(): void {});
export const scale = workgroup_size([128], function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = 1.; }
});
`;
    for (const name of ['vertex', 'fragment', 'compute', 'workgroup_size'])
      expect(signatures(source, `${name}(`)).toBeUndefined();
  });

  it('the attribute keeps its signature, and a function of the file named vertex keeps its own', () => {
    expect(
      signatures(`"use typeshade";\n@compute([8]) export function main(): void {}\n`, '@compute('),
    ).toEqual([
      'compute(workgroupSize: readonly number[]): (target: Function, context?: unknown) => void',
      'compute(target: Function, context?: unknown): void',
    ]);
    expect(
      signatures(
        `"use typeshade";
function vertex(x: f32): f32 { return x; }
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(vertex(p.x), 0., 0., 1.);
}
`,
        'vec4(vertex(',
      ),
    ).toEqual(['vertex(x: f32): f32']);
  });
});
