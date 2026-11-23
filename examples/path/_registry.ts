// ═══ Write `path/index.ts`, the `pathExamples` list, from the directories (change 0145) ═══
//
//   bun examples/path/_registry.ts
//
// `typeshade/examples` is browser-safe and reads no file at run time, so the text of each step's
// two files is written into `path/index.ts` here, at authoring time, as `hosts/_registry.ts` does
// for the host examples. The order comes from `_order.ts`; the part, the step, the tiers, the title
// and the blurb come from each step's `example.json` (`_manifest.ts`), and the text from the files.
// `examples/path-examples.test.ts` renders the file again and fails while it differs from the one
// checked in.
//
// Node-only (it reads the filesystem), as the leading underscore marks in this directory.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { readManifest } from '../_manifest.js';
import { PATH_DIR, SHADE_EXT } from '../_shade.js';
import type { PathExample } from '../_shared.js';
import { PATH_ORDER } from './_order.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The file this script writes. */
export const REGISTRY = join(HERE, 'index.ts');

/** Every step, in the order of `_order.ts`, with the text of its two files.
 *  @throws when `_order.ts` and the directories disagree, naming both directions at once. */
export function pathExampleRecords(): PathExample[] {
  const onDisk = readdirSync(HERE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const listed = [...PATH_ORDER];
  const unlisted = onDisk.filter((id) => !listed.includes(id));
  const missing = listed.filter((id) => !onDisk.includes(id));
  if (unlisted.length > 0 || missing.length > 0 || new Set(listed).size !== listed.length)
    throw new Error(
      `typeshade: examples/path/_order.ts and the directories disagree: ` +
        `not listed ${JSON.stringify(unlisted)}, no directory ${JSON.stringify(missing)}, ` +
        `listed ${JSON.stringify(listed)}`,
    );
  return PATH_ORDER.map((id) => {
    const manifest = readManifest(join(HERE, id), id);
    const { step, part, title, blurb, tiers } = manifest;
    if (step === undefined || part === undefined)
      throw new Error(`typeshade: examples/path/${id}/example.json has no "step" and "part"`);
    const shadeFile = `${PATH_DIR}/${id}/${id}${SHADE_EXT}`;
    const hostFile = `${PATH_DIR}/${id}/host.ts`;
    const read = (file: string): string => readFileSync(join(HERE, '..', file), 'utf8');
    return {
      id,
      step,
      part,
      title,
      blurb,
      shadeFile,
      shadeSource: read(shadeFile),
      hostFile,
      hostSource: read(hostFile),
      tiers: [...(tiers ?? ['webgpu', 'webgl2', 'cpu'])],
    };
  });
}

/** The text of `path/index.ts`, formatted as Prettier formats the tree. */
export async function renderPathRegistry(): Promise<string> {
  const records = pathExampleRecords();
  const text = `// ═══ typeshade examples — the learning path (change 0145) ═══
//
// GENERATED — DO NOT EDIT. Regenerate with: bun examples/path/_registry.ts
//
// Each step is a \`"use typeshade"\` module and the host file that runs it, in
// \`examples/path/<id>/\`. This file carries their text, so \`typeshade/examples\` stays
// browser-safe and reads no file. The order is \`_order.ts\`'s; the part, the step, the tiers, the
// title and the blurb are each step's \`example.json\`.

import type { PathExample } from '../_shared.js';

/** Every step of the learning path built so far, in the order a reader meets them. */
export const pathExamples: readonly PathExample[] = ${JSON.stringify(records, null, 2)};
`;
  return format(text, { ...(await resolveConfig(REGISTRY)), filepath: REGISTRY });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(REGISTRY, await renderPathRegistry());
  console.log(`wrote ${REGISTRY}`);
}
