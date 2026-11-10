// #321 misc#10: a refused IO name owns its missing-attribute follow-ups.
// Verifies: Rule 6.6, Rule 12.1, Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const URI = '/io/main.shade.ts';
const LIB = '/io/lib.shade.ts';
const D = '"use typeshade";\n';
const UNKNOWN = 'Unknown builtin "positon". Did you mean "position"?';
const POSITION =
  '"vs" is a vertex entry, so what it returns has to carry the position: give "Out" a field typed builtin<"position">.';
type Expected = { code: string; message: string; at: string; uri?: string; length?: number };

function paired(body: string, expected: readonly Expected[], library?: string) {
  const files: Record<string, string> = { [URI]: D + body };
  if (library !== undefined) files[LIB] = D + library;
  const readDocument = (uri: string) => files[uri];
  const result = compile(files[URI]!, { fileName: URI, readDocument });
  const errors = result.diagnostics.filter((d) => d.category === 'error');
  const service = createTypeshadeLanguageService({ readDocument });
  for (const [uri, text] of Object.entries(files)) service.openDocument(uri, text);
  const editor = Object.keys(files).flatMap((uri) =>
    service
      .getDiagnostics(uri)
      .filter((d) => d.severity === 'error')
      .map((d) => ({ ...d, uri })),
  );
  for (const uri of Object.keys(files)) service.closeDocument(uri);
  expect(errors).toHaveLength(expected.length);
  expect(editor).toHaveLength(expected.length);
  for (const e of expected) {
    const uri = e.uri ?? URI;
    const source = files[uri]!;
    const start = source.indexOf(e.at);
    const length = e.length ?? e.at.length;
    expect(start).toBeGreaterThanOrEqual(0);
    const line = source.slice(0, start).split('\n').length - 1;
    const character = start - source.lastIndexOf('\n', start) - 1;
    expect(
      errors.find(
        (d) =>
          d.code === e.code && d.message === e.message && d.fileName === uri && d.start === start,
      ),
    ).toMatchObject({
      fileName: uri,
      start,
      length,
    });
    expect(
      editor.find(
        (d) =>
          d.code === e.code && d.message === e.message && d.uri === uri && d.span.start === start,
      ),
    ).toMatchObject({
      uri,
      span: { start, length },
      range: { start: { line, character }, end: { line, character: character + length } },
    });
  }
  if (expected.length === 0) expect(result.wgsl).toBeDefined();
  else expect(result.wgsl).toBeUndefined();
  return result;
}

const unknown = (uri?: string): Expected => ({
  code: 'TS8024',
  message: UNKNOWN,
  at: '"positon"',
  uri,
});
const modernEntry = '@vertex export function vs(): Out { return {pos: vec4(0.)}; }';
const legacyEntry = '@vertex export function vs(): Out { return {pos: vec4(0.)}; }';

describe('a refused entry IO name is one diagnostic', () => {
  it('keeps the legacy builtin sentence and its string span', () => {
    paired('class Out { @builtin("positon") pos: vec4; }\n' + legacyEntry, [unknown()]);
  });

  for (const declaration of [
    'class Out { pos: builtin<"positon", vec4>; }',
    'interface Out { pos: builtin<"positon", vec4>; }',
    'type Out = { pos: builtin<"positon", vec4> };',
    'class Base { pos: builtin<"positon", vec4>; } class Out extends Base {}',
    'class Base<T> { pos: builtin<"positon", T>; } class Out extends Base<vec4> {}',
  ]) {
    it(`keeps the modern builtin sentence through ${declaration}`, () => {
      paired(declaration + '\n' + modernEntry, [unknown()]);
    });
  }

  it('keeps an imported declaration as the diagnostic origin', () => {
    paired(
      'import { Out } from "./lib.shade.ts";\n' + modernEntry,
      [unknown(LIB)],
      'export class Out { pos: builtin<"positon", vec4>; }',
    );
  });

  for (const [declaration, type] of [
    ['export class Out<T> { pos: builtin<"positon", T>; }', 'Out<vec4>'],
    ['export interface Out { pos: builtin<"positon", vec4>; }', 'Out'],
    ['export type Out = { pos: builtin<"positon", vec4> };', 'Out'],
  ]) {
    it(`reports the imported unknown name in the library editor for ${declaration}`, () => {
      paired(
        'import { Out } from "./lib.shade.ts";\n' +
          `@vertex export function vs(): ${type} { return {pos: vec4(0.)}; }`,
        [unknown(LIB)],
        declaration,
      );
    });
  }

  it('reports a literal unknown name without collecting the unused generic layout', () => {
    paired(
      'class Unused<T> { pos: builtin<"positon", T>; }\nexport function f(): f32 { return 1.; }',
      [unknown()],
    );
  });

  it('keeps one unknown-name error for two actual generic instances', () => {
    paired(
      'class Out<T> { pos: builtin<"positon", T>; }\nexport function f(a: Out<f32>, b: Out<vec2>): f32 { return a.pos + b.pos.x; }',
      [unknown()],
    );
  });

  it('does not preflight a dependent builtin name before instantiation', () => {
    paired(
      'class Unused<N extends "position"> { pos: builtin<N, vec4>; }\nexport function f(): f32 { return 1.; }',
      [],
    );
  });

  it('does not preflight an unused generic field with a user type named builtin', () => {
    paired(
      'type builtin<N, T> = T; class Unused<T> { pos: builtin<"positon", T>; }\nexport function f(): f32 { return 1.; }',
      [],
    );
  });

  it('keeps two identical name refusals in their own files', () => {
    paired(
      'import { Other } from "./lib.shade.ts";\nclass Out extends Other { pos: builtin<"positon", vec4>; }\n@vertex export function vs(): Out { return {pos: vec4(0.),other: vec4(0.)}; }',
      [unknown(), unknown(LIB)],
      'export class Other { other: builtin<"positon", vec4>; }',
    );
  });

  it('keeps a modern parameter unknown name alone', () => {
    const body =
      '@vertex export function vs(i: builtin<"vertex_indx", u32>): vec4 { return vec4(f32(i)); }';
    paired(body, [
      {
        code: 'TS8024',
        message: 'Unknown builtin "vertex_indx". Did you mean "vertex_index"?',
        at: '"vertex_indx"',
      },
    ]);
  });

  it('does not call an unknown builtin a second invariant mistake', () => {
    paired('class Out { pos: builtin<"positon", vec4, {invariant: true}>; }\n' + modernEntry, [
      unknown(),
    ]);
  });

  it('keeps an unknown attribute name alone on a vertex output', () => {
    paired('class Out { @buitlin("position") pos: vec4; }\n' + legacyEntry, [
      {
        code: 'TS8028',
        message: 'Unknown attribute "@buitlin". Did you mean "@builtin"?',
        at: '@buitlin("position")',
      },
    ]);
  });

  it('keeps an unknown location attribute alone on a fragment input', () => {
    paired(
      'class In { @locaton(0) uv: vec2; }\n@fragment export function fs(input: In): vec4 { return vec4(input.uv,0.,1.); }',
      [
        {
          code: 'TS8028',
          message: 'Unknown attribute "@locaton". Did you mean "@location"?',
          at: '@locaton(0)',
        },
      ],
    );
  });

  it('numbers the sibling with no attribute, and says nothing more', () => {
    // A field with no attribute is a user-defined output, which the compiler numbers (Rule
    // 6.6, change 0135): before it was `TS8029` beside the refused name.
    const entry = '@vertex export function vs(): Out { return {pos: vec4(0.),uv: vec2(0.)}; }';
    paired('class Out { @builtin("positon") pos: vec4; uv: vec2; }\n' + entry, [unknown()]);
  });

  it('keeps an independent option argument error', () => {
    paired(
      'class Out { @builtin("positon") @interpolate("wrong") @invariant pos: vec4; }\n' +
        legacyEntry,
      [
        unknown(),
        {
          code: 'TS8028',
          message: 'interpolate type "wrong" is not one WGSL has: perspective, linear, flat.',
          at: '@interpolate("wrong")',
        },
      ],
    );
  });

  it('keeps a modern option argument error beside the name error', () => {
    paired('class Out { pos: builtin<"positon", vec4, {interpolate: "wrong"}>; }\n' + modernEntry, [
      unknown(),
      {
        code: 'TS8028',
        message: 'interpolate type "wrong" is not one WGSL has: perspective, linear, flat.',
        at: 'interpolate: "wrong"',
      },
    ]);
  });

  for (const attribute of ['@builtin("positon")', '@bogus']) {
    it(`keeps location type and missing position errors beside ${attribute}`, () => {
      const entry = '@vertex export function vs(): Out { return {uv: false}; }';
      paired(`class Out { ${attribute} @location(0) uv: bool; }\n` + entry, [
        attribute === '@bogus'
          ? {
              code: 'TS8028',
              message:
                'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, @builtin, @location, @interpolate, @invariant, @blend_src, @inout, @out.',
              at: '@bogus',
            }
          : unknown(),
        {
          code: 'TS8003',
          message:
            '"Out.uv" is at a location and is "bool"; a value passed between stages is a numeric scalar or a numeric vector. Send a u32 and compare it.',
          at: 'Out',
        },
        { code: 'TS8020', message: POSITION, at: entry },
      ]);
    });
  }

  it('keeps TypeScript constraints on a user type named builtin', () => {
    const source =
      D +
      'type builtin<N extends "good", T> = T; type Payload = builtin<"bad", f32>; export function f(): f32 { return 1.; }';
    const result = compile(source, { fileName: URI });
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument(URI, source);
    const errors = service.getDiagnostics(URI).filter((d) => d.severity === 'error');
    service.closeDocument(URI);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 2344,
      span: { start: source.indexOf('"bad"'), length: 5 },
    });
  });

  it('does not merge a collected user builtin constraint into the existing compiler homonym refusal', () => {
    // The collector's treatment of this authored alias as an IO attribute predates misc#10.
    // Its TS8024 must not absorb TypeScript's independent constraint on the user's alias.
    const source =
      D +
      'type builtin<N extends "good", T> = T; class Out { pos: builtin<"bad", vec4>; }\n' +
      modernEntry;
    const service = createTypeshadeLanguageService();
    service.openDocument(URI, source);
    const errors = service.getDiagnostics(URI).filter((d) => d.severity === 'error');
    service.closeDocument(URI);
    const compiled = compile(source, { fileName: URI }).diagnostics.filter(
      (d) => d.category === 'error',
    );
    expect(compiled.map((d) => d.code)).toEqual(['TS8024']);
    expect(errors.map((d) => d.code)).toEqual([2344, 'TS8024']);
    expect(errors[0]).toMatchObject({
      message: 'Type \'"bad"\' does not satisfy the constraint \'"good"\'.',
      span: { start: source.indexOf('"bad"'), length: 5 },
    });
  });

  it('keeps missing position beside a bad location value type', () => {
    const entry = '@vertex export function vs(): Out { return {uv: false}; }';
    paired('class Out { uv: location<0, bool>; }\n' + entry, [
      {
        code: 'TS8003',
        message:
          '"Out.uv" is at a location and is "bool"; a value passed between stages is a numeric scalar or a numeric vector. Send a u32 and compare it.',
        at: 'Out',
      },
      { code: 'TS8020', message: POSITION, at: entry },
    ]);
  });

  it('keeps missing position beside a bad interpolation option', () => {
    const entry = '@vertex export function vs(): Out { return {uv: vec2(0.)}; }';
    paired('class Out { @location(0) @interpolate("wrong") uv: vec2; }\n' + entry, [
      {
        code: 'TS8028',
        message: 'interpolate type "wrong" is not one WGSL has: perspective, linear, flat.',
        at: '@interpolate("wrong")',
      },
      { code: 'TS8020', message: POSITION, at: entry },
    ]);
  });

  for (const declaration of [
    'class Out { pos: builtin<"position">; }',
    'interface Out { pos: builtin<"position">; }',
    'type Out = { pos: builtin<"position"> };',
    'class Out { @builtin("position") pos: vec4; }',
  ]) {
    it(`preserves the valid position in ${declaration}`, () => {
      expect(paired(declaration + '\n' + modernEntry, []).wgsl).toContain('@builtin(position)');
    });
  }
});
