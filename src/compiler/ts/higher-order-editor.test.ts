import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('the editor agrees', () => {
  it('reports nothing on a program that hands functions over, to a function and to a fold', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'a.ts',
      `"use typeshade";
type Op = (a: f32, b: f32) => f32;
function fold3(op: Op, a: f32, b: f32, c: f32): f32 {
  return op(op(a, b), c);
}
function repeat3(body: () => void): void {
  for (let i = 0; i < 3; i++) {
    body();
  }
}
export function run(k: f32): f32 {
  let s = 0.;
  repeat3(() => {
    s += k;
  });
  const xs = array<f32, 3>(1., 2., 3.);
  const z = zip(xs, xs, (a, b) => a * b);
  const hit = xs.some((x) => x > k) || !xs.some((x) => x < 0.);
  return fold3((a, b) => a * b, k, 3., 4.) + s + z.reduce((a, b) => a + b) + min(xs) + max(xs) + (hit ? 1. : 0.);
}
@fragment export function fs(): vec4 {
  return vec4(run(2.), 0., 0., 1.);
}
`,
    );
    expect(
      service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([]);
  });
});
