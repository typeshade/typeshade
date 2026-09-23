// ═══ One launch configuration, resolved against the entry's own declarations ═══
//
// `docs/debugging.md` §4 fixes the shape an IDE, the Playground and a headless test all pass
// in. What this file holds is the half that makes the shape worth having: the resolver checks
// the configuration against what the shader ACTUALLY declares, so a misspelled builtin or a
// uniform of the wrong shape is a sentence before the run starts rather than a silent zero
// that answers a question about a different program.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import type { FuncDecl, ModuleDecl, StructDecl } from '../ir/index.js';
import { f32T, samplerT, texture2dfT, u32T, vec2fT, vec4fT } from '../ir/types.js';
import type { CpuValue } from '../cpu-runtime.js';
import {
  DEBUG_LAUNCH_SCHEMA,
  DebugConfigError,
  resolveBindings,
  resolveInvocation,
  startDebugSessionFromConfig,
  type DebugLaunchConfig,
} from './config.js';
import { startDebugSessionFromConfig as publicStart } from '../../debug.js';

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: 'cfg.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  };
}

/** Everything a failing configuration said, so a test can assert on one sentence. */
function problems(m: ModuleDecl, config: DebugLaunchConfig): readonly string[] {
  try {
    startDebugSessionFromConfig(m, config);
  } catch (e) {
    expect(e).toBeInstanceOf(DebugConfigError);
    return (e as DebugConfigError).problems;
  }
  throw new Error('expected the configuration to be rejected');
}

const VERTEX = `"use typeshade";
class VsIn {
  @location(0) position: vec3;
  @location(1) uv: vec2;
}
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32, vin: VsIn): Clip {
  return { pos: vec4(vin.position, f32(i) + vin.uv.x) };
}
`;

const COMPUTE = `"use typeshade";
declare const params: uniform<vec4u>;
declare const out: storage<array<f32>, "read_write">;
@compute([8, 1, 1])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
  @builtin("local_invocation_index") li: u32,
): void {
  out[gid.x] = f32(lid.x) * 100. + f32(wid.x) * 10. + f32(li) + f32(params.x);
}
`;

describe('the invocation is keyed by what the entry declares', () => {
  it('fills a builtin, a struct field and a location input by name', () => {
    const m = compiled(VERTEX);
    const s = startDebugSessionFromConfig(m, {
      entry: 'vs',
      precision: 'f64',
      invocation: { vertex_index: 3, inputs: { position: [1, 2, 3], uv: [0.5, 0.25] } },
    });
    s.continue();
    expect(s.result).toEqual({ pos: [1, 2, 3, 3.5] });
  });

  it('anything omitted reads as the zero of its type', () => {
    const m = compiled(VERTEX);
    const s = startDebugSessionFromConfig(m, { entry: 'vs', precision: 'f64' });
    s.continue();
    expect(s.result).toEqual({ pos: [0, 0, 0, 0] });
  });

  it('a misspelled builtin is named, with the ones the entry does declare', () => {
    const m = compiled(VERTEX);
    const [msg] = problems(m, { entry: 'vs', invocation: { vertexIndex: 3 } });
    expect(msg).toContain('"vertexIndex" is not a builtin this entry declares');
    expect(msg).toContain('vs declares vertex_index');
    expect(msg).toContain('a @location input goes under "inputs"');
  });

  it('an input the entry does not take is named too', () => {
    const m = compiled(VERTEX);
    const [msg] = problems(m, { entry: 'vs', invocation: { inputs: { colour: [1, 0, 0] } } });
    expect(msg).toContain('"colour" is not an input this entry declares');
    expect(msg).toContain('vs takes position, uv');
  });

  it('a value of the wrong shape names both shapes', () => {
    const m = compiled(VERTEX);
    expect(problems(m, { entry: 'vs', invocation: { inputs: { uv: [0.5] } } })[0]).toBe(
      'input "uv": expected vec2<f32> (2 numbers), got an array of 1',
    );
    expect(problems(m, { entry: 'vs', invocation: { vertex_index: [0] } })[0]).toContain(
      'builtin "vertex_index": expected u32 (a number), got an array of 1',
    );
  });

  it('every fault is reported together, before a statement runs', () => {
    const m = compiled(VERTEX);
    const found = problems(m, {
      entry: 'vs',
      invocation: { vertexIndex: 3, inputs: { uv: [0.5] } },
    });
    expect(found).toHaveLength(2);
  });

  it('an unknown entry names the ones the module has', () => {
    const m = compiled(VERTEX);
    expect(problems(m, { entry: 'nope' })[0]).toBe('no function "nope" in module; it declares vs');
  });
});

describe('a compute invocation derives the ids it can', () => {
  const m = compiled(COMPUTE);
  /** Twelve outputs, so a `gid.x` of 11 has somewhere to land. */
  const params: CpuValue = [1, 0, 0, 0];
  const zeros = (): number[] => new Array<number>(12).fill(0);

  it('derives local id, workgroup id and index from the global id', () => {
    // gid.x = 11 with @compute([8,1,1]): workgroup 1, local 3, index 3.
    const out = zeros();
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [11, 0, 0] },
      bindings: { params, out },
    });
    const frame = s.pause!.frames[0]!;
    expect(frame.locals.get('lid')).toEqual([3, 0, 0]);
    expect(frame.locals.get('wid')).toEqual([1, 0, 0]);
    expect(frame.locals.get('li')).toBe(3);
    s.continue();
    expect(out[11]).toBe(3 * 100 + 1 * 10 + 3 + 1);
  });

  it('derives them per axis for a two-dimensional workgroup', () => {
    // gid (9, 3) with @compute([8, 8]): workgroup (1, 0), local (1, 3), index 1 + 3 * 8.
    const m2 = compiled(COMPUTE.replace('@compute([8, 1, 1])', '@compute([8, 8])'));
    const s = startDebugSessionFromConfig(m2, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [9, 3, 0] },
      bindings: { params, out: zeros() },
    });
    const frame = s.pause!.frames[0]!;
    expect(frame.locals.get('lid')).toEqual([1, 3, 0]);
    expect(frame.locals.get('wid')).toEqual([1, 0, 0]);
    expect(frame.locals.get('li')).toBe(25);
  });

  it('an explicit id overrides the derivation', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [11, 0, 0], local_invocation_index: 3 },
      bindings: { params, out: zeros() },
    });
    expect(s.pause!.frames[0]!.locals.get('li')).toBe(3);
  });

  it('an id that contradicts the derivation is refused, not silently picked', () => {
    const [msg] = problems(m, {
      entry: 'k',
      invocation: { global_invocation_id: [11, 0, 0], workgroup_id: [0, 0, 0] },
      bindings: { params, out: zeros() },
    });
    expect(msg).toContain('"workgroup_id" is [0,0,0]');
    expect(msg).toContain('@compute([8, 1, 1]) derives [1,0,0]');
    expect(msg).toContain('not a pair that disagrees');
  });

  it('a storage write lands in the array the caller passed, not in a copy', () => {
    // The resolver validates a binding and hands the SAME array to the session: a storage
    // buffer is the host's own memory, and a debug run that wrote into a copy would look
    // correct from inside and change nothing the caller can read.
    const out = zeros();
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [5, 0, 0] },
      bindings: { params, out },
    });
    expect(s.pause!.bindings.get('out')).toBe(out);
    s.continue();
    expect(out[5]).toBe(5 * 100 + 0 * 10 + 5 + 1);
  });

  it('a global id alone is the common case and needs nothing else', () => {
    const out = zeros();
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation: { global_invocation_id: [0, 0, 0] },
      bindings: { params, out },
    });
    s.continue();
    expect(out[0]).toBe(1);
  });
});

describe('bindings are checked against their declared types', () => {
  const m = compiled(COMPUTE);

  it('a runtime-sized array has no zero, so omitting it is named', () => {
    const [msg] = problems(m, { entry: 'k', bindings: { params: [1, 0, 0, 0] } });
    expect(msg).toContain('binding "out" is array<f32>');
    expect(msg).toContain("only the host's buffer knows");
  });

  it('a sized binding omitted reads as its zero', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      bindings: { out: [0] },
    });
    expect(s.pause!.bindings.get('params')).toEqual([0, 0, 0, 0]);
  });

  it('a binding of the wrong shape names both shapes', () => {
    expect(problems(m, { entry: 'k', bindings: { params: 1, out: [0] } })[0]).toBe(
      'binding "params": expected vec4<u32> (4 numbers), got number 1',
    );
  });

  it('a binding the module does not declare is named', () => {
    const [msg] = problems(m, { entry: 'k', bindings: { camera: 1, out: [0] } });
    expect(msg).toContain('"camera" is not a binding this module declares');
    expect(msg).toContain('it declares out, params');
  });

  it('a struct binding fills the fields that were left out', () => {
    const withStruct = compiled(`"use typeshade";
class Camera {
  view: vec4;
  pos: vec3;
}
declare const camera: uniform<Camera>;
export function f(): f32 {
  return camera.pos.x + camera.view.w;
}
`);
    const s = startDebugSessionFromConfig(withStruct, {
      entry: 'f',
      precision: 'f64',
      bindings: { camera: { pos: [7, 0, 0] } },
    });
    expect(s.pause!.bindings.get('camera')).toEqual({ view: [0, 0, 0, 0], pos: [7, 0, 0] });
    s.continue();
    expect(s.result).toBe(7);
  });

  it('a field the struct does not have is named', () => {
    const withStruct = compiled(`"use typeshade";
class Camera {
  pos: vec3;
}
declare const camera: uniform<Camera>;
export function f(): f32 {
  return camera.pos.x;
}
`);
    const [msg] = problems(withStruct, { entry: 'f', bindings: { camera: { posn: [1, 2, 3] } } });
    expect(msg).toContain('has no field "posn"');
    expect(msg).toContain('its fields are pos');
  });
});

describe('the rest of the configuration', () => {
  const m = compiled(VERTEX);

  it('stopOnEntry false runs to the first breakpoint instead', () => {
    // On a TWO-statement entry, so the two arms can disagree. The old fixture put the
    // breakpoint on `vs`'s only statement, which is also the entry stop, so the test passed
    // with `stopOnEntry` ignored entirely: since #35 the entry pause reports `'breakpoint'`
    // when one is armed on it, and both arms reported the same thing.
    const src = `"use typeshade";
export function f(a: f32): f32 {
  const first = a * 2.;
  const second = first + 1.;
  return second;
}
`;
    const two = compiled(src);
    const line = src.split('\n').findIndex((l) => l.includes('const second'));
    const stopped = startDebugSessionFromConfig(two, { entry: 'f', breakpoints: [{ line }] });
    expect(stopped.pause!.reason).toBe('entry');
    expect(stopped.pause!.span.line).toBe(2);

    const ran = startDebugSessionFromConfig(two, {
      entry: 'f',
      stopOnEntry: false,
      breakpoints: [{ line }],
    });
    expect(ran.pause!.reason).toBe('breakpoint');
    expect(ran.pause!.span.line).toBe(line);
  });

  it('stopOnEntry false with no breakpoint runs the invocation to the end', () => {
    const s = startDebugSessionFromConfig(m, { entry: 'vs', stopOnEntry: false });
    expect(s.done).toBe(true);
  });

  it("derivatives 'quad' is refused by name, not silently read as zero", () => {
    const [msg] = problems(m, { entry: 'vs', derivatives: 'quad' });
    expect(msg).toContain("derivatives: 'quad' is not implemented");
    expect(msg).toContain('decision 4');
  });

  it('the launch envelope fields are accepted and ignored', () => {
    const s = startDebugSessionFromConfig(m, {
      type: 'typeshade',
      request: 'launch',
      name: 'vs at 0',
      program: '${workspaceFolder}/x.shade.ts',
      entry: 'vs',
    });
    expect(s.pause).toBeDefined();
  });
});

describe('the JSON Schema and the interface describe the same object', () => {
  it('names every field of DebugLaunchConfig and nothing else', () => {
    // The anti-drift arm: an extension contributes DEBUG_LAUNCH_SCHEMA as its launch.json
    // shape, so a field added to the interface and forgotten here would be a config the
    // resolver accepts and the IDE marks as an error.
    const declared = Object.keys(
      (DEBUG_LAUNCH_SCHEMA as { properties: Record<string, unknown> }).properties,
    ).sort();
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
    );
  });

  it('requires the one field that has no default', () => {
    expect((DEBUG_LAUNCH_SCHEMA as { required: string[] }).required).toEqual(['entry']);
  });

  it("offers only the derivative mode that exists, so an IDE cannot suggest 'quad'", () => {
    const props = (DEBUG_LAUNCH_SCHEMA as { properties: Record<string, { enum?: string[] }> })
      .properties;
    expect(props.derivatives!.enum).toEqual(['zero']);
    expect(props.precision!.enum).toEqual(['f32', 'f64']);
  });
});

// ═══ What the first review of this PR found, each with the test that would have caught it ═══

const FRAGMENT = `"use typeshade";
@fragment
export function fs(@builtin("position") pos: vec4, @builtin("front_facing") ff: bool): vec4 {
  const ndc = pos.xyz / pos.w;
  let face = 0.;
  if (ff) {
    face = 1.;
  }
  return vec4(ndc.x, face, 0., 1.);
}
`;

const NWG = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([8])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("num_workgroups") nwg: vec3u,
): void {
  out[gid.x] = f32(nwg.x) * 100. + f32(nwg.y);
}
`;

describe('num_workgroups comes from the dispatch, which is not an invocation id', () => {
  const m = compiled(NWG);
  const ran = (invocation: DebugLaunchConfig['invocation']): number => {
    const out = [0, 0, 0, 0];
    const s = startDebugSessionFromConfig(m, {
      entry: 'k',
      precision: 'f64',
      invocation,
      bindings: { out },
    });
    s.continue();
    return out[0]!;
  };

  it('defaults to one workgroup, not to zero', () => {
    // Zero is the default every other omitted input gets, and it is the one value a dispatch
    // can never have: a guard like `gid.x < num_workgroups.x * 8u` would take the empty branch
    // on every invocation and the kernel would look like one that does nothing.
    expect(ran({ global_invocation_id: [0, 0, 0] })).toBe(101);
  });

  it('reads the dispatch when one is given', () => {
    expect(ran({ global_invocation_id: [0, 0, 0], dispatch: [2, 3, 4] })).toBe(203);
  });

  it('a supplied num_workgroups wins, and an omitted dispatch does not argue with it', () => {
    // A default cannot contradict anything, which is what separates this from the ids derived
    // from global_invocation_id.
    expect(ran({ global_invocation_id: [0, 0, 0], num_workgroups: [7, 1, 1] })).toBe(701);
  });

  it('a dispatch that contradicts a supplied num_workgroups is refused', () => {
    const [msg] = problems(m, {
      entry: 'k',
      invocation: {
        global_invocation_id: [0, 0, 0],
        dispatch: [2, 1, 1],
        num_workgroups: [7, 1, 1],
      },
      bindings: { out: [0, 0, 0, 0] },
    });
    expect(msg).toContain('"num_workgroups" is [7,1,1], but dispatch is [2,1,1]');
    expect(msg).toContain('not a pair that disagrees');
  });

  it('a dispatch of zero workgroups is refused, since it runs nothing', () => {
    const [msg] = problems(m, {
      entry: 'k',
      invocation: { global_invocation_id: [0, 0, 0], dispatch: [0, 1, 1] },
      bindings: { out: [0, 0, 0, 0] },
    });
    expect(msg).toContain('"dispatch" must be positive');
  });

  it('dispatch is not scanned as a builtin, and a misspelled builtin still is', () => {
    expect(
      problems(m, {
        entry: 'k',
        invocation: { globalInvocationId: [0, 0, 0] },
        bindings: { out: [0, 0, 0, 0] },
      })[0],
    ).toContain('"globalInvocationId" is not a builtin this entry declares');
  });

  it('the schema declares it, so launch.json completion offers it', () => {
    const invocation = (DEBUG_LAUNCH_SCHEMA.properties as Record<string, Record<string, unknown>>)
      .invocation!;
    const props = invocation.properties as Record<string, Record<string, unknown>>;
    expect(props.dispatch!.default).toEqual([1, 1, 1]);
    expect(props.dispatch!.minItems).toBe(3);
  });
});

describe('a fragment default is a value an invocation could have had', () => {
  const m = compiled(FRAGMENT);

  it('position.w is 1, so the default run is not a division by zero', () => {
    // The zero of a vec4 puts 0 in w, and w is the perspective divisor, so every
    // perspective-divided value in a default fragment run came back NaN and read as a bug in
    // the shader. front_facing false is the other one: a back-facing fragment is the case a
    // single-sided draw never runs.
    const s = startDebugSessionFromConfig(m, { entry: 'fs', precision: 'f64' });
    s.continue();
    expect(s.result).toEqual([0, 1, 0, 1]);
  });

  it('and a supplied value still wins', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'fs',
      precision: 'f64',
      invocation: { position: [4, 0, 0, 2], front_facing: false },
    });
    s.continue();
    expect(s.result).toEqual([2, 0, 0, 1]);
  });
});

describe('only the bindings the entry reaches are judged', () => {
  // Hand-built, because a texture cannot be declared in `"use typeshade"` at all yet: the
  // type map has no spelling for one, which is exactly what docs/debugging.md §2.4 says. The
  // registered `texture-array-lod` example is the same shape, authored through `fn()`.
  const textured = (): ModuleDecl => {
    const vs: FuncDecl = {
      name: 'vs_full',
      params: [{ name: 'i', type: u32T, builtin: 'vertex_index' }],
      ret: vec4fT,
      stage: 'vertex',
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: vec4fT,
            args: [
              { op: 'call', type: f32T, fn: 'f32', args: [{ op: 'param', type: u32T, name: 'i' }] },
              { op: 'lit', type: f32T, value: 0 },
              { op: 'lit', type: f32T, value: 0 },
              { op: 'lit', type: f32T, value: 1 },
            ],
          },
        },
      ],
    };
    const fs: FuncDecl = {
      name: 'fs_atlas',
      params: [],
      ret: vec4fT,
      stage: 'fragment',
      body: [
        {
          s: 'return',
          expr: {
            op: 'call',
            type: vec4fT,
            fn: 'textureSample',
            args: [
              { op: 'varref', type: texture2dfT, name: 'atlas' },
              { op: 'varref', type: samplerT, name: 'samp' },
              {
                op: 'construct',
                type: vec2fT,
                args: [
                  { op: 'lit', type: f32T, value: 0 },
                  { op: 'lit', type: f32T, value: 0 },
                ],
              },
            ],
          },
        },
      ],
    };
    return {
      consts: [],
      structs: [],
      bindings: [
        { group: 0, binding: 0, name: 'atlas', space: 'uniform', type: texture2dfT },
        { group: 0, binding: 1, name: 'samp', space: 'uniform', type: samplerT },
      ],
      funcs: [vs, fs],
    };
  };

  it('a vertex entry runs in a module that also declares a texture it never reads', () => {
    // A module is a compilation unit, not a run. Refusing this entry was refusing over a fact
    // about a sibling, and `startDebugSession` had always run it.
    const s = startDebugSessionFromConfig(textured(), {
      entry: 'vs_full',
      precision: 'f64',
      invocation: { vertex_index: 2 },
    });
    s.continue();
    expect(s.result).toEqual([2, 0, 0, 1]);
  });

  it('an entry that does read one is still refused, by name', () => {
    const [msg] = problems(textured(), { entry: 'fs_atlas', derivatives: 'zero' });
    expect(msg).toContain('binding "atlas"');
    expect(msg).toContain('a CPU run cannot supply');
  });
});

describe('the guards a malformed declaration needs', () => {
  it('a scalar global_invocation_id is reported, not a raw TypeError', () => {
    // A number has no `.map`, and this used to die inside the resolver with a stack trace
    // naming neither the configuration nor the shader.
    //
    // The front end now refuses this shape at the authoring line (§53: every `@builtin(...)`
    // id but `clip_distances` has one type, and `global_invocation_id` is `vec3<u32>`), so
    // the malformed module is built by retyping the parameter on the IR. The resolver guard
    // is what is under test, and a hand-built or pass-produced module can still reach it.
    const good = compiled(`"use typeshade";
@compute([8])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  let x: u32 = gid.x;
}
`);
    const m: ModuleDecl = {
      ...good,
      funcs: good.funcs.map((f) => ({
        ...f,
        params: f.params.map((p) =>
          p.builtin === 'global_invocation_id' ? { ...p, type: u32T } : p,
        ),
      })),
    };
    const [msg] = problems(m, { entry: 'k', invocation: { global_invocation_id: 3 } });
    expect(msg).toContain('"global_invocation_id" is declared u32');
    expect(msg).toContain('declare it as a vec3u or supply each id explicitly');
  });

  it('an unknown top-level key is named rather than ignored', () => {
    const m = compiled(VERTEX);
    const [msg] = problems(m, { entry: 'vs', stopOnentry: false } as never);
    expect(msg).toContain('"stopOnentry" is not a launch configuration key');
    expect(msg).toContain('stopOnEntry');
  });

  it('an Object.prototype name is not read off the prototype chain', () => {
    // `bindings: {}` has a `constructor`, and reading it with `given[name]` found the function
    // rather than `undefined`, so a binding named `constructor` would have been "supplied".
    const m = compiled(`"use typeshade";
declare const constructor: uniform<f32>;
@fragment
export function fs(): vec4 {
  return vec4(constructor, 0., 0., 1.);
}
`);
    const s = startDebugSessionFromConfig(m, { entry: 'fs', precision: 'f64' });
    s.continue();
    expect(s.result).toEqual([0, 0, 0, 1]);
  });
});

describe('two parameters that declare the same field name', () => {
  const COLLIDE = `"use typeshade";
class A {
  @location(0) v: vec2;
}
class B {
  @location(1) v: vec3;
}
@vertex
export function vs(a: A, b: B): vec4 {
  return vec4(a.v, b.v.x, b.v.y);
}
`;

  it('the bare name is refused, with both spellings that would work', () => {
    // It used to be accepted: one `v` was checked against whichever type won the map and then
    // written into BOTH parameters, so `vec4(a.v, b.v.x, b.v.y)` came back with five elements.
    const m = compiled(COLLIDE);
    const [msg] = problems(m, { entry: 'vs', invocation: { inputs: { v: [1, 2, 3] } } });
    expect(msg).toContain('"v" is declared by more than one parameter of vs (a, b)');
    expect(msg).toContain('"a.v" or "b.v"');
  });

  it('the qualified spelling reaches one parameter each, at its own type', () => {
    const m = compiled(COLLIDE);
    const s = startDebugSessionFromConfig(m, {
      entry: 'vs',
      precision: 'f64',
      invocation: { inputs: { 'a.v': [1, 2], 'b.v': [7, 8, 9] } },
    });
    s.continue();
    expect(s.result).toEqual([1, 2, 7, 8]);
  });

  it('and is checked against that parameter, not the other one', () => {
    const m = compiled(COLLIDE);
    expect(problems(m, { entry: 'vs', invocation: { inputs: { 'a.v': [1, 2, 3] } } })[0]).toBe(
      'input "a.v": expected vec2<f32> (2 numbers), got an array of 3',
    );
  });

  it('an unambiguous bare name still works, which is the common case', () => {
    const m = compiled(VERTEX);
    const s = startDebugSessionFromConfig(m, {
      entry: 'vs',
      precision: 'f64',
      invocation: { inputs: { position: [1, 2, 3], uv: [0.5, 0] } },
    });
    s.continue();
    expect(s.result).toEqual({ pos: [1, 2, 3, 0.5] });
  });
});

describe('a bare @location parameter, through the public typeshade/debug entry', () => {
  // Regression: `declaredInputs` keyed a bare parameter's slot `uv.uv` (owner and field are
  // both the parameter's name) while the run read it back as `uv`, so the documented
  // `"inputs": { "uv": [0.5, 0.25] }` was accepted, then dropped, and the run saw zeros.
  const BARE = `"use typeshade";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(uv, 0., 1.);
}
`;
  const MIXED = `"use typeshade";
class S {
  @location(1) uv: vec2;
}
@fragment
export function fs(@location(0) uv: vec2, s: S): vec4 {
  return vec4(uv, s.uv);
}
`;

  it('the value given under the parameter name reaches the run', () => {
    const s = publicStart(compiled(BARE), {
      entry: 'fs',
      precision: 'f64',
      invocation: { inputs: { uv: [0.5, 0.25] } },
    });
    s.continue();
    expect(s.result).toEqual([0.5, 0.25, 0, 1]);
  });

  it('an unknown input names the parameter as it is spelled, not "uv.uv"', () => {
    let problemsSeen: readonly string[] = [];
    try {
      publicStart(compiled(BARE), { entry: 'fs', invocation: { inputs: { st: [0, 0] } } });
    } catch (e) {
      problemsSeen = (e as DebugConfigError).problems;
    }
    expect(problemsSeen).toEqual(['"st" is not an input this entry declares; fs takes uv']);
  });

  it('beside a struct field of the same name, the bare name is the parameter and "s.uv" the field', () => {
    const s = publicStart(compiled(MIXED), {
      entry: 'fs',
      precision: 'f64',
      invocation: { inputs: { uv: [1, 2], 's.uv': [3, 4] } },
    });
    s.continue();
    expect(s.result).toEqual([1, 2, 3, 4]);
  });
});

describe('the two resolvers on their own, as an adapter that is not starting a session uses them', () => {
  const structsOf = (m: ModuleDecl): Map<string, StructDecl> =>
    new Map(m.structs.map((s) => [s.name, s]));
  const entryOf = (m: ModuleDecl, name: string): FuncDecl => m.funcs.find((f) => f.name === name)!;

  // `startDebugSessionFromConfig` throws on the first problem list it collects, so everything
  // asserted above reads these two functions through that throw. They are exported in their
  // own right, which means an adapter can call them to VALIDATE a configuration without
  // starting anything, and that use has its own contract: report into the array it was given,
  // return a usable value anyway, and never throw.

  it('resolveInvocation reports into the caller array and still returns one argument per parameter', () => {
    const m = compiled(VERTEX);
    const problems: string[] = [];
    const args = resolveInvocation(
      entryOf(m, 'vs'),
      { vertexIndex: 3, vertex_index: [1, 2] } as never,
      structsOf(m),
      problems,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('"vertexIndex" is not a builtin this entry declares');
    expect(problems[1]).toContain('builtin "vertex_index"');
    // It did not throw, and what came back is still positional and still complete: the two
    // parameters of `vs`, each standing in at the zero of its own type.
    expect(args).toEqual([0, { position: [0, 0, 0], uv: [0, 0] }]);
  });

  it('resolveInvocation returns the arguments in the entry parameter order', () => {
    const m = compiled(VERTEX);
    const problems: string[] = [];
    const args = resolveInvocation(
      entryOf(m, 'vs'),
      { vertex_index: 7, inputs: { position: [1, 2, 3] } },
      structsOf(m),
      problems,
    );
    expect(problems).toEqual([]);
    expect(args).toEqual([7, { position: [1, 2, 3], uv: [0, 0] }]);
  });

  const TWO_BINDINGS = `"use typeshade";
declare const near: uniform<f32>;
declare const far: uniform<f32>;
export function f(a: f32): f32 {
  return a * near;
}
`;

  it('resolveBindings without an entry resolves every declared binding, reached or not', () => {
    // The arm `startDebugSessionFromConfig` never takes, because it always knows its entry.
    // A caller validating a configuration against a whole module has no entry to pass, and
    // for that caller a binding no entry reaches is still a binding to check.
    const m = compiled(TWO_BINDINGS);
    const problems: string[] = [];
    const out = resolveBindings(m, { near: 1 }, structsOf(m), problems);
    expect(problems).toEqual([]);
    expect(out).toEqual({ near: 1, far: 0 });
  });

  it('and with one, narrows to what that entry reads', () => {
    const m = compiled(TWO_BINDINGS);
    const problems: string[] = [];
    const out = resolveBindings(m, { near: 1 }, structsOf(m), problems, entryOf(m, 'f'));
    expect(problems).toEqual([]);
    expect(out).toEqual({ near: 1 });
  });

  it('a binding the module does not declare is reported even when it is the only one given', () => {
    const m = compiled(TWO_BINDINGS);
    const problems: string[] = [];
    resolveBindings(m, { nera: 1 }, structsOf(m), problems, entryOf(m, 'f'));
    expect(problems).toEqual([
      '"nera" is not a binding this module declares; it declares far, near',
    ]);
  });

  it('an omitted runtime-sized array has no zero to stand in, and says so', () => {
    // `zeroValueOf` would hand back `[]`, and the kernel would then index past the end of it
    // and read `undefined` as a number. Only the host buffer knows the length.
    const m = compiled(COMPUTE);
    const problems: string[] = [];
    resolveBindings(m, { params: [0, 0, 0, 0] }, structsOf(m), problems, entryOf(m, 'k'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('binding "out" is array<f32>');
    expect(problems[0]).toContain("whose length only the host's buffer knows");
  });
});
