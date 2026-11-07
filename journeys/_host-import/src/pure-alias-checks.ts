import { configure, type Pack } from 'typeshade/runtime';

type Live = { aliasLive: { value: number } };
export interface AliasFixture {
  readonly name: 'direct' | 'alias' | 'chain';
  readonly module: {
    readonly default: Pack;
    readonly aliasCompute: (
      bindings: Live & { aliasOut: Float32Array },
      groups: number,
    ) => Promise<void>;
    readonly aliasRender: (canvas: HTMLCanvasElement, bindings: Live) => Promise<void>;
  };
  readonly empty: {
    readonly default: Pack;
    readonly aliasEmpty: (
      canvas: HTMLCanvasElement,
      bindings?: Record<string, never>,
    ) => Promise<void>;
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Inspect fields the alias contract preserves. Paths, source spans and origins stay distinct. */
export function verifyAliasArtifacts(fixtures: readonly AliasFixture[]): void {
  if (
    !same(
      fixtures.map((f) => f.name),
      ['direct', 'alias', 'chain'],
    )
  )
    throw new Error('the alias instrument needs exactly direct, alias and chain fixtures');
  const reference = fixtures[0]!;
  for (const fixture of fixtures) {
    for (const part of ['module', 'empty'] as const) {
      const exported = fixture[part];
      const manifest = exported.default;
      const direct = reference[part].default;
      const empty = part === 'empty';
      const names = empty ? ['aliasEmptyUnused'] : ['aliasUnused', 'aliasLive', 'aliasOut'];
      const entries = empty ? ['aliasEmpty'] : ['aliasHidden', 'aliasCompute', 'aliasRender'];
      const bindingSlots = manifest.bindings.map((b) => [b.name, b.group, b.binding]);
      if (
        !same(
          bindingSlots,
          names.map((name, i) => [name, 0, i]),
        )
      )
        throw new Error(`${fixture.name} ${part}: unused-first binding slots were not retained`);
      if (
        !same(
          manifest.entries.map((e) => e.name),
          entries,
        )
      )
        throw new Error(`${fixture.name} ${part}: entry inventory differs from the target`);
      const expectedExports = empty
        ? ['aliasEmpty', 'default']
        : ['aliasCompute', 'aliasRender', 'default'];
      if (!same(Object.keys(exported).sort(), expectedExports))
        throw new Error(`${fixture.name} ${part}: a retained private name became a host export`);
      if (!manifest.wgsl || (!empty && !manifest.wgsl.includes('fn aliasPrivate(')))
        throw new Error(`${fixture.name} ${part}: the actual WGSL lost its private declarations`);
      // These relative fixtures have no private-name collisions. Their actual shader text is
      // equal, although their generated headers, source metadata and origins need not be.
      if (manifest.wgsl !== direct.wgsl)
        throw new Error(`${fixture.name} ${part}: WGSL differs from direct compilation`);
      const entry = empty ? 'aliasEmpty' : 'aliasRender';
      const draw = manifest.gl?.draws?.[entry];
      if (!draw || 'none' in draw || !draw.fragment || !same(draw, direct.gl?.draws?.[entry]))
        throw new Error(`${fixture.name} ${part}: the WebGL2 host draw is unavailable or differs`);
      if (!empty) {
        const compute = manifest.gl?.computes?.['aliasCompute'];
        if (
          !compute ||
          'none' in compute ||
          !compute.vertex ||
          !same(compute, direct.gl?.computes?.['aliasCompute'])
        )
          throw new Error(`${fixture.name}: the WebGL2 compute pass is unavailable or differs`);
      }
      const reached = manifest.entries.find((e) => e.name === entry)?.bindings?.map((b) => b.name);
      if (!same(reached ?? [], empty ? [] : ['aliasLive']))
        throw new Error(`${fixture.name} ${part}: an unused binding entered the host call`);
    }
  }
}

function canvas(tier: 'webgpu' | 'webgl2' | 'cpu'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  if (tier === 'webgl2')
    canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (tier === 'cpu') canvas.getContext('2d', { alpha: false });
  return canvas;
}

function pixels(canvas: HTMLCanvasElement, tier: 'webgpu' | 'webgl2' | 'cpu'): number[] {
  if (canvas.getContext(tier === 'cpu' ? '2d' : tier) === null)
    throw new Error(`the alias draw did not run on ${tier}`);
  const copy = document.createElement('canvas');
  copy.width = 32;
  copy.height = 32;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return [...context.getImageData(0, 0, 32, 32).data];
}

/** One finite matrix over real generated host imports, also reused by the source compile gate. */
export async function runAliasFixture(
  fixture: AliasFixture,
): Promise<Record<string, number[] | string>> {
  const out: Record<string, number[] | string> = {};
  for (const tier of ['webgpu', 'webgl2', 'cpu'] as const) {
    configure({ prefer: [tier] });
    try {
      const aliasOut = new Float32Array(32);
      const aliasLive = { value: 0.375 };
      try {
        await fixture.module.aliasCompute({ aliasLive, aliasOut }, 4);
        out[`compute ${tier}`] = [...aliasOut];
      } catch (e) {
        out[`compute ${tier}`] = String(e);
      }
      try {
        const target = canvas(tier);
        await fixture.module.aliasRender(target, { aliasLive });
        out[`render ${tier}`] = pixels(target, tier);
      } catch (e) {
        out[`render ${tier}`] = String(e);
      }
      for (const form of ['object', 'omitted', 'undefined'] as const) {
        try {
          const target = canvas(tier);
          if (form === 'omitted') await fixture.empty.aliasEmpty(target);
          else if (form === 'undefined') await fixture.empty.aliasEmpty(target, undefined);
          else await fixture.empty.aliasEmpty(target, {});
          out[`empty ${tier} ${form}`] = pixels(target, tier);
        } catch (e) {
          out[`empty ${tier} ${form}`] = String(e);
        }
      }
    } finally {
      configure({});
    }
  }
  return out;
}
