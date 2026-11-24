import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bothHalves } from '../../core/testing/both-halves.js';
import { hostFace } from './host-face.js';
import type { GeneratedCpu } from '../../core/host-entry.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { madeOf, type KernelMade } from '../../core/kernel-made-face.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

export type Call = (...a: unknown[]) => Promise<unknown>;

export interface Loaded {
  readonly call: Readonly<Record<string, Call>>;
  readonly cpu: GeneratedCpu;
  readonly face: Readonly<Record<string, KernelFace>>;
  readonly made: (name: string) => KernelMade;
  readonly dispose: () => void;
}

export function facesOf(source: string): ReadonlyMap<string, KernelFace> {
  const generated = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  const errors = (generated.diagnostics ?? []).filter((d) => d.category === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('\n'));
  const faces = new Map<string, KernelFace>();
  for (const e of generated.exports ?? []) if ('face' in e) faces.set(e.name, e.face as KernelFace);
  return faces;
}

export async function load(source: string): Promise<Loaded> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-growing-'));
  const generated = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  const errors = (generated.diagnostics ?? []).filter((d) => d.category === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('\n'));
  const slots = [...generated.code!.matchAll(/const __ts_e(\d+) = \{"name":"(\w+)"/g)];
  const exposed =
    `\nexport { __ts_m as __cpu };\nexport const __face = {` +
    slots.map((m) => `${m[2]!}: __ts_e${m[1]!}`).join(', ') +
    `};\n`;
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, generated.code! + exposed);
  const href = pathToFileURL(file).href;
  const m = (await import(href)) as Record<string, unknown>;
  const face = m['__face'] as Record<string, KernelFace>;
  return {
    call: m as unknown as Record<string, Call>,
    cpu: m['__cpu'] as GeneratedCpu,
    face,
    made: (name) => madeOf(face[name]!)!,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function warningsOf(source: string): readonly string[] {
  const halves = bothHalves(source);
  if (halves.compiler.length > 0) throw new Error(halves.compiler.join('\n'));
  const warnings = halves.result.diagnostics
    .filter((d) => d.category === 'warning')
    .map((d) => `typeshade ${d.code}: ${d.message}`);
  if (JSON.stringify(halves.editor) !== JSON.stringify(warnings))
    throw new Error(`the halves differ:\n${warnings.join('\n')}\n--\n${halves.editor.join('\n')}`);
  return warnings;
}
