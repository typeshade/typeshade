import type { ModuleDecl } from '../../core/ir/nodes.js';
import { typeKey } from '../../core/ir/types.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslStages } from '../../core/backends/glsl.js';
import { vertexLayoutOf, type GpuVertexLayout } from './vertex-layout.js';

/** One resource slot, flattened for a host that has to build a bind-group layout without
 *  walking the IR. `type` is the `typeKey` spelling (`vec4<f32>`, `array<f32>`,
 *  `texture_2d<f32>`), not an IR node, so it compares as a string and survives serialisation.
 *  `access` is present only where the space has more than one mode — a uniform has none. */
export interface PackBinding {
  readonly name: string;
  readonly space: string;
  readonly group: number;
  readonly binding: number;
  readonly access?: 'read' | 'read_write';
  readonly type: string;
}

/** A shader entry point: the emitted function name to pass to the GPU API, and the stage it
 *  runs at. Only functions that carry a stage appear; a plain helper function is emitted into
 *  the shader but is not an entry a pipeline can name. */
export interface PackEntry {
  readonly name: string;
  readonly stage: string;
}

/** The serialisable result of {@link packModule} — see there for what each field promises and
 *  why `glsl` may be absent. */
export interface Pack {
  readonly wgsl: string;
  readonly glsl?: { readonly vertex: string; readonly fragment: string };
  readonly bindings: readonly PackBinding[];
  readonly vertexLayout?: GpuVertexLayout;
  readonly entries: readonly PackEntry[];
  readonly structs: readonly {
    readonly name: string;
    readonly fields: readonly { name: string; type: string }[];
  }[];
}

/** Everything a host needs to create a pipeline from a compiled module, in one plain object:
 *  the WGSL, the GLSL ES 3.00 vertex/fragment pair when the module has both stages and the
 *  backend can spell them, the bind-group table, the vertex layout, the entry points and
 *  their stages, and the struct field types.
 *
 *  It is JSON — no IR nodes, no functions, no class instances — so it survives
 *  `JSON.stringify`, a bundler's virtual module, a worker `postMessage` and an HTTP response
 *  unchanged. That is what it is for: `compile()` hands back a live `ModuleDecl` for callers
 *  that go on to run passes over it, and this is the flattened form for callers that only
 *  want to hand the result to a GPU API or serialise it.
 *
 *  GLSL is best-effort and its absence is not an error: a module using a feature the GLSL ES
 *  3.00 writer cannot express (a storage buffer shape, a compute entry) comes back with
 *  `glsl` undefined and a complete `wgsl`. Check the field rather than assuming both. */
export function packModule(m: ModuleDecl): Pack {
  const wgsl = emitModule(m);
  const hasVs = m.funcs.some((f) => f.stage === 'vertex');
  const hasFs = m.funcs.some((f) => f.stage === 'fragment');
  let glsl: Pack['glsl'];
  if (hasVs && hasFs) {
    try {
      glsl = emitGlslStages(m);
    } catch {
      glsl = undefined;
    }
  }
  return {
    wgsl,
    glsl,
    bindings: m.bindings.map((b) => ({
      name: b.name,
      space: b.space,
      group: b.group,
      binding: b.binding,
      access: b.access,
      type: typeKey(b.type),
    })),
    vertexLayout: vertexLayoutOf(m),
    entries: m.funcs.filter((f) => f.stage).map((f) => ({ name: f.name, stage: f.stage! })),
    structs: m.structs.map((s) => ({
      name: s.name,
      fields: s.fields.map((f) => ({ name: f.name, type: typeKey(f.type) })),
    })),
  };
}

/** {@link packModule} already stringified, pretty-printed at two spaces — the form a build
 *  step writes to disk or embeds in a generated module. */
export function packJson(m: ModuleDecl): string {
  return JSON.stringify(packModule(m), null, 2);
}
