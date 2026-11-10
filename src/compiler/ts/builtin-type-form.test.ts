// A built-in value takes its type from WGSL (change 0135, decision D1.2): `builtin<N>` writes
// no type, an option is its second argument, `clip_distances` keeps its type argument, and a
// written type that WGSL fixes is the migration form, warned once (`TS8028`). Each program is
// read by both halves (Rule 12.7): `compile()` for the diagnostics and the emit, the language
// service for its merged diagnostics and the hover.
//
// Verifies: Rule 6.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { WGSL_BUILTIN_NAMES, WGSL_BUILTIN_TYPES } from '../../core/sot.js';
import { authorTypeText } from './context.js';
import { BUILTIN_STAGE_RULES } from './builtin-check.js';

interface Said {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  /** The text the diagnostic underlines. */
  readonly at: string;
}

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });
// A module that writes `clip_distances` has no GLSL ES 3.00 form, which `compile()` says in a
// backend warning of its own (`TS8015`); it is no part of what this file asserts.
const compilerSays = (source: string): Said[] =>
  compiled(source)
    .diagnostics.filter((d) => d.code !== 'TS8015')
    .map((d) => ({
      category: d.category,
      code: String(d.code),
      message: d.message,
      at: source.slice(d.start, d.start + d.length),
    }));
const offsetOf = (source: string, p: { line: number; character: number }): number =>
  source.split('\n').slice(0, p.line).join('\n').length + (p.line === 0 ? 0 : 1) + p.character;
const editorSays = (source: string): Said[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => ({
    category: d.severity,
    code: String(d.code),
    message: d.message,
    at: source.slice(offsetOf(source, d.range.start), offsetOf(source, d.range.end)),
  }));
};
const hover = (source: string, needle: string): string => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  const before = source.slice(0, source.indexOf(needle)).split('\n');
  const h = service.getHover('a.ts', {
    line: before.length - 1,
    character: before[before.length - 1]!.length,
  });
  return h?.contents ?? '';
};
/** Both halves say exactly `expected`, in order. */
const bothSay = (source: string, expected: readonly Said[]): void => {
  expect(compilerSays(source)).toEqual(expected);
  expect(editorSays(source)).toEqual(expected);
};

const SHORT = `"use typeshade";
interface VsOut {
  pos: builtin<"position", { invariant: true }>;
  uv: location<0, vec2>;
}
@vertex
export function vs(vi: builtin<"vertex_index">, ii: builtin<"instance_index">): VsOut {
  const x = f32(vi) + f32(ii);
  return { pos: vec4(x, 0., 0., 1.), uv: vec2(0., 0.) };
}
@fragment
export function fs(v: VsOut, ff: builtin<"front_facing">): location<0, vec4> {
  return vec4(v.uv, ff ? 1. : 0., 1.);
}
`;

const LONG = SHORT.replace(
  'builtin<"position", { invariant: true }>',
  'builtin<"position", vec4, { invariant: true }>',
)
  .replace('builtin<"vertex_index">', 'builtin<"vertex_index", u32>')
  .replace('builtin<"instance_index">', 'builtin<"instance_index", u32>')
  .replace('builtin<"front_facing">', 'builtin<"front_facing", bool>');

describe('builtin<N> is the value WGSL defines for N, of the type WGSL gives it (change 0135)', () => {
  it('compiles with no diagnostic in either half, and emits the WGSL attribute and type', () => {
    bothSay(SHORT, []);
    const { wgsl, glsl } = compiled(SHORT);
    expect(wgsl).toContain('@invariant @builtin(position) pos: vec4<f32>,');
    expect(wgsl).toContain(
      'fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut',
    );
    expect(wgsl).toContain('fn fs(v: VsOut, @builtin(front_facing) ff: bool) -> @location(0)');
    expect(glsl).toBeDefined();
  });

  it('the hover shows the WGSL type the author did not write', () => {
    expect(hover(SHORT, 'vi:')).toContain('vi: u32');
    expect(hover(SHORT, 'ff:')).toContain('ff: bool');
    expect(hover(SHORT, 'pos:')).toContain('VsOut.pos: vec4<f32>');
  });

  it("the emit is the migration form's, byte for byte", () => {
    const short = compiled(SHORT);
    const long = compiled(LONG);
    expect(short.wgsl).toBe(long.wgsl);
    expect(JSON.stringify(short.glsl)).toBe(JSON.stringify(long.glsl));
  });

  // Every name with one type in WGSL, in the stage and direction WGSL gives it. The three
  // extension-gated names derive their capability from the use, so each compiles alone.
  for (const name of WGSL_BUILTIN_NAMES.filter((n) => n !== 'clip_distances')) {
    const rule = BUILTIN_STAGE_RULES[name]![0]!;
    const type = authorTypeText(WGSL_BUILTIN_TYPES[name as keyof typeof WGSL_BUILTIN_TYPES]);
    const source =
      rule.stage === 'compute'
        ? `"use typeshade";\n@compute([1])\nexport function main(v: builtin<"${name}">) { const x: ${type} = v; }\n`
        : rule.direction === 'input'
          ? `"use typeshade";\n@${rule.stage}\nexport function main(v: builtin<"${name}">): vec4 { const x: ${type} = v; return vec4(0.); }\n`
          : `"use typeshade";\ninterface Out { v: builtin<"${name}">; }\n@${rule.stage}\nexport function main(): Out { const x: ${type} = ${type === 'f32' ? '0.5' : type === 'u32' ? '1' : 'vec4(0.)'}; return { v: x }; }\n`;
    it(`builtin<"${name}"> is a ${type} to the compiler and to the editor`, () => {
      bothSay(source, []);
      const shown = type === 'vec4' ? 'vec4<f32>' : type === 'vec3u' ? 'vec3<u32>' : type;
      expect(hover(source, 'v:')).toContain(`v: ${shown}\n`);
    });
  }
});

describe('a written type that WGSL fixes is the migration form (TS8028 warning, D1.2)', () => {
  it('warns once on each written type, in both halves, and compiles', () => {
    const warning = (name: string, type: string, short: string): Said => ({
      category: 'warning',
      code: 'TS8028',
      message: `"${name}" has the type WGSL gives it, ${type}: write ${short}, or run "tshc migrate".`,
      at: type,
    });
    bothSay(LONG, [
      warning('position', 'vec4', 'builtin<"position", { invariant: true }>'),
      warning('vertex_index', 'u32', 'builtin<"vertex_index">'),
      warning('instance_index', 'u32', 'builtin<"instance_index">'),
      warning('front_facing', 'bool', 'builtin<"front_facing">'),
    ]);
    expect(compiled(LONG).wgsl).toBeDefined();
  });

  it("a written type that is not WGSL's keeps its TS8003, and no warning joins it", () => {
    const source = SHORT.replace('builtin<"vertex_index">', 'builtin<"vertex_index", f32>');
    bothSay(source, [
      {
        category: 'error',
        code: 'TS8003',
        message: 'Builtin "vertex_index" is "u32"; this declares it "f32".',
        at: '"vertex_index"',
      },
    ]);
  });
});

describe('clip_distances is the one name whose type the author chooses (D1.2)', () => {
  const CLIP = (type: string): string => `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  cd: ${type};
}
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  let out: VsOut = { pos: vec4(f32(vi), 0., 0., 1.), cd: [0., 0.] };
  out.cd[0] = 1.;
  out.pos.x = out.cd[1];
  return out;
}
`;

  it('builtin<"clip_distances", array<f32, N>> keeps its type, with no diagnostic', () => {
    const source = CLIP('builtin<"clip_distances", array<f32, 2>>');
    bothSay(source, []);
    expect(compiled(source).wgsl).toContain('@builtin(clip_distances) cd: array<f32, 2>,');
  });

  it('builtin<"clip_distances"> is refused with the one TS8003, in both halves', () => {
    // The ambient type reads it as `never`, and TypeScript's TS2322 on each write of the field
    // is dropped (Rule 12.4): the body sets `cd` in a literal, writes `out.cd[0]` and reads
    // `out.cd[1]`.
    bothSay(CLIP('builtin<"clip_distances">'), [
      {
        category: 'error',
        code: 'TS8003',
        message:
          'Builtin "clip_distances" has no single type: write builtin<"clip_distances", array<f32, N>> with N from 1 to 8.',
        at: 'builtin<"clip_distances">',
      },
    ]);
  });

  it('a name WGSL does not have, with no type, gets its one TS8024 in both halves', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"positon">;
}
@vertex
export function vs(vi: builtin<"vertx_index">): VsOut {
  return { pos: vec4(f32(vi), 0., 0., 1.) };
}
`;
    bothSay(source, [
      {
        category: 'error',
        code: 'TS8024',
        message: 'Unknown builtin "positon". Did you mean "position"?',
        at: '"positon"',
      },
      {
        category: 'error',
        code: 'TS8024',
        message: 'Unknown builtin "vertx_index". Did you mean "vertex_index"?',
        at: '"vertx_index"',
      },
    ]);
  });
});
