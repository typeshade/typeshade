import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile, reflect } from '../../index.js'
import { compileModule } from '../../core/oracle.js'

describe('declare uniform / storage', () => {
  it('binds declare const camera: uniform<f32>', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(x: f32): f32 {
        return x * camera;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings).toHaveLength(1)
    expect(r.bindings[0]).toMatchObject({ name: 'camera', space: 'uniform', binding: 0 })
    expect(r.wgsl).toMatch(/var<uniform>/)
  })

  it('treats declare let storage as read_write', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare let pixels: storage<f32>;
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({ name: 'pixels', space: 'storage', access: 'read_write' })
  })

  it('treats declare const storage as read', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const src: storage<f32>;
      export function f(): f32 { return src; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.bindings[0]).toMatchObject({ access: 'read' })
  })

  it('rejects writing a declare const uniform', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: uniform<f32>;
      export function f(): void { camera = 1.; }
    `)
    expect(r.diagnostics.some((d) => /read-only/.test(d.message))).toBe(true)
  })

  it('rejects declare const camera: Camera without a space', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const camera: f32;
      export function f(): f32 { return camera; }
    `)
    expect(r.diagnostics.some((d) => /uniform<T> or storage<T>/.test(d.message))).toBe(true)
  })
})

// ═══ A binding read is a `varref`, not a `constref` (#14) ═══
//
// Both were `BindingKind: 'module'` in the lowering scope, so `lowerIdentifier` gave a
// resource binding the shape the IR reserves for a module-scope CONSTANT. Every consumer
// that asks "which bindings does this stage reach" counts `varref` names, so the answer was
// always "none" — the GLSL writer dropped the uniform block while keeping the uses,
// `reflect()` reported no stages for any binding, and the CPU oracle could not resolve one
// at all. The arms below pin each of those three, because they failed in three different
// ways and a fix for one would not have shown up in the others.
describe('a binding is a module-scope var, not a const (#14)', () => {
  const src = `
    "use typeshade";
    const GAIN: f32 = 2.;
    declare const input: storage<array<f32>>;
    declare let output: storage<array<f32>>;
    @compute([64, 1, 1])
    export function k(@builtin("global_invocation_id") gid: vec3u): void {
      output[gid.x] = input[gid.x] * GAIN;
    }
  `

  it('lowers a binding read to varref and a module const read to constref', () => {
    const r = compileTsSource(src)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ops = new Map<string, string>()
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return void n.forEach(walk)
      if (!n || typeof n !== 'object') return
      const o = n as Record<string, unknown>
      if (typeof o['op'] === 'string' && typeof o['name'] === 'string') ops.set(o['name'], o['op'])
      Object.values(o).forEach(walk)
    }
    walk(r.funcs)
    // The two kinds are told apart, and each gets the shape its meaning calls for.
    expect(ops.get('input')).toBe('varref')
    expect(ops.get('output')).toBe('varref')
    expect(ops.get('GAIN')).toBe('constref')
  })

  it('reflect() names the stage that reaches each binding', () => {
    const stages = reflect(compile(src).module)
      .bindGroups.flatMap((g) => g.entries.map((e) => `${e.name}:${e.stages.join('|')}`))
      .sort()
    // `stages: []` on every row is what a host turns into `visibility: 0`.
    expect(stages).toEqual(['input:compute', 'output:compute'])
  })

  it('the CPU oracle resolves a binding through setBinding', () => {
    const { module } = compile(src)
    const cm = compileModule(module)
    const out = [0, 0, 0, 0]
    cm.setBinding('input', [1, 2, 3, 4])
    cm.setBinding('output', out)
    // Before the fix this threw `shader-dsl/cpu: unknown const input`: the oracle looks a
    // constref up in the CONST map, and a binding is never in it.
    cm.fns['k']!([2, 0, 0])
    expect(out).toEqual([0, 0, 6, 0])
  })
})

/** Assigning to something that cannot be assigned to, through BOTH paths that raise it:
 *  `lowerAssign` (statement.ts) for `x = v`, and `lowerUpdate` (control.ts) for `x++`.
 *
 *  Table-driven because the two paths drifted. `readOnlyPhrase` exists because three sites
 *  disagreed about what a `declare const input: storage<…>` is, and `lowerUpdate` separately
 *  answered "it is declared with const" for a name that was never declared — it passed
 *  `binding?.kind` into the phrase helper, and `undefined` took the helper's default. The
 *  columns are the point: for one target, both paths must say the same thing. */
describe('cannot assign to — the phrase names what the target actually is', () => {
  const CASES: readonly { what: string; head: string; target: string; expected: string }[] = [
    {
      what: 'a resource binding',
      head: 'declare const u: uniform<f32>',
      target: 'u',
      expected: 'Cannot assign to "u" — it is a read-only resource.',
    },
    {
      what: 'a module const',
      head: 'const K: f32 = 2.',
      target: 'K',
      expected: 'Cannot assign to "K" — it is a module const.',
    },
    {
      what: 'a local const',
      head: '',
      target: 'a',
      expected: 'Cannot assign to "a" — it is declared with const.',
    },
    {
      what: 'a name that does not exist',
      head: '',
      target: 'nope',
      expected: 'Cannot assign to unknown name "nope".',
    },
  ]

  /** `x = 1.` and `x++` in the same program shape, so the only variable is the path. */
  const program = (head: string, stmt: string): string =>
    `"use typeshade"\n${head}\n\n@fragment\nexport function fs(): vec4 {\n  const a = 1.\n  ${stmt}\n  return vec4(a, 0., 0., 1.)\n}\n`

  for (const c of CASES) {
    for (const [path, stmt] of [
      ['assignment', `${c.target} = 1.`],
      ['increment', `${c.target}++`],
    ] as const) {
      it(`${c.what}, by ${path}`, () => {
        const errors = compileTsSource(program(c.head, stmt)).diagnostics.filter(
          (d) => d.category === 'error',
        )
        expect(errors.map((d) => d.message)).toContain(c.expected)
      })
    }
  }

  it('both paths report an unknown name under the same code', () => {
    const code = (stmt: string): string | undefined =>
      compileTsSource(program('', stmt))
        .diagnostics.filter((d) => d.category === 'error')
        .find((d) => d.message.includes('unknown name'))?.code
    // TS8022 (UNKNOWN_NAME) on both. `lowerAssign` used to raise TS8018 (ASSIGN_TARGET),
    // which is the code for a target of the wrong SHAPE, not for one that names nothing.
    expect(code('nope = 1.')).toBe('TS8022')
    expect(code('nope++')).toBe(code('nope = 1.'))
  })
})
