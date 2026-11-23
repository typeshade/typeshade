import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { GALLERY_DIR, SHADE_EXT } from '../examples/_example-file.js';
import { readManifest } from '../examples/_manifest.js';
import { CURATED_ORDER } from '../examples/_order.js';
import { discoverExamples } from '../examples/_scan.js';
import { renderHostRegistry, REGISTRY as HOSTS_INDEX } from '../examples/hosts/_registry.js';
import { renderPathRegistry, REGISTRY as PATH_INDEX } from '../examples/path/_registry.js';

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

export const ROOT_INDEX = join(EXAMPLES_DIR, 'index.ts');

export async function renderRootIndex(): Promise<string> {
  const found = new Map(discoverExamples(EXAMPLES_DIR).map((d) => [d.id, d]));
  const entries = CURATED_ORDER.map((id) => {
    const hit = found.get(id);
    if (hit === undefined)
      throw new Error(`typeshade: examples/_order.ts lists "${id}", which no module declares`);
    return hit;
  });
  const unlisted = [...found.keys()].filter((id) => !CURATED_ORDER.includes(id));
  if (unlisted.length > 0)
    throw new Error(
      `typeshade: modules not listed in examples/_order.ts: ${JSON.stringify(unlisted)}`,
    );
  const imports = entries
    .map((e) => `import { ${e.exportName} } from '${e.importPath}';`)
    .join('\n');
  const names = entries.map((e) => `  ${e.exportName},`).join('\n');
  const text = `// ═══ typeshade examples — registry ═══
//
// GENERATED — DO NOT EDIT.
// Regenerate with: bun scripts/gen-example-registry.ts
//
// The single import surface for the examples: the CLI printer (print.ts) and the site's
// interactive /shader-dsl page both consume \`examples\` from here. Each entry carries its
// built DSL \`module\` (emit WGSL/GLSL + reflect from it) plus the metadata the site needs
// to render + control it. This file is runtime-free and browser-safe (no console / node).
//
// The ORDER is curated, not discovered — edit \`_order.ts\`, then regenerate. Adding an
// example is: write the file, add its id to \`_order.ts\`, run the command above.

${imports}
import type { ShaderExample } from './_shared.js';

export type { ShaderExample, Control, HostExample, PathExample } from './_shared.js';
// The host examples (change 0061): a module and the host file that runs it, in
// \`examples/hosts/\`, listed with their text by \`hosts/index.ts\` (written by \`hosts/_registry.ts\`).
export { hostExamples } from './hosts/index.js';
// The learning path (change 0145): a module and its host file for each step, in \`examples/path/\`,
// listed with their text by \`path/index.ts\` (written by \`path/_registry.ts\`).
export { pathExamples } from './path/index.js';
export {
${names}
};

/** All examples, cartographic first (they belong on a map site), then generic, then compute. */
export const examples: readonly ShaderExample[] = [
${names}
];
`;
  return format(text, { ...(await resolveConfig(ROOT_INDEX)), filepath: ROOT_INDEX });
}

/** The ids of the gallery directories (change 0145, amendment A2), each checked: it holds the
 *  module `<id>.shade.ts` and an `example.json` that passes the schema, with a group that
 *  `groups.json` lists. No index is written from them yet, so this is the generator's read.
 *  @throws naming the directory and what it lacks. */
export function checkGallery(): readonly string[] {
  const dirs = readdirSync(join(EXAMPLES_DIR, GALLERY_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const id of dirs) {
    const dir = join(EXAMPLES_DIR, GALLERY_DIR, id);
    if (!existsSync(join(dir, `${id}${SHADE_EXT}`)))
      throw new Error(`typeshade: examples/${GALLERY_DIR}/${id}/ holds no ${id}${SHADE_EXT}`);
    readManifest(dir, id);
  }
  return dirs;
}

export async function renderAllIndexes(): Promise<ReadonlyMap<string, string>> {
  checkGallery();
  return new Map([
    [ROOT_INDEX, await renderRootIndex()],
    [HOSTS_INDEX, await renderHostRegistry()],
    [PATH_INDEX, await renderPathRegistry()],
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [file, text] of await renderAllIndexes()) {
    writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}
