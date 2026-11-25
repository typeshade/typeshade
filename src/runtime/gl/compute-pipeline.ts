import { describe, Misfit, readInto } from '../../core/host-entry.js';
import { runGlCompute } from '../../core/gl-compute.js';
import {
  layoutFromPack,
  type PackBinding,
  type PackEntry,
  type PackGlCompute,
} from '../../core/manifest-types.js';
import {
  decide,
  layoutKind,
  residentState,
  tentatively,
  type ResidentArrayState,
} from '../../core/resident.js';
import { hostSite } from '../../core/submission.js';
import { at, CallWords, workgroupsOf, type Bindings, type ComputePipeline } from '../program.js';
import { GlTextureImpl, samplerOf, textureOf } from '../gl-draw.js';
import { storageOf, packWords, type Given, type GlPipelineOwner } from './binding-values.js';
import { GlFrameImpl } from './frame.js';

export class GlComputePipelineImpl implements ComputePipeline {
  constructor(
    private readonly program: GlPipelineOwner,
    private readonly e: PackEntry,
    private readonly gl: PackGlCompute,
    readonly workgroupShape: readonly [number, number, number],
  ) {}

  get entry(): string {
    return this.e.name;
  }

  dispatch(target: object, bindings: Bindings, workgroups: number | readonly number[]): void {
    if (!(target instanceof GlFrameImpl))
      throw new TypeError(
        `dispatch() on WebGL2 records into a frame of the runtime, rt.frame(); got ${describe(target)}.`,
      );
    const wg = workgroupsOf(this.e, workgroups);
    const given = tentatively(() => this.#bind(bindings));
    const run = async (): Promise<void> => {
      const memory: Record<string, Uint32Array> = {};
      const uniforms: Record<string, unknown> = {};
      for (const [name, g] of given) {
        if (g.kind === 'words') memory[name] = g.inPlace === true ? g.words : g.words.slice();
        else if (g.kind === 'uniform') uniforms[name] = g.value;
        else if (g.kind === 'texture' || g.kind === 'sampler' || g.kind === 'storage') continue;
        else {
          await g.state.sync();
          if (this.#space(name) === 'uniform') uniforms[name] = g.state.host;
          else memory[name] = packWords(g.layout, g.state.host, name);
        }
      }
      const rt = this.program.rt;
      const textures: Record<string, { texture: WebGLTexture; sampler: WebGLSampler }> = {};
      for (const t of this.gl.textures ?? []) {
        const tex = given.get(t.name);
        const smp = t.sampler === null ? undefined : given.get(t.sampler);
        if (tex?.kind !== 'texture') continue;
        textures[t.name] = {
          texture: tex.texture as WebGLTexture,
          sampler: (smp?.kind === 'sampler'
            ? smp.sampler
            : rt.rhi.toNative(rt.nearest)) as WebGLSampler,
        };
      }
      const storageTextures: Record<
        string,
        { texture: WebGLTexture; width: number; height: number }
      > = {};
      for (const t of this.gl.storageTextures ?? []) {
        const g = given.get(t.name);
        if (g?.kind === 'storage')
          storageTextures[t.name] = { ...g, texture: g.texture as WebGLTexture };
      }
      await runGlCompute(rt.device, this.gl, {
        workgroups: wg,
        memory,
        uniforms,
        textures,
        storageTextures,
      });
      for (const [name, g] of given) {
        if (g.kind !== 'resident' || !g.writes) continue;
        const out = readInto(new DataView(memory[name]!.buffer), 0, g.layout, g.state.host);
        if (g.layout.k === 's') g.state.host = out;
        g.state.fresh = 'host';
      }
    };
    target.record(
      run,
      [...given.values()].flatMap((g) => (g.kind === 'resident' && g.writes ? [g.state] : [])),
    );
  }

  #space(name: string): string | undefined {
    return this.program.manifest.bindings.find((b) => b.name === name)?.space;
  }

  #bind(values: Bindings): Map<string, Given> {
    const e = this.e;
    if (typeof values !== 'object' || values === null)
      throw new TypeError(
        `"${e.name}"${at(e)}: the bindings are ${describe(values)}, not an object.`,
      );
    const reached = (e.bindings ?? [])
      .map((x) => ({
        b: this.program.manifest.bindings.find((b) => b.name === x.name),
        writes: x.writes,
      }))
      .filter((x): x is { b: PackBinding; writes: boolean } => x.b !== undefined);
    const known = new Set(reached.map((x) => x.b.name));
    for (const name of Object.keys(values))
      if (!known.has(name))
        throw new TypeError(
          `"${e.name}"${at(e)} reaches no binding "${name}"; it binds ${
            [...known]
              .filter((n) => !n.startsWith('_'))
              .map((n) => `"${n}"`)
              .join(', ') || 'nothing'
          }.`,
        );
    const out = new Map<string, Given>();
    const states = new Map<ResidentArrayState, string>();
    for (const { b, writes } of reached) {
      if (b.name === '_fp64') continue;
      const v = values[b.name];
      const where = `"${e.name}"${at(e)}, binding "${b.name}" (${b.type})`;
      if (v === undefined) throw new TypeError(`${where} is not given.`);
      if (b.resource.resourceKind === 'texture') {
        const dim = b.resource.textureDim ?? '2d';
        if (dim !== '2d' && v instanceof GlTextureImpl)
          throw new TypeError(
            `${where} takes a WebGLTexture made for ${GL_TARGET[dim] ?? dim}: a Texture of the WebGL2 runtime is 2D.`,
          );
        const rhi = this.program.rt.rhi;
        out.set(b.name, { kind: 'texture', texture: rhi.toNative(textureOf(rhi, v, where)) });
        continue;
      }
      if (b.resource.resourceKind === 'storage-texture') {
        out.set(b.name, storageOf(v, b, where));
        continue;
      }
      if (b.resource.resourceKind === 'sampler') {
        const rhi = this.program.rt.rhi;
        out.set(b.name, { kind: 'sampler', sampler: rhi.toNative(samplerOf(rhi, v, where)) });
        continue;
      }
      if (v instanceof CallWords) {
        out.set(b.name, { kind: 'words', words: v.words, inPlace: true });
        continue;
      }
      if (b.layout === undefined)
        throw new TypeError(
          `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}.`,
        );
      const layout = layoutFromPack(b.layout);
      const state = residentState(v);
      if (state !== undefined) {
        if (state.destroyed)
          throw new TypeError('This Buffer was disposed; make a new one with array().');
        decide(state, layoutKind(layout), where, hostSite);
        const twin = states.get(state);
        if (twin !== undefined)
          throw new TypeError(`${where} is the same Buffer as binding "${twin}".`);
        states.set(state, b.name);
        out.set(b.name, { kind: 'resident', state, layout, writes });
        continue;
      }
      try {
        const words = packWords(layout, v, b.name);
        out.set(
          b.name,
          b.space === 'uniform'
            ? { kind: 'uniform', value: structuredClone(v) }
            : { kind: 'words', words },
        );
      } catch (err) {
        if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
        throw err;
      }
    }
    return out;
  }
}

const GL_TARGET: Readonly<Record<string, string>> = {
  '2d-array': 'TEXTURE_2D_ARRAY',
  '3d': 'TEXTURE_3D',
  cube: 'TEXTURE_CUBE_MAP',
};
