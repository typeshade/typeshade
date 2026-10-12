// ═══ Write `hosts/index.ts`, the `hostExamples` list, from the directories (change 0061) ═══
//
//   bun examples/hosts/_registry.ts
//
// `typeshade/examples` is browser-safe and reads no file at run time, so the text of each host
// example's two files is written into `hosts/index.ts` here, at authoring time, as the registry's
// `_order.ts` is turned into `index.ts`. The order and the tiers come from `_order.ts`, the title
// and the blurb from the module's own `@example` block (`_shade.ts`), and the text from the files.
// `examples/host-examples.test.ts` renders the file again and fails while it differs from the one
// checked in, so an edited host file and a stale list cannot both be green.
//
// Node-only (it reads the filesystem), as the leading underscore marks in this directory.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { exampleText, HOSTS_DIR, SHADE_EXT } from '../_shade.js';
import type { HostExample } from '../_shared.js';
import { HOST_ORDER } from './_order.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The file this script writes. */
export const REGISTRY = join(HERE, 'index.ts');

/** Every host example, in the order of `_order.ts`, with the text of its two files.
 *  @throws when `_order.ts` and the directories disagree, naming both directions at once. */
export function hostExampleRecords(): HostExample[] {
  const onDisk = readdirSync(HERE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const listed = HOST_ORDER.map((h) => h.id);
  const unlisted = onDisk.filter((id) => !listed.includes(id));
  const missing = listed.filter((id) => !onDisk.includes(id));
  if (unlisted.length > 0 || missing.length > 0 || new Set(listed).size !== listed.length)
    throw new Error(
      `typeshade: examples/hosts/_order.ts and the directories disagree: ` +
        `not listed ${JSON.stringify(unlisted)}, no directory ${JSON.stringify(missing)}, ` +
        `listed ${JSON.stringify(listed)}`,
    );
  return HOST_ORDER.map(({ id, tiers }) => {
    const shadeFile = `${HOSTS_DIR}/${id}/${id}${SHADE_EXT}`;
    const hostFile = `${HOSTS_DIR}/${id}/host.ts`;
    const read = (file: string): string => readFileSync(join(HERE, '..', file), 'utf8');
    return {
      id,
      ...exampleText(id),
      shadeFile,
      shadeSource: read(shadeFile),
      hostFile,
      hostSource: read(hostFile),
      tiers: [...tiers],
    };
  });
}

/** The text of `hosts/index.ts`, formatted as Prettier formats the tree. */
export async function renderHostRegistry(): Promise<string> {
  const records = hostExampleRecords();
  const text = `// ═══ typeshade examples — the host examples (change 0061) ═══
//
// GENERATED — DO NOT EDIT. Regenerate with: bun examples/hosts/_registry.ts
//
// Each host example is a \`"use typeshade"\` module and the host file that runs it, in
// \`examples/hosts/<id>/\`. This file carries their text, so \`typeshade/examples\` stays
// browser-safe and reads no file. The order and the tiers are \`_order.ts\`'s; the title and the
// blurb are the module's \`@example\` block.

import type { HostExample } from '../_shared.js';

/** Every host example, in the order a reader meets them: a draw, a dispatch, a kernel call, a
 *  chain kept on the device, a helper called on the CPU, the program runtime, and a chain of
 *  kernel calls fused into one dispatch. */
export const hostExamples: readonly HostExample[] = ${JSON.stringify(records, null, 2)};
`;
  return format(text, { ...(await resolveConfig(REGISTRY)), filepath: REGISTRY });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(REGISTRY, await renderHostRegistry());
  console.log(`wrote ${REGISTRY}`);
}
