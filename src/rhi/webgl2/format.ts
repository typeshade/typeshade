import type { GL, GlTextureKind } from './types.js';

interface FormatSpec {
  readonly internal: string;
  readonly format: string;
  readonly type: string;
  readonly channels: number;
  readonly kind: GlTextureKind;
  readonly bgra?: boolean;
}

export interface GlFormat {
  readonly internal: number;
  readonly format: number;
  readonly type: number;
  readonly channels: number;
  readonly kind: GlTextureKind;
  readonly bgra?: boolean;
}

const NAMED = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/;

const depthSpec = (internal: string, format: string, type: string): FormatSpec => ({
  internal,
  format,
  type,
  channels: 1,
  kind: 'depth',
});

function specOf(name: string): FormatSpec | undefined {
  switch (name) {
    case 'depth16unorm':
      return depthSpec('DEPTH_COMPONENT16', 'DEPTH_COMPONENT', 'UNSIGNED_SHORT');
    case 'depth24plus':
      return depthSpec('DEPTH_COMPONENT24', 'DEPTH_COMPONENT', 'UNSIGNED_INT');
    case 'depth32float':
      return depthSpec('DEPTH_COMPONENT32F', 'DEPTH_COMPONENT', 'FLOAT');
    case 'depth24plus-stencil8':
      return depthSpec('DEPTH24_STENCIL8', 'DEPTH_STENCIL', 'UNSIGNED_INT_24_8');
    case 'depth32float-stencil8':
      return depthSpec('DEPTH32F_STENCIL8', 'DEPTH_STENCIL', 'FLOAT_32_UNSIGNED_INT_24_8_REV');
    case 'rgb10a2unorm':
      return {
        internal: 'RGB10_A2',
        format: 'RGBA',
        type: 'UNSIGNED_INT_2_10_10_10_REV',
        channels: 4,
        kind: 'float',
      };
    case 'rgb10a2uint':
      return {
        internal: 'RGB10_A2UI',
        format: 'RGBA_INTEGER',
        type: 'UNSIGNED_INT_2_10_10_10_REV',
        channels: 4,
        kind: 'uint',
      };
    case 'rg11b10ufloat':
      return {
        internal: 'R11F_G11F_B10F',
        format: 'RGB',
        type: 'UNSIGNED_INT_10F_11F_11F_REV',
        channels: 3,
        kind: 'float',
      };
  }
  const m = NAMED.exec(name);
  if (m === null) return undefined;
  const [, ch, bitsText, kind, srgb] = m as unknown as [string, string, string, string, string?];
  const bits = Number(bitsText);
  const channels = ch === 'r' ? 1 : ch === 'rg' ? 2 : 4;
  const bgra = ch === 'bgra';
  const C = ch === 'bgra' ? 'RGBA' : ch.toUpperCase();
  const base = channels === 1 ? 'RED' : channels === 2 ? 'RG' : 'RGBA';
  if (kind === 'unorm' && bits === 8) {
    if (srgb !== undefined)
      return channels === 4
        ? {
            internal: 'SRGB8_ALPHA8',
            format: 'RGBA',
            type: 'UNSIGNED_BYTE',
            channels,
            kind: 'float',
            bgra,
          }
        : undefined;
    return {
      internal: `${C}8`,
      format: base,
      type: 'UNSIGNED_BYTE',
      channels,
      kind: 'float',
      bgra,
    };
  }
  if (srgb !== undefined) return undefined;
  if (kind === 'snorm' && bits === 8)
    return { internal: `${C}8_SNORM`, format: base, type: 'BYTE', channels, kind: 'float' };
  if (kind === 'float' && bits !== 8)
    return {
      internal: `${C}${bits}F`,
      format: base,
      type: bits === 16 ? 'HALF_FLOAT' : 'FLOAT',
      channels,
      kind: 'float',
    };
  if (kind === 'uint' || kind === 'sint') {
    const u = kind === 'uint';
    const type =
      bits === 8
        ? u
          ? 'UNSIGNED_BYTE'
          : 'BYTE'
        : bits === 16
          ? u
            ? 'UNSIGNED_SHORT'
            : 'SHORT'
          : u
            ? 'UNSIGNED_INT'
            : 'INT';
    return {
      internal: `${C}${bits}${u ? 'UI' : 'I'}`,
      format: `${base}_INTEGER`,
      type,
      channels,
      kind,
    };
  }
  return undefined;
}

export function textureKindOf(format: string): GlTextureKind | undefined {
  return specOf(format)?.kind;
}

export function formatOf(gl: GL, name: string): GlFormat | undefined {
  const spec = specOf(name);
  if (spec === undefined) return undefined;
  const g = gl as unknown as Record<string, number | undefined>;
  const internal = g[spec.internal];
  if (internal === undefined && (spec.kind === 'uint' || spec.kind === 'sint')) return undefined;
  return {
    internal: internal!,
    format: g[spec.format]!,
    type: g[spec.type]!,
    channels: spec.channels,
    kind: spec.kind,
    ...(spec.bgra === true ? { bgra: true } : {}),
  };
}
