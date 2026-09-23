// ═══ Shader source writes its `;`, and writing it changes nothing ═══
//
// Three claims. `insertSemicolons` puts a `;` exactly where a statement ended by ASI and
// nowhere else. Every shader source in this repository (scripts/semicolons.ts says which) is
// already written that way, so a `;` left out of an example, a doc block or an inline test
// source fails `bun run test` with the command that fixes it. And the compiler still reads the
// source without them: each example, with its `;` taken back out, emits the same WGSL. The
// corpus writes every `;`, so without that last check nothing would compile an ASI source.
//
// format:semicolons skip — the inputs below are the ASI sources the pass is tested on.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { insertSemicolons } from './semicolons.js'
import { compile } from './compile.js'
import { emitModule } from '../../core/backends/wgsl.js'
import { scanShaderSources } from '../../../scripts/semicolons.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const fix = (src: string): string => {
  const r = insertSemicolons(src)
  if (!r.ok) throw new Error(r.message)
  return r.text
}

describe('insertSemicolons', () => {
  it('ends each statement the parser ended at a line break', () => {
    expect(
      fix(`"use typeshade"
const K: f32 = 2.
declare const scale: uniform<f32>
type Meters = f32
export function f(x: f32): f32 {
  let y = x * K
  y += 1.
  if (y > 3.) return y
  for (let i = 0; i < 4; i++) {
    if (i === 2) break
    if (i === 3) continue
  }
  do { y -= 1. } while (y > 0.)
  return y
}
`),
    ).toBe(`"use typeshade";
const K: f32 = 2.;
declare const scale: uniform<f32>;
type Meters = f32;
export function f(x: f32): f32 {
  let y = x * K;
  y += 1.;
  if (y > 3.) return y;
  for (let i = 0; i < 4; i++) {
    if (i === 2) break;
    if (i === 3) continue;
  }
  do { y -= 1.; } while (y > 0.);
  return y;
}
`)
  })

  it('ends class fields, interface and type-literal members, and a body-less declaration', () => {
    expect(
      fix(`class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}
interface Light {
  dir: vec3
  power: f32
}
type Camera = { view: mat4, pos: vec3 }
declare function sample(uv: vec2): vec4
`),
    ).toBe(`class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
interface Light {
  dir: vec3;
  power: f32;
}
type Camera = { view: mat4, pos: vec3 };
declare function sample(uv: vec2): vec4;
`)
  })

  it('puts the `;` before a trailing comment, not after it', () => {
    expect(fix('const a = 1 // one\nconst b = 2 /* two */\n')).toBe(
      'const a = 1; // one\nconst b = 2; /* two */\n',
    )
  })

  it('never splits a statement ASI did not end', () => {
    // The second line continues the first (a call, then an index): one statement, one `;`.
    expect(fix('const a = f\n(1)\nconst b = xs\n[0]\n')).toBe(
      'const a = f\n(1);\nconst b = xs\n[0];\n',
    )
  })

  it('leaves a source that already has every `;` byte for byte as it was', () => {
    const src = '"use typeshade";\nexport function f(): f32 {\n  return 1.;\n}\n'
    const r = insertSemicolons(src)
    expect(r.ok && r.inserted).toEqual([])
    expect(fix(fix('let a = 1\nlet b = 2\n'))).toBe('let a = 1;\nlet b = 2;\n')
  })

  it('refuses a source that does not parse, with where', () => {
    const r = insertSemicolons('const a = \nconst b = 2\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.at).toBeGreaterThan(0)
  })
})

describe('the shader source in this repository', () => {
  it('writes every `;` (run `bun run format:semicolons` to add the missing ones)', () => {
    const findings = scanShaderSources(ROOT).flatMap((r) => [
      ...r.errors,
      ...(r.lines.length > 0 ? [`${r.file}: line ${r.lines.join(', ')}`] : []),
    ])
    expect(findings).toEqual([])
  })
})

/** Take back out every `;` that ends a line, where leaving it to ASI means the same thing. */
function stripSemicolons(src: string): string {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true)
  const drop: number[] = []
  const visit = (node: ts.Node): void => {
    const last = node.getLastToken(sf)
    if (
      last?.kind === ts.SyntaxKind.SemicolonToken &&
      !ts.isForStatement(node.parent) &&
      /^[ \t]*(\/\/[^\n]*)?\n\s*([^\s([`+\-/]|$)/.test(src.slice(last.getEnd()))
    ) {
      drop.push(last.getStart(sf))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  let out = src
  for (const at of [...new Set(drop)].sort((a, b) => b - a))
    out = out.slice(0, at) + out.slice(at + 1)
  return out
}

describe('a source that leaves its `;` to ASI compiles to the same shader', () => {
  const dir = join(ROOT, 'examples')
  const files = readdirSync(dir).filter((f) => f.endsWith('.shade.ts'))

  it.each(files)('%s', (file) => {
    const src = readFileSync(join(dir, file), 'utf8')
    const asi = stripSemicolons(src)
    expect(asi).not.toBe(src)
    expect(fix(asi)).toBe(src)
    const written = compile(src)
    const bare = compile(asi)
    const codes = (r: typeof written) => r.diagnostics.map((d) => d.code)
    expect(codes(bare)).toEqual(codes(written))
    if (!written.diagnostics.some((d) => d.category === 'error')) {
      expect(emitModule(bare.module)).toBe(emitModule(written.module))
    }
  })
})
