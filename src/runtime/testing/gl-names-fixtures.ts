import {
  f32T,
  samplerT,
  texture2dfT,
  vec3fT,
  vec4fT,
  type Expr,
  type ModuleDecl,
  type Stmt,
} from '../../core/ir/index.js';
import { allKindsModule } from '../../core/testing/all-kinds-module.js';

const constant = (name: string): number =>
  name === 'INVALID_INDEX' ? 0xffffffff : 0x1000 + name.length;

export function recordingGl(options: { minimum?: number; inactive?: string } = {}): {
  gl: WebGL2RenderingContext;
  calls: [string, unknown[]][];
} {
  const calls: [string, unknown[]][] = [];
  const answers: Record<string, (...a: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 8,
    getError: () => constant('NO_ERROR'),
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    getUniformBlockIndex: (_p, name) => (name === options.inactive ? 0xffffffff : 0),
    getActiveUniformBlockParameter: () => options.minimum ?? 16,
    getUniformLocation: (_p, name) => ({ at: name }),
    createFramebuffer: () => ({}),
    createSampler: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    getExtension: () => null,
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        const answer = answers[key];
        if (answer !== undefined)
          return (...a: unknown[]) => {
            calls.push([key, a]);
            return answer(...a);
          };
        if (/^[A-Z0-9_]+$/.test(key)) return constant(key);
        return (...a: unknown[]) => {
          calls.push([key, a]);
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls };
}

export const graphicsWithBinding = (binding: string): ModuleDecl => {
  const base = allKindsModule(
    { binding, texture: 'texture', struct: 'half', override: 'shared' },
    'graphics',
  );
  const structT = { kind: 'struct', name: 'half' } as const;
  const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
  const sample: Expr = {
    op: 'call',
    type: vec4fT,
    fn: 'textureSample',
    args: [
      { op: 'varref', type: texture2dfT, name: 'texture' },
      { op: 'varref', type: samplerT, name: 'textureSampler' },
      { op: 'construct', type: vec3fT, args: [lit(0), lit(0), lit(0)] },
    ],
  };
  const body: Stmt[] = [
    {
      s: 'return',
      expr: {
        op: 'construct',
        type: vec4fT,
        args: [
          {
            op: 'member',
            type: f32T,
            base: { op: 'varref', type: structT, name: binding },
            field: 'f',
          },
          { op: 'member', type: f32T, base: sample, field: 'x' },
          { op: 'overrideref', type: f32T, name: 'shared' },
          lit(1),
        ],
      },
    },
  ];
  return { ...base, funcs: base.funcs.map((f) => (f.name === 'fe' ? { ...f, body } : f)) };
};
