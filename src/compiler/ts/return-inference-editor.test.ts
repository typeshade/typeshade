import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('the editor agrees', () => {
  it('reports nothing on a program that writes no return types', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'a.ts',
      `"use typeshade";
class Rng {
  seed: u32 = u32(1);
  next() {
    this.seed = this.seed * u32(1664525) + u32(1013904223);
    return f32(this.seed >> u32(8)) / 16777216.;
  }
  get unit() {
    return 1.;
  }
}
function twice(x: f32) {
  return x * 2.;
}
// A product of vectors, which TypeScript types \`number\`: the service writes the compiler's
// \`vec2\` into what TypeScript reads (#162), so \`.y\` on it is no TS2339.
function spin(p: vec2) {
  return p * mat2x2(0., 1., -1., 0.) * 0.5;
}
export function run(k: f32) {
  let r = new Rng();
  const next = () => r.next();
  const f = (x: f32) => twice(x) + k;
  return f(next()) + r.unit + spin(vec2(k)).y;
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
