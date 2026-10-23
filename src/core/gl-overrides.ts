// Pin the same normalized override values in every WebGL2 host path (0057, 0084).
import type { Pack } from './manifest-types.js';

/** `source` with each override named in `values` pinned: GLSL ES 3.00 has no specialization
 *  constants, so a program declares each override as a `#define` under `#ifndef`, and a
 *  `#define` before it pins the value, as the GLSL writer's `overrideValues` does. */
export function pinOverrides(
  source: string,
  values: Readonly<Record<string, number>>,
  names: Readonly<Record<string, string>> = {},
): string {
  const defines = Object.entries(values)
    .map(([name, v]) => {
      // The define is the GLSL spelling of the override (Proposal 0070, C8); the value is keyed
      // by the name the host supplies.
      const g = names[name] ?? name;
      return `#define ${g} ${glslLiteral(source, g, v)}\n`;
    })
    .join('');
  const nl = source.indexOf('\n') + 1;
  return source.slice(0, nl) + defines + source.slice(nl);
}

/** The GLSL spelling of each override of `m` that differs from the name the host supplies it by
 *  (Proposal 0070, C8): the key is the authored name, the value the name the program declares. */
export function glslOverrideNames(m: Pick<Pack, 'overrides'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of m.overrides ?? []) {
    const g = o.emittedGlsl ?? o.emitted;
    if (g !== o.name) out[o.name] = g;
  }
  return out;
}

/** `v` as the GLSL literal of the override `name`, typed as the program's default is. */
function glslLiteral(src: string, name: string, v: number): string {
  const d = new RegExp(`#define ${name} (\\S+)`).exec(src)?.[1] ?? '';
  if (d.endsWith('u')) return `${v >>> 0}u`;
  if (d === 'true' || d === 'false') return v === 0 ? 'false' : 'true';
  if (/[.eE]/.test(d)) {
    const s = Object.is(v, -0) ? '-0' : String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  return String(v | 0);
}
