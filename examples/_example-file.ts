import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The extension that marks a TypeShade source module — the same one the Vite plugin
 *  (`src/vite.ts`) and `tshc sync` pick modules by (Rule 3.8), so the corpus on disk and the
 *  bundler plugin agree on what a shade module is. */
export const SHADE_EXT = '.shade.ts';

/** The directory of the host examples (change 0061): one directory for each, `hosts/<id>/`,
 *  holding the module `<id>.shade.ts` and the host file `host.ts` that runs it. The module is an
 *  example of the corpus like any file of this directory, so it reaches the emit goldens and the
 *  compile gate; `hosts/index.ts` lists the pairs for a reader (`hostExamples`). */
export const HOSTS_DIR = 'hosts';

/** The directory of the learning path (change 0145): one directory for each step, `path/<id>/`,
 *  holding the module `<id>.shade.ts` and the host file `host.ts`. The gallery's directories
 *  (`hosts/` today) are a separate place, so a path step and a gallery example never share one. */
export const PATH_DIR = 'path';

/** The directory of the gallery (change 0145, amendment A2): one directory for each example,
 *  `gallery/<id>/`, holding the module `<id>.shade.ts` and its `example.json`. A support module of
 *  the example sits beside them and is no example of its own. The modules that have not moved yet
 *  stay in this directory, and the scan reads both places until the last one moves. */
export const GALLERY_DIR = 'gallery';

/** Every `.shade.ts` file of the corpus, id → its path relative to this directory: each file of
 *  this directory, each host example's module, each step's module of the learning path and each
 *  module of the gallery. The id is the basename without `.shade.ts`,
 *  so a host example's directory and its module carry one name. */
export const SHADE_FILES: ReadonlyMap<string, string> = new Map([
  ...readdirSync(HERE)
    .filter((f) => f.endsWith(SHADE_EXT))
    .map((f) => [f.slice(0, -SHADE_EXT.length), f] as const),
  ...readdirSync(join(HERE, HOSTS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, `${HOSTS_DIR}/${d.name}/${d.name}${SHADE_EXT}`] as const),
  ...readdirSync(join(HERE, PATH_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, `${PATH_DIR}/${d.name}/${d.name}${SHADE_EXT}`] as const),
  ...readdirSync(join(HERE, GALLERY_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, `${GALLERY_DIR}/${d.name}/${d.name}${SHADE_EXT}`] as const),
]);

/** The `.shade.ts` files of the corpus that are neither a host example nor a path step, as paths
 *  relative to this directory, in the order of their file names: the files of this directory and
 *  the module of each gallery directory. A suite that sweeps the corpus reads this list, so a move
 *  into `gallery/` keeps each module in the sweep. */
export const CORPUS_FILES: readonly string[] = [...SHADE_FILES.values()]
  .filter((f) => !f.startsWith(`${HOSTS_DIR}/`) && !f.startsWith(`${PATH_DIR}/`))
  .sort((a, b) => basename(a).localeCompare(basename(b)));

/** The absolute path of the `.shade.ts` file of an example id, found through the same scan as
 *  the corpus, so it holds when a file moves into a subdirectory. Throws for an unknown id. */
export function exampleFile(id: string): string {
  const file = SHADE_FILES.get(id);
  if (file === undefined) throw new Error(`typeshade: no .shade.ts example is named ${id}`);
  return join(HERE, file);
}

/** The text of the `.shade.ts` file of an example id. */
export function exampleSource(id: string): string {
  return readFileSync(exampleFile(id), 'utf8');
}
