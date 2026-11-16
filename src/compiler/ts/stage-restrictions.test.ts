import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function paired(
  source: string,
  messages: readonly (string | { readonly code: string; readonly message: string })[],
): void {
  const file = 'stage-boundary.shade.ts';
  const result = compile(source, { fileName: file });
  const service = createTypeshadeLanguageService();
  service.openDocument(file, source);
  const expected = messages.map((message) =>
    typeof message === 'string' ? { code: 'TS8099', message } : message,
  );
  expect(result.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual(expected);
  expect(service.getDiagnostics(file).map(({ code, message }) => ({ code, message }))).toEqual(
    expected,
  );
  if (messages.length === 0) expect(result.wgsl).toBeDefined();
}

describe('entry-stage validation after function lowering', () => {
  it('reports a shared restriction once at the nearest helper in each entry call graph', () => {
    paired(
      `"use typeshade";
function deepDerivative(x: f32): f32 { return dpdx(x); }
function viaDeep(x: f32): f32 { return deepDerivative(x); }
function nearDerivative(x: f32): f32 { return dpdx(x); }
@vertex export function vs(): vec4 {
  return vec4(viaDeep(1.) + nearDerivative(2.));
}
@compute([1]) export function cs(): void { nearDerivative(3.); }
`,
      [
        '"dpdx" is only valid in a fragment shader; "nearDerivative" is reachable from the vertex entry "vs".',
        '"dpdx" is only valid in a fragment shader; "nearDerivative" is reachable from the compute entry "cs".',
      ],
    );
  });

  it('keeps both restriction families in the same source-ordered diagnostic sequence', () => {
    paired(
      `"use typeshade";
function barrierHelper(): void { workgroupBarrier(); }
function derivativeHelper(x: f32): f32 { return dpdx(x); }
@vertex export function vs(): vec4 {
  barrierHelper();
  return vec4(derivativeHelper(1.));
}
`,
      [
        {
          code: 'TS8034',
          message:
            'workgroupBarrier() belongs in a compute entry or a function it calls; a vertex entry has no workgroup to wait for.',
        },
        '"dpdx" is only valid in a fragment shader; "derivativeHelper" is reachable from the vertex entry "vs".',
      ],
    );
  });

  it('accepts an unreachable derivative helper beside a vertex entry', () => {
    paired(
      `"use typeshade";
function unusedDerivative(x: f32): f32 { return dpdx(x); }
@vertex export function vs(): vec4 { return vec4(1.); }
`,
      [],
    );
  });

  it('follows a declared function with a builtin name without classifying it as the builtin', () => {
    paired(
      `"use typeshade";
function dpdx(x: f32): f32 { return x + 1.; }
@vertex export function vs(): vec4 { return vec4(dpdx(1.)); }
`,
      [],
    );
  });
});
