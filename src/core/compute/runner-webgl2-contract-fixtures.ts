import type { ModuleDecl } from '../ir/index.js';
import {
  fn,
  module,
  If,
  Return,
  storageBuffer,
  resource,
  builtin,
  bitcastU32,
  f32T,
  u32T,
  i32T,
  vec3uT,
  vec4uT,
  voidT,
} from '../ir/index.js';
import { createComputeRunner } from '../../compute.js';

export type Elem = typeof f32T | typeof u32T | typeof i32T;

export function kernelOf(opts: { inputName?: string; elem?: Elem } = {}): ModuleDecl {
  const inputName = opts.inputName ?? 'feat_data';
  const elem = opts.elem ?? f32T;
  const input = storageBuffer(inputName, elem, { group: 0, binding: 0, access: 'read' });
  const out = storageBuffer('out_value', u32T, { group: 0, binding: 1, access: 'read_write' });
  const dispatch = resource('u_dispatch', vec4uT, { group: 0, binding: 2 });
  const kernel = fn(
    'scale_features',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      const i = gid.x;
      If(i.ge(dispatch.node.x), () => {
        Return();
      });
      out.at(i).assign(bitcastU32(input.at(i) as never));
    },
    { stage: 'compute', workgroupSize: 64, portable: true },
  );
  return module({
    bindings: [input.binding, out.binding, dispatch.binding],
    funcs: [kernel],
  });
}

export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface StubOptions {
  readonly blend?: boolean;
  readonly program?: object | null;
  readonly activeUnit?: number;
  readonly tex0?: object | null;
  readonly viewport?: readonly number[];
  readonly framebufferStatus?: number;
  readonly failFramebuffer?: boolean;
  readonly failTextureAt?: number;
}

export const COMPLETE = 0x8cd5;
export const INCOMPLETE = 0x8cd6;

export function glStub(init: StubOptions = {}) {
  const calls: Call[] = [];
  const consts = new Map<string, number>([
    ['FRAMEBUFFER_COMPLETE', COMPLETE],
    ['COMPILE_STATUS', 0x8b81],
    ['LINK_STATUS', 0x8b82],
    ['TEXTURE0', 0x84c0],
    ['BLEND', 0x0be2],
    ['VIEWPORT', 0x0ba2],
    ['CURRENT_PROGRAM', 0x8b8d],
    ['ACTIVE_TEXTURE', 0x84e0],
    ['TEXTURE_BINDING_2D', 0x8069],
  ]);
  let nextConst = 0x3000;
  const constant = (name: string): number => {
    if (!consts.has(name)) consts.set(name, nextConst++);
    return consts.get(name)!;
  };
  const enabled = new Set<number>(init.blend ? [constant('BLEND')] : []);
  const bindings = new Map<number, object | null>();
  if (init.tex0 !== undefined) bindings.set(constant('TEXTURE0'), init.tex0);
  let activeUnit = init.activeUnit ?? constant('TEXTURE0');
  let program: object | null = init.program ?? null;
  let viewport = [...(init.viewport ?? [0, 0, 640, 480])];
  let textureCount = 0;
  const api: Record<string, (...args: never[]) => unknown> = {
    createShader: () => ({}),
    createProgram: () => ({ kind: 'program' }),
    createTexture: () => {
      textureCount += 1;
      return init.failTextureAt === textureCount ? null : { kind: 'texture', id: textureCount };
    },
    createFramebuffer: () => (init.failFramebuffer ? null : { kind: 'framebuffer' }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (...a: never[]) => ({ kind: 'location', name: a[1] as unknown as string }),
    checkFramebufferStatus: () => init.framebufferStatus ?? COMPLETE,
    enable: (...a: never[]) => enabled.add(a[0] as unknown as number),
    disable: (...a: never[]) => enabled.delete(a[0] as unknown as number),
    isEnabled: (...a: never[]) => enabled.has(a[0] as unknown as number),
    useProgram: (...a: never[]) => {
      program = (a[0] as object | null) ?? null;
    },
    activeTexture: (...a: never[]) => {
      activeUnit = a[0] as unknown as number;
    },
    bindTexture: (...a: never[]) => bindings.set(activeUnit, (a[1] as object | null) ?? null),
    deleteTexture: (...a: never[]) => {
      for (const [unit, t] of bindings) if (t === a[0]) bindings.set(unit, null);
    },
    viewport: (...a: never[]) => {
      viewport = a.map(Number);
    },
    readPixels: (...a: never[]) => {
      const grid = a[6] as unknown as Uint32Array;
      for (let i = 0; i < grid.length; i++) grid[i] = i + 1;
    },
    getParameter: (...a: never[]) => {
      const pname = a[0] as unknown as number;
      if (pname === constant('VIEWPORT')) return Int32Array.from(viewport);
      if (pname === constant('CURRENT_PROGRAM')) return program;
      if (pname === constant('ACTIVE_TEXTURE')) return activeUnit;
      if (pname === constant('TEXTURE_BINDING_2D')) return bindings.get(activeUnit) ?? null;
      return 0;
    },
  };
  const gl = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (/^[A-Z0-9_]+$/.test(prop) && !(prop in api)) return constant(prop);
        return (...args: never[]) => {
          calls.push({ name: prop, args });
          return prop in api ? api[prop]!(...args) : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return {
    gl,
    calls,
    constant,
    named: (name: string) => calls.filter((c) => c.name === name),
    indexOf: (name: string) => calls.findIndex((c) => c.name === name),
    lastIndexOf: (name: string) => calls.map((c) => c.name).lastIndexOf(name),
    blendEnabled: () => enabled.has(constant('BLEND')),
    currentProgram: () => program,
    activeUnit: () => activeUnit,
    bindingOn: (unit: number) => bindings.get(unit) ?? null,
    viewport: () => viewport,
  };
}

export async function runnerOn(s: ReturnType<typeof glStub>, m: ModuleDecl = kernelOf()) {
  return createComputeRunner(m, { prefer: ['webgl2'], gl: s.gl });
}

export async function attempt(run: () => Promise<Uint32Array>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
}
