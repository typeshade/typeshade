import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../core/testing/both-halves.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { mergeDiagnostics } from './diagnostics.js';
import type { TypeshadeDiagnostic } from './types.js';

const FS = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const FOR_IN =
  "for-in enumerates a JS object's keys, which a shader value does not have. Iterate an array with `for (const x of xs)`, or count with `for (let i = 0; i < n; i++)`.";

describe('a failed call knocks on through a unary operator', () => {
  it('reports the unknown function once when its result is negated and normalized', () => {
    bothRefuse(
      FS(
        'function f(v: vec3, w: vec2): vec3 {\n  return normalize(-foo(v, w));\n}',
        '  return vec4(f(vec3(1.), vec2(1.)), 1.);',
      ),
      'TS8004',
      'Unknown function "foo". Declare it in this file, or import it from another shader module.',
    );
  });
});

describe('a name TypeScript cannot find knocks on through an element read', () => {
  it('reports the name once when its element is multiplied and passed on', () => {
    bothRefuse(
      FS('', '  return vec4(normalize(foo[0] * 2.), 1.);'),
      'TS8022',
      'Unknown identifier "foo".',
    );
  });

  it('reports the name once when its element is read into a local first', () => {
    bothRefuse(
      FS('', '  const q = foo[0];\n  return vec4(normalize(q * 2.), 1.);'),
      'TS8022',
      'Unknown identifier "foo".',
    );
  });
});

describe('the head of a refused for-in is the compiler refusal, its body is not', () => {
  it('reports the head alone', () => {
    bothRefuse(FS('', '  for (const k in 1.) {\n  }\n  return vec4(1.);'), 'TS8013', FOR_IN);
  });

  it('keeps TypeScript on a mistake inside the body', () => {
    const halves = bothHalves(
      FS('', '  for (const k in 1.) {\n    const z: vec3 = 1.;\n  }\n  return vec4(1.);'),
    );
    expect(halves.compiler).toEqual([`typeshade TS8013: ${FOR_IN}`]);
    expect(halves.editor).toEqual([
      `typeshade TS8013: ${FOR_IN}`,
      "typescript 2322: Type 'number' is not assignable to type 'vec3'.",
    ]);
  });
});

describe('the merge reads an analysis of the same text only', () => {
  const text = FS('', '  return vec4(Bun);');
  const analysis = compileTsSource(text, { emit: false });
  const start = text.indexOf('Bun');
  const typescript: TypeshadeDiagnostic = {
    uri: 'a.ts',
    source: 'typescript',
    code: 2867,
    severity: 'error',
    message: 'Bun needs host typings.',
    span: { start, length: 3 },
    range: { start: { line: 3, character: 14 }, end: { line: 3, character: 17 } },
  };
  const compiler: TypeshadeDiagnostic = {
    ...typescript,
    source: 'typeshade',
    code: 'TS8022',
    message: 'Unknown identifier "Bun".',
  };

  it('merges the two reports of one mistake into the compiler one', () => {
    expect(
      mergeDiagnostics(analysis.sourceFile, [typescript], [compiler], analysis, undefined),
    ).toEqual([compiler]);
  });

  it('keeps both reports when the document changed after the analysis', () => {
    const edited = ts.createSourceFile('a.ts', `${text}\n`, ts.ScriptTarget.Latest, true);
    expect(mergeDiagnostics(edited, [typescript], [compiler], analysis, undefined)).toEqual([
      typescript,
      compiler,
    ]);
  });
});
