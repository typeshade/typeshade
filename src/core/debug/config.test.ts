// ═══ One launch configuration, resolved against the entry's own declarations ═══
//
// `docs/debugging.md` §4 fixes the shape an IDE, the Playground and a headless test all pass
// in. What this file holds is the half that makes the shape worth having: the resolver checks
// the configuration against what the shader ACTUALLY declares, so a misspelled builtin or a
// uniform of the wrong shape is a sentence before the run starts rather than a silent zero
// that answers a question about a different program.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from '../../compiler/ts/source-file.js'
import type { ModuleDecl } from '../ir/index.js'
import type { CpuValue } from '../cpu-runtime.js'
import {
  DEBUG_LAUNCH_SCHEMA,
  DebugConfigError,
  startDebugSessionFromConfig,
  type DebugLaunchConfig,
} from './config.js'

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: 'cfg.shade.ts' })
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  }
}

/** Everything a failing configuration said, so a test can assert on one sentence. */
function problems(m: ModuleDecl, config: DebugLaunchConfig): readonly string[] {
  try {
    startDebugSessionFromConfig(m, config)
  } catch (e) {
    expect(e).toBeInstanceOf(DebugConfigError)
    return (e as DebugConfigError).problems
  }
  throw new Error('expected the configuration to be rejected')
}

const VERTEX = `"use typeshade"
class VsIn {
  @location(0) position: vec3
  @location(1) uv: vec2
}
class Clip {
  @builtin("position") pos: vec4
}
@vertex
export function vs(@builtin("vertex_index") i: u32, vin: VsIn): Clip {
  return { pos: vec4(vin.position, f32(i) + vin.uv.x) }
}
`

const COMPUTE = `"use typeshade"
declare const params: uniform<vec4u>
declare let out: storage<array<f32>>
@compute([8, 1, 1])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
  @builtin("local_invocation_index") li: u32,
): void {
  out[gid.x] = f32(lid.x) * 100. + f32(wid.x) * 10. + f32(li) + f32(params.x)
}
`

describe('the invocation is keyed by what the entry declares', () => {
  it('fills a builtin, a struct field and a location input by name', () => {
    const m = compiled(VERTEX)
    const s = startDebugSessionFromConfig(m, {
      entry: 'vs',
      precision: 'f64',
      invocation: { vertex_index: 3, inputs: { position: [1, 2, 3], uv: [0.5, 0.25] } },
    })
    s.continue()
    expect(s.result).toEqual({ pos: [1, 2, 3, 3.5] })
  })

  it('anything omitted reads as the zero of its type', () => {
    const m = compiled(VERTEX)
    const s = startDebugSessionFromConfig(m, { entry: 'vs', precision: 'f64' })
    s.continue()
    expect(s.result).toEqual({ pos: [0, 0, 0, 0] })
  })

  it('a misspelled builtin is named, with the ones the entry does declare', () => {
    const m = compiled(VERTEX)
    const [msg] = problems(m, { entry: 'vs', invocation: { vertexIndex: 3 } })
    expect(msg).toContain('"vertexIndex" is not a builtin this entry declares')
    expect(msg).toContain('vs declares vertex_index')
    expect(msg).toContain('a @location input goes under "inputs"')
  })

  it('an input the entry does not take is named too', () => {
    const m = compiled(VERTEX)
    const [msg] = problems(m, { entry: 'vs', invocation: { inputs: { colour: [1, 0, 0] } } })
    expect(msg).toContain('"colour" is not an input this entry declares')
    expect(msg).toContain('vs takes position, uv')
  })

  it('a value of the wrong shape names both shapes', () => {
    const m = compiled(VERTEX)
    expect(problems(m, { entry: 'vs', invocation: { inputs: { uv: [0.5] } } })[0]).toBe(
      'input "uv": expected vec2<f32> (2 numbers), got an array of 1',
    )
    expect(problems(m, { entry: 'vs', invocation: { vertex_index: [0] } })[0]).toContain(
      'builtin "vertex_index": expected u32 (a number), got an array of 1',
    )
  })

  it('every fault is reported together, before a statement runs', () => {
    const m = compiled(VERTEX)
    const found = problems(m, {
      entry: 'vs',
      invocation: { vertexIndex: 3, inputs: { uv: [0.5] } },
    })
    expect(found).toHaveLength(2)
  })

  it('an unknown entry names the ones the module has', () => {
    const m = compiled(VERTEX)
    expect(problems(m, { entry: 'nope' })[0]).toBe('no function "nope" in module; it declares vs')
  })
})

describe('a compute invocation derives the ids it can', () => {
  const m = compiled(COMPUTE)
  /** Twelve outputs, so a `gid.x` of 11 has somewhere to land. */
  const params: CpuValue = [1, 0, 0, 0]
  const zeros = (): number[] => new Array<number>(12).fill(0)

  it('derives local id, workgroup id and index from the global id', () => {
    // gid.x = 11 with @compute([8,1,1]): workgroup 1, local 3, index 3.
    const out = zeros()
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [11, 0, 0] },
      bindings: { params, out },
    })
    const frame = s.pause!.frames[0]!
    expect(frame.locals.get('lid')).toEqual([3, 0, 0])
    expect(frame.locals.get('wid')).toEqual([1, 0, 0])
    expect(frame.locals.get('li')).toBe(3)
    s.continue()
    expect(out[11]).toBe(3 * 100 + 1 * 10 + 3 + 1)
  })

  it('an explicit id overrides the derivation', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [11, 0, 0], local_invocation_index: 3 },
      bindings: { params, out: zeros() },
    })
    expect(s.pause!.frames[0]!.locals.get('li')).toBe(3)
  })

  it('an id that contradicts the derivation is refused, not silently picked', () => {
    const [msg] = problems(m, {
      entry: 'k',
      invocation: { global_invocation_id: [11, 0, 0], workgroup_id: [0, 0, 0] },
      bindings: { params, out: zeros() },
    })
    expect(msg).toContain('"workgroup_id" is [0,0,0]')
    expect(msg).toContain('@compute([8, 1, 1]) derives [1,0,0]')
    expect(msg).toContain('not a pair that disagrees')
  })

  it('a storage write lands in the array the caller passed, not in a copy', () => {
    // The resolver validates a binding and hands the SAME array to the session: a storage
    // buffer is the host's own memory, and a debug run that wrote into a copy would look
    // correct from inside and change nothing the caller can read.
    const out = zeros()
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [5, 0, 0] },
      bindings: { params, out },
    })
    expect(s.pause!.bindings.get('out')).toBe(out)
    s.continue()
    expect(out[5]).toBe(5 * 100 + 0 * 10 + 5 + 1)
  })

  it('a global id alone is the common case and needs nothing else', () => {
    const out = zeros()
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [0, 0, 0] },
      bindings: { params, out },
    })
    s.continue()
    expect(out[0]).toBe(1)
  })
})

describe('bindings are checked against their declared types', () => {
  const m = compiled(COMPUTE)

  it('a runtime-sized array has no zero, so omitting it is named', () => {
    const [msg] = problems(m, { entry: 'k', bindings: { params: [1, 0, 0, 0] } })
    expect(msg).toContain('binding "out" is array<f32>')
    expect(msg).toContain("only the host's buffer knows")
  })

  it('a sized binding omitted reads as its zero', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      bindings: { out: [0] },
    })
    expect(s.pause!.bindings.get('params')).toEqual([0, 0, 0, 0])
  })

  it('a binding of the wrong shape names both shapes', () => {
    expect(problems(m, { entry: 'k', bindings: { params: 1, out: [0] } })[0]).toBe(
      'binding "params": expected vec4<u32> (4 numbers), got number 1',
    )
  })

  it('a binding the module does not declare is named', () => {
    const [msg] = problems(m, { entry: 'k', bindings: { camera: 1, out: [0] } })
    expect(msg).toContain('"camera" is not a binding this module declares')
    expect(msg).toContain('it declares out, params')
  })

  it('a struct binding fills the fields that were left out', () => {
    const withStruct = compiled(`"use typeshade"
class Camera {
  view: vec4
  pos: vec3
}
declare const camera: uniform<Camera>
export function f(): f32 {
  return camera.pos.x + camera.view.w
}
`)
    const s = startDebugSessionFromConfig(withStruct, {
      entry: 'f',
      precision: 'f64',
      bindings: { camera: { pos: [7, 0, 0] } },
    })
    expect(s.pause!.bindings.get('camera')).toEqual({ view: [0, 0, 0, 0], pos: [7, 0, 0] })
    s.continue()
    expect(s.result).toBe(7)
  })

  it('a field the struct does not have is named', () => {
    const withStruct = compiled(`"use typeshade"
class Camera {
  pos: vec3
}
declare const camera: uniform<Camera>
export function f(): f32 {
  return camera.pos.x
}
`)
    const [msg] = problems(withStruct, { entry: 'f', bindings: { camera: { posn: [1, 2, 3] } } })
    expect(msg).toContain('has no field "posn"')
    expect(msg).toContain('its fields are pos')
  })
})

describe('the rest of the configuration', () => {
  const m = compiled(VERTEX)

  it('stopOnEntry false runs to the first breakpoint instead', () => {
    const line = VERTEX.split('\n').findIndex((l) => l.includes('return { pos:'))
    const s = startDebugSessionFromConfig(m, {
      entry: 'vs',
      stopOnEntry: false,
      breakpoints: [{ line }],
    })
    expect(s.pause!.reason).toBe('breakpoint')
  })

  it('stopOnEntry false with no breakpoint runs the invocation to the end', () => {
    const s = startDebugSessionFromConfig(m, { entry: 'vs', stopOnEntry: false })
    expect(s.done).toBe(true)
  })

  it("derivatives 'quad' is refused by name, not silently read as zero", () => {
    const [msg] = problems(m, { entry: 'vs', derivatives: 'quad' })
    expect(msg).toContain("derivatives: 'quad' is not implemented")
    expect(msg).toContain('decision 4')
  })

  it('the launch envelope fields are accepted and ignored', () => {
    const s = startDebugSessionFromConfig(m, {
      type: 'typeshade',
      request: 'launch',
      name: 'vs at 0',
      program: '${workspaceFolder}/x.shade.ts',
      entry: 'vs',
    })
    expect(s.pause).toBeDefined()
  })
})

describe('the JSON Schema and the interface describe the same object', () => {
  it('names every field of DebugLaunchConfig and nothing else', () => {
    // The anti-drift arm: an extension contributes DEBUG_LAUNCH_SCHEMA as its launch.json
    // shape, so a field added to the interface and forgotten here would be a config the
    // resolver accepts and the IDE marks as an error.
    const declared = Object.keys(
      (DEBUG_LAUNCH_SCHEMA as { properties: Record<string, unknown> }).properties,
    ).sort()
    // Kept as a literal rather than derived: a type has no runtime keys, so this list IS the
    // statement, and adding a field to the interface without touching it fails below.
    expect(declared).toEqual(
      [
        'bindings',
        'breakpoints',
        'derivatives',
        'entry',
        'invocation',
        'name',
        'precision',
        'program',
        'request',
        'stopOnEntry',
        'type',
      ].sort(),
    )
  })

  it('requires the one field that has no default', () => {
    expect((DEBUG_LAUNCH_SCHEMA as { required: string[] }).required).toEqual(['entry'])
  })

  it("offers only the derivative mode that exists, so an IDE cannot suggest 'quad'", () => {
    const props = (DEBUG_LAUNCH_SCHEMA as { properties: Record<string, { enum?: string[] }> })
      .properties
    expect(props.derivatives!.enum).toEqual(['zero'])
    expect(props.precision!.enum).toEqual(['f32', 'f64'])
  })
})
