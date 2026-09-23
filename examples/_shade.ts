// ═══ The `.shade.ts` corpus — `"use typeshade"` source, wrapped as registry entries ═══
//
// Seven example files opened with `"use typeshade"` and shipped in this directory
// (`hello.shade.ts` and friends). Until now they were authored and then left dangling: no
// test emitted them, the compile gate never saw them, and nothing in the package would have
// noticed if a compiler change turned one into a shader that no longer compiles. This file
// is the missing wire — it gives each one the same `ShaderExample` shape the `fn()` EDSL
// examples have, so every consumer that reads `module` + `renderable` takes both corpora
// without caring which surface wrote them.
//
// WHY THESE ARE NOT IN `examples` (index.ts). The obvious move is to append them to the
// curated registry. It does not work, and the reason is worth writing down so the next
// reader does not re-try it: `examples` is consumed at BUILD TIME by typeshade.github.io
// (`src/lib/examples.ts`), and three of its gates fail on any entry added here —
//
//   1. `wgslOnlyExample()` throws unless EXACTLY ONE registered example refuses to emit
//      GLSL. `compute-reduction` is that one; `hello-uniform` would be a second.
//   2. `checkedBlurbs()` throws unless every registered id has a hand-written description
//      in EVERY locale (src/i18n/en.ts, ko.ts) — five new ids, ten new lines, in a
//      repository this change does not touch.
//   3. `ExamplesPage.astro` groups rows through `e.categories[x.category]`, a typed record
//      with exactly `cartographic | generic | compute` keys. A fourth category is a type
//      error in the site build.
//
// So the split is not squeamishness about the existing 36: appending would break the site
// the next time it re-pins this submodule, and the fix belongs in that repository, in the
// same change that decides how a `"use typeshade"` example should be PRESENTED. Until
// then the corpus is wired to everything that lives here — the gate and the goldens below
// — and to nothing that lives there.
//
// WHY IT READS THE FILESYSTEM. A `.shade.ts` file is not an importable TypeScript module.
// It is source TEXT for `compile()`: `vec4` and `u32` are the shader language's types, not
// declared TypeScript ones, and `tsconfig.tests.json` excludes the whole pattern from the
// type check for exactly that reason. There is no binding to import, so the wrapper reads
// the bytes and compiles them. That makes this module node-only, which is what the leading
// underscore has meant in this directory since `_scan.ts`: a helper, not an example, and
// not importable from a browser build. `examples/index.ts` stays runtime-free.
//
// ═══ WHY EACH SHADER CARRIES ITS OWN REGISTRATION (#65) ═══
//
// Until now every example was registered by appending an object literal to ONE hand-ordered
// array here. Two branches that each add an example add adjacent lines to the same region, and
// git cannot tell the two additions apart, so every such pair conflicted on every merge — five
// hand resolutions across three branches in one afternoon, none of them a real disagreement.
// Worse, resolving one by taking a side drops an example silently.
//
// So the hand-written half — everything `compile()` cannot infer: `title`, `blurb`,
// `renderable` and `twinOf` — now lives in the shader it describes, as a JSON block in a
// comment directly after the `"use typeshade"` directive. Two branches adding two examples
// touch two NEW files and no shared line, which removes the class rather than narrowing it.
//
// WHY NOT A SIBLING MODULE PER EXAMPLE, which is the shape the issue proposed first: it does
// not work without breaking something. `shadeExamples` is consumed at module scope as a plain
// array by five callers (the gate and four suites), so discovery has to be SYNCHRONOUS — which
// rules out `import()`. Static imports would leave this file with one import line and one array
// entry per example, two adjacent-line regions instead of one, which halves the conflict class
// rather than removing it. A sibling `.json` per example would work, at the cost of 49 new
// files and of metadata that can drift away from, or outlive, the shader it describes. A header
// costs no files and cannot: deleting the shader deletes its registration with it.
//
// WHY A COMMENT IS SAFE. It is not a declaration, so a `.shade.ts` file stays exactly as
// non-importable as it was, `compile()` ignores it, and `"use typeshade"` is still the first
// non-comment line of every file. The block is REQUIRED: a shader without one fails the drift
// arm in `shade-examples.test.ts` rather than going quietly unregistered.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.js';
import type { ShaderExample } from './_shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The extension that marks a TypeShade source module — the same one `src/compiler/ts/vite.ts`
 *  filters on, so the corpus on disk and the bundler plugin agree on what a shade module is. */
export const SHADE_EXT = '.shade.ts';

/** The hand-written half of a `.shade.ts` registration: everything `compile()` cannot infer. */
type ShadeSpec = {
  /** Registry id. Also the golden filename stem, so it must not collide with an `examples` id. */
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** The `examples` id this file is the source-language TWIN of: the same shader, authored
   *  through the other surface. Set it and `shade-twins.test.ts` pins the two emits side by
   *  side and compares the lowered modules — which is what turns "the EDSL corpus is the
   *  oracle" from a claim in the surface document into something a suite can fail on. */
  readonly twinOf?: string;
} & (
  | {
      /** Has a GLSL ES 3.00 form — both stages emit AND link. Authored, never derived: a flag
       *  computed by try/catch around the emitter agrees with the emitter by construction, and
       *  the compile gate would then have nothing left to catch. */
      readonly renderable: true;
    }
  | {
      readonly renderable: false;
      /** WHY the GLSL backend cannot serve this example, checked rather than believed
       *  (`shade-examples.test.ts`): a substring of the refusal the backend throws, or the
       *  literal `NO_ENTRY_POINT` for a module that emits a stage with no `main()` because it
       *  declares no entry point.
       *
       *  `renderable: false` without one would be a way to opt out of the compile gate for
       *  free; with one, the flag and the reason are both claims a suite can fail. A UNION
       *  rather than an optional field, so `tsc` refuses an entry that leaves it out. */
      readonly reason: string;
    }
);

/** The `reason` of an example whose GLSL stages emit but carry no `main()`, because the module
 *  declares no entry point at all. Not a refusal message — there is no throw to match. */
export const NO_ENTRY_POINT = 'no entry point';

/** The `@example` block every `.shade.ts` file carries, directly after its directive:
 *
 *  ```text
 *  "use typeshade"
 *
 *  / * @example
 *  { "title": "Hello triangle", "blurb": "…", "renderable": true }
 *  * /
 *  ```
 *
 *  Matched non-greedily, so the FIRST block wins and an `@example` mentioned later in prose
 *  cannot shadow it. */
const EXAMPLE_BLOCK = /\/\*\s*@example\s*([\s\S]*?)\*\//;

/** Read one shader's registration out of its own source.
 *
 *  @param id - the file's basename without `.shade.ts`, which is also the registry id.
 *  @param source - the file's bytes.
 *  @returns the hand-written half of the registration.
 *  @throws when the block is missing, is not JSON, or omits a field — each of which would
 *  otherwise leave the example silently unregistered or half-described.
 */
function readSpec(id: string, source: string): ShadeSpec {
  const file = `${id}${SHADE_EXT}`;
  const block = EXAMPLE_BLOCK.exec(source);
  if (block === null) {
    throw new Error(
      `typeshade: ${file} carries no @example block — every shader registers itself, so a file ` +
        `without one would never reach the compile gate or the emit goldens`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1] ?? '');
  } catch (e) {
    throw new Error(
      `typeshade: ${file}'s @example block is not JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const spec = parsed as Partial<Record<string, unknown>>;
  const { title, blurb, renderable, twinOf, reason } = spec;
  if (typeof title !== 'string' || title === '')
    throw new Error(`typeshade: ${file}'s @example block has no "title"`);
  if (typeof blurb !== 'string' || blurb === '')
    throw new Error(`typeshade: ${file}'s @example block has no "blurb"`);
  if (typeof renderable !== 'boolean')
    throw new Error(
      `typeshade: ${file}'s @example block needs "renderable": true or false — authored, never ` +
        `derived, because a flag computed from the emitter agrees with it by construction and ` +
        `the compile gate would then have nothing left to catch`,
    );
  if (twinOf !== undefined && typeof twinOf !== 'string')
    throw new Error(`typeshade: ${file}'s "twinOf" is not a string`);
  const common = { id, title, blurb, ...(twinOf === undefined ? {} : { twinOf }) };
  if (renderable) return { ...common, renderable: true };
  if (typeof reason !== 'string' || reason === '')
    throw new Error(
      `typeshade: ${file} is "renderable": false and states no "reason" — the flag is a claim ` +
        `this package checks (shade-examples.test.ts), not a way out of the compile gate`,
    );
  return { ...common, renderable: false, reason };
}

/** `readSpec` under a name a suite may import: `shade-examples.test.ts` drives it with a
 *  missing, malformed and incomplete block, because refusing those is the whole reason a
 *  shader registering ITSELF is safer than one hand-ordered array. Not part of the corpus. */
export const readSpecForTest = readSpec;

/** Every `.shade.ts` file in this directory, id-sorted, each registered from its own bytes.
 *
 *  SORTED, not curated: nothing pins registry order — `shade-examples.test.ts` sorts both sides
 *  before comparing, `scripts/compile-gate.ts` only iterates, `shade-twins.test.ts` looks
 *  entries up by id, and the goldens are per-id files. Deriving the order from the id rather
 *  than from whichever line an author picked is the second half of removing the conflict class:
 *  there is no longer an order for two branches to disagree about. */
const SHADE_ORDER: readonly ShadeSpec[] = readdirSync(HERE)
  .filter((f) => f.endsWith(SHADE_EXT))
  .map((f) => f.slice(0, -SHADE_EXT.length))
  .sort()
  .map((id) => readSpec(id, readFileSync(join(HERE, `${id}${SHADE_EXT}`), 'utf8')));

/**
 * Compile one `.shade.ts` file into the registry shape the EDSL examples use.
 *
 * A compile error THROWS rather than registering a half-built module. The alternative —
 * registering whatever came back — is the failure this whole file exists to close: an
 * example that silently stops being a program, with every gate still green because the gate
 * is handed an empty module. A warning is not that: `compile()` reports a GLSL ES 3.00
 * refusal of a module whose WGSL exists as a `TS8015` warning (hello-uniform's loose scalar
 * uniform is one), and such an example is still a program, with `renderable: false` saying
 * which target it lacks.
 *
 * @param spec - the hand-written half of the registration.
 * @returns the example, with `module` compiled from the file's own bytes.
 * @throws when the file is missing, or when `compile()` reports an error diagnostic.
 */
function shadeExample(spec: ShadeSpec): ShaderExample {
  const file = `${spec.id}${SHADE_EXT}`;
  const source = readFileSync(join(HERE, file), 'utf8');
  const { diagnostics, module } = compile(source);
  const errors = diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0) {
    const lines = errors.map(
      (d) => `  ${d.category} ${d.line}:${d.character} ${d.code ?? '—'} ${d.message}`,
    );
    throw new Error(`typeshade: ${file} does not compile\n${lines.join('\n')}`);
  }
  return {
    id: spec.id,
    title: spec.title,
    blurb: spec.blurb,
    category: 'source',
    file,
    module,
    renderable: spec.renderable,
  };
}

/** Every `"use typeshade"` example, compiled. Iterated by `scripts/compile-gate.ts` and
 *  `shade-examples.test.ts` alongside `examples`. */
export const shadeExamples: readonly ShaderExample[] = SHADE_ORDER.map((spec) =>
  shadeExample(spec),
);

/** Twin id → the `examples` id it mirrors, for the entries that claim one. Kept here rather
 *  than on `ShaderExample` because the relationship belongs to this corpus: an EDSL example
 *  has no twin field to fill in, and `_shared.ts` is the shape the site consumes. */
export const SHADE_TWINS: ReadonlyMap<string, string> = new Map(
  SHADE_ORDER.flatMap((spec) =>
    spec.twinOf === undefined ? [] : [[spec.id, spec.twinOf] as const],
  ),
);

/** Non-renderable id → the reason its `renderable: false` states, for the suite that checks
 *  the flag rather than believing it (`shade-examples.test.ts`). Kept here beside `SHADE_TWINS`
 *  for the same reason: the relationship belongs to this corpus, and `_shared.ts` is the shape
 *  the site consumes. */
export const SHADE_REFUSALS: ReadonlyMap<string, string> = new Map(
  SHADE_ORDER.flatMap((spec) => (spec.renderable ? [] : [[spec.id, spec.reason] as const])),
);
