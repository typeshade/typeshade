// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.11 (docs/language-design.md; traced in reqs/).
//
// A host's draws and dispatches are type-checked against the bindings each entry reaches
// (change 0030, #408). The host view types the module's default export, its manifest, as
// `Pack<{ entry: bindings }>`, and the program runtime carries that type from `rt.load()` to each
// `draw` and `dispatch`. Before, `Bindings` was a record of anything: a misspelled binding, a
// missing field or a `vec3` for a `vec4` compiled, and the runtime refused it at the first draw.
// Each case here is a host file `tsc` reads against the generated view, resolved the way the
// documented `tsconfig` resolves it; the runtime's own refusals are unchanged
// (`src/runtime/runtime.test.ts`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { hostFace } from './host-face.js';

const VIEW_RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const RUNTIME = resolve(__dirname, '../../runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const MESH = `"use typeshade";
class View {
  viewProj: mat4x4;
  time: f32;
}
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
declare const view: uniform<View>;
declare const tint: uniform<vec4>;
declare const cells: storage<array<vec2>>;
declare const heights: storage<array<f32>, "read_write">;
declare const albedo: texture_2d<f32>;
declare const samp: sampler;
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const c = cells[i];
  return { pos: view.viewProj * vec4(c, 0., 1.), uv: c };
}
@fragment
export function fs(v: VsOut): vec4 {
  return textureSample(albedo, samp, v.uv) * tint * view.time;
}
@compute([64])
export function grow(@builtin("global_invocation_id") gid: vec3u): void {
  heights[gid.x] += 1.;
}
`;

/** The view of {@link MESH}, as the bundler's plugin writes it. */
function view(): string {
  const f = hostFace(MESH, { fileName: '/app/mesh.shade.ts', runtime: VIEW_RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f.view!;
}

const PRELUDE = `import mesh from './mesh.shade.ts';
import type { BindingsOf, Frame, Pack, RenderPass, Runtime, Texture, Sampler } from ${JSON.stringify(RUNTIME)};
import { resident } from ${JSON.stringify(RUNTIME)};
declare const rt: Runtime;
declare const pass: RenderPass;
declare const frame: Frame;
declare const tex: Texture;
declare const smp: Sampler;
const viewProj = new Float32Array(16);
`;

/** `tsc`'s errors on `body`, a host file's async function body, as `line: message`, the line
 *  counted in `body` from 1. */
function errorsOf(body: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-typed-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'mesh.shade.ts'), MESH);
  writeFileSync(join(dir, 'mesh.shade.typeshade.ts'), view());
  const host = `${PRELUDE}export async function main(): Promise<void> {\n${body}\n}\n`;
  writeFileSync(join(dir, 'app.ts'), host);
  const program = ts.createProgram([join(dir, 'app.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    skipLibCheck: true,
  });
  const first = PRELUDE.split('\n').length; // the line of `body`'s first line, from 1
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.endsWith('app.ts'))
    .map((d) => {
      const line = d.file!.getLineAndCharacterOfPosition(d.start!).line + 1 - first;
      return `${line}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}

const RENDER = `  const draw = await rt.load(mesh).render({ vertex: 'vs', fragment: 'fs' });`;
const BINDINGS = `{ view: { viewProj, time: 1 }, tint: [1, 1, 1, 1], cells: new Float32Array(6), albedo: tex, samp: smp }`;

describe('a draw and a dispatch are typed by the bindings each entry reaches (change 0030)', () => {
  it('compiles a draw and a dispatch that pass every binding, in each form a binding takes', () => {
    expect(
      errorsOf(`${RENDER}
  pass.draw(draw, ${BINDINGS}, { count: 3 });
  pass.draw(draw, { view: resident({ viewProj, time: 1 }), tint: new Float32Array(4), cells: resident(new Float32Array(6)), albedo: tex, samp: smp }, { count: 3 });
  const grow = await rt.load(mesh).compute('grow');
  frame.dispatch(grow, { heights: new Float32Array(64) }, 1);
  grow.dispatch(frame.encoder, { heights: resident(new Float32Array(64)) }, 1);
  const depth = await rt.load(mesh).render({ vertex: 'vs', fragment: null });
  pass.draw(depth, { view: { viewProj, time: 1 }, cells: new Float32Array(6) }, { count: 3 });
  const named: BindingsOf<typeof mesh, 'grow'> = { heights: new Float32Array(1) };
  void named;`),
    ).toEqual([]);
  });

  it('refuses a misspelled binding at the argument', () => {
    const errs = errorsOf(`${RENDER}
  pass.draw(draw, { veiw: { viewProj, time: 1 }, tint: [1, 1, 1, 1], cells: new Float32Array(6), albedo: tex, samp: smp }, { count: 3 });`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^2: .*'veiw'/);
  });

  it('refuses a binding left out, and a struct field left out', () => {
    const missing = errorsOf(`${RENDER}
  pass.draw(draw, { view: { viewProj, time: 1 }, tint: [1, 1, 1, 1], albedo: tex, samp: smp }, { count: 3 });`);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/^2: .*'cells'/);
    const field = errorsOf(`${RENDER}
  pass.draw(draw, { view: { viewProj }, tint: [1, 1, 1, 1], cells: new Float32Array(6), albedo: tex, samp: smp }, { count: 3 });`);
    expect(field).toHaveLength(1);
    expect(field[0]).toMatch(/^2: .*'time'/);
  });

  it('refuses a vec3 where the shader has a vec4', () => {
    const errs = errorsOf(`${RENDER}
  pass.draw(draw, { view: { viewProj, time: 1 }, tint: [1, 1, 1], cells: new Float32Array(6), albedo: tex, samp: smp }, { count: 3 });`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^2: /);
  });

  it('refuses an entry name the program does not have', () => {
    const errs = errorsOf(`  const p = rt.load(mesh);
  await p.compute('grwo');
  await p.render({ vertex: 'vs', fragment: 'frag' });`);
    expect(errs.map((e) => e.slice(0, 2))).toEqual(['2:', '3:']);
  });

  it('takes any bindings for an untyped manifest', () => {
    expect(
      errorsOf(`  const untyped = mesh as Pack;
  const draw = await rt.load(untyped).render();
  pass.draw(draw, { anything: 1 }, { count: 3 });
  frame.dispatch(await rt.load(untyped).compute(), { at: 'all' }, 1);`),
    ).toEqual([]);
  });
});
