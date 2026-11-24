// ═══ The registry driver (change 0145, amendment A2, M4.6) ═══
//
// One driver reads the registry and runs each example whose manifest says `"host": "run"`. The
// registry is every `example.json` under `path/` and `gallery/`, and the host examples of
// `hosts/`, which have no manifest yet and are listed by `hosts/_order.ts`. Each group keeps one
// `_drive.ts` that holds the inputs of its examples; this driver picks the group's file for an
// entry, runs it, and runs the optional `check.ts` of the example.
//
// The CPU tier has no canvas in Node. `cpuSurface` is a canvas whose only context is `2d`, and
// `withCpuCanvas` installs it as `OffscreenCanvas` for the length of a call.
//
// Node-only: it reads the filesystem. The suites import it; a gate page does not.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Drive, Outputs, Surface } from './_compare.js';
import { hasManifest, readManifest, type Tier } from './_manifest.js';
import { HOST_ORDER } from './hosts/_order.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The directories that hold example directories, relative to `examples/`. */
const GROUP_DIRS = ['path', 'gallery', 'hosts'] as const;

/** One example the driver can run. */
export interface Runnable {
  readonly id: string;
  /** The group directory, such as `path`. */
  readonly group: string;
  readonly tiers: readonly Tier[];
  /** The names of its `extras`: exports of `host.ts` other than `run`, which the driver runs too. */
  readonly extras: readonly string[];
  /** The example's directory, absolute. */
  readonly dir: string;
  /** The absolute path of its `check.ts`, when it has one. */
  readonly check?: string;
}

/** Every example of the registry whose manifest says `"host": "run"`, in group order and then
 *  by id (a group's own order, `PATH_ORDER` for example, is not the driver's concern). */
export function runnables(): Runnable[] {
  const out: Runnable[] = [];
  for (const group of GROUP_DIRS) {
    const root = join(HERE, group);
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const id of dirs) {
      const dir = join(root, id);
      const legacy = HOST_ORDER.find((h) => h.id === id);
      const manifest = hasManifest(dir) ? readManifest(dir, id) : undefined;
      if (manifest === undefined && (group !== 'hosts' || legacy === undefined)) continue;
      if (manifest !== undefined && manifest.host !== 'run') continue;
      const tiers = manifest?.tiers ?? legacy?.tiers ?? ['webgpu', 'webgl2', 'cpu'];
      const check = join(dir, 'check.ts');
      const extras = manifest?.extras ?? legacy?.extras ?? [];
      out.push({ id, group, tiers, extras, dir, ...(existsSync(check) ? { check } : {}) });
    }
  }
  return out;
}

/** The entries whose `tiers` list the CPU tier. */
export const cpuRunnables = (): Runnable[] => runnables().filter((r) => r.tiers.includes('cpu'));

/** The group's driver, imported by a computed path: `tsconfig.tests.json` does not read the host
 *  files, which resolve their module to its host view only under the group's `tsconfig.json`. */
export async function driveOf(group: string): Promise<Drive> {
  const file = join(HERE, group, '_drive.ts');
  if (!existsSync(file)) throw new Error(`typeshade: examples/${group}/_drive.ts does not exist`);
  return ((await import(/* @vite-ignore */ file)) as { drive: Drive }).drive;
}

/** A canvas with one context, `2d`, that keeps what the CPU tier puts on it: `OffscreenCanvas`
 *  as far as a draw reads one. */
export class PixelCanvas {
  data: Uint8ClampedArray = new Uint8ClampedArray(0);
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): object | null {
    if (kind !== '2d') return null;
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * w * h) }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        this.data = img.data.slice();
      },
    };
  }
}

export const cpuSurface: Surface = {
  canvas: (w, h) => new PixelCanvas(w, h) as unknown as OffscreenCanvas,
  pixels: (c) => [...(c as unknown as PixelCanvas).data],
};

/** Run `body` with `OffscreenCanvas` set to {@link PixelCanvas}, and restore it after. */
export async function withCpuCanvas<T>(body: () => Promise<T>): Promise<T> {
  const g = globalThis as { OffscreenCanvas?: unknown };
  const before = g.OffscreenCanvas;
  g.OffscreenCanvas = PixelCanvas;
  try {
    return await body();
  } finally {
    if (before === undefined) delete g.OffscreenCanvas;
    else g.OffscreenCanvas = before;
  }
}

/** Run `entry` once on the CPU tier: what it gave back, or the error it threw as a string. */
export async function runOnCpu(entry: Runnable): Promise<Outputs | string> {
  return withCpuCanvas(async () => {
    const ran = await (await driveOf(entry.group))(cpuSurface, [entry.id]);
    return ran[entry.id] ?? `${entry.id}: the driver gave nothing`;
  });
}

/** Call the `check(result, tier)` of a `check.ts`; it throws on a failure.
 *  @returns the failure as a line, or nothing when the check holds. */
export async function runCheck(
  file: string,
  result: Outputs,
  tier: Tier,
): Promise<string | undefined> {
  const m = (await import(/* @vite-ignore */ file)) as {
    check?: (result: Outputs, tier: Tier) => unknown;
  };
  if (typeof m.check !== 'function') return `${file} exports no check(result, tier)`;
  try {
    await m.check(result, tier);
    return undefined;
  } catch (e) {
    return String(e);
  }
}
