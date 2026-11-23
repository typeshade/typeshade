// ═══ The `example.json` manifest and `groups.json` (change 0145, amendment A2) ═══
//
// A directory that holds `example.json` states its hand-written metadata there, as plain JSON
// beside the module. A module without one states it in its `@example` header block, which
// `_shade.ts` reads until the last module has a manifest. Both readers share `parseSpecFields`,
// so a field means one thing in both places. `parseManifest` adds the fields only a manifest
// has and refuses a field it does not know.
//
// Node-only: `readManifest` and `readGroups` read the filesystem.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShaderPass } from './_shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const MANIFEST_FILE = 'example.json';
export const GROUPS_FILE = join(HERE, 'groups.json');

export const TIERS = ['webgpu', 'webgl2', 'cpu'] as const;
export type Tier = (typeof TIERS)[number];

export const HOST_KINDS = ['run', 'pending', 'none'] as const;
export type HostKind = (typeof HOST_KINDS)[number];

export type ExampleSpec = {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly twinOf?: string;
  readonly passes?: readonly Pick<ShaderPass, 'name' | 'file'>[];
} & ({ readonly renderable: true } | { readonly renderable: false; readonly reason: string });

export type Manifest = ExampleSpec & {
  readonly group: string;
  readonly host: HostKind;
  readonly tags?: readonly string[];
  readonly tiers?: readonly Tier[];
  readonly tierNotes?: Readonly<Partial<Record<Tier, string>>>;
  readonly waitsFor?: string;
  readonly extras?: readonly string[];
  readonly demonstrates?: string;
  readonly part?: string;
  readonly step?: number;
};

export interface Group {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly rule: string;
}

const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'blurb',
  'group',
  'tags',
  'tiers',
  'tierNotes',
  'host',
  'waitsFor',
  'extras',
  'demonstrates',
  'renderable',
  'reason',
  'twinOf',
  'passes',
  'part',
  'step',
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isWords(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string' && x !== '');
}

export function parseSpecFields(
  id: string,
  file: string,
  label: string,
  spec: Partial<Record<string, unknown>>,
): ExampleSpec {
  const { title, blurb, renderable, twinOf, reason, passes } = spec;
  if (typeof title !== 'string' || title === '')
    throw new Error(`typeshade: ${file}'s ${label} has no "title"`);
  if (typeof blurb !== 'string' || blurb === '')
    throw new Error(`typeshade: ${file}'s ${label} has no "blurb"`);
  if (typeof renderable !== 'boolean')
    throw new Error(
      `typeshade: ${file}'s ${label} needs "renderable": true or false — authored, never ` +
        `derived, because a flag computed from the emitter agrees with it by construction and ` +
        `the compile gate would then have nothing left to catch`,
    );
  if (twinOf !== undefined && typeof twinOf !== 'string')
    throw new Error(`typeshade: ${file}'s "twinOf" is not a string`);
  if (
    passes !== undefined &&
    (!Array.isArray(passes) ||
      passes.length === 0 ||
      !passes.every(
        (x: unknown) =>
          typeof x === 'object' &&
          x !== null &&
          typeof (x as Record<string, unknown>)['name'] === 'string' &&
          typeof (x as Record<string, unknown>)['file'] === 'string',
      ))
  )
    throw new Error(
      `typeshade: ${file}'s "passes" is not a list of { "name", "file" } with string fields`,
    );
  if (passes !== undefined && renderable !== true)
    throw new Error(
      `typeshade: ${file} names passes and is not "renderable": true — an example drawn in ` +
        `several passes is drawn, so it has a GLSL ES 3.00 form the compile gate links`,
    );
  const common = {
    id,
    title,
    blurb,
    ...(twinOf === undefined ? {} : { twinOf }),
    ...(passes === undefined
      ? {}
      : {
          passes: (passes as { name: string; file: string }[]).map(({ name, file: f }) => ({
            name,
            file: f,
          })),
        }),
  };
  if (renderable) return { ...common, renderable: true };
  if (typeof reason !== 'string' || reason === '')
    throw new Error(
      `typeshade: ${file} is "renderable": false and states no "reason" — the flag is a claim ` +
        `this package checks (shade-examples.test.ts), not a way out of the compile gate`,
    );
  return { ...common, renderable: false, reason };
}

export function parseManifest(
  id: string,
  where: string,
  text: string,
  groups: readonly string[],
): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `typeshade: ${where} is not JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`typeshade: ${where} is not a JSON object`);
  const m = parsed as Partial<Record<string, unknown>>;
  const unknown = Object.keys(m).filter((k) => !MANIFEST_FIELDS.has(k));
  if (unknown.length > 0)
    throw new Error(`typeshade: ${where} has unknown fields ${JSON.stringify(unknown)}`);
  const spec = parseSpecFields(id, where, 'manifest', m);
  const { group, host, tags, tiers, tierNotes, waitsFor, extras, demonstrates, part, step } = m;
  if (typeof group !== 'string' || !groups.includes(group))
    throw new Error(
      `typeshade: ${where} has group ${JSON.stringify(group)}, which groups.json lacks ` +
        `(${JSON.stringify(groups)})`,
    );
  if (typeof host !== 'string' || !(HOST_KINDS as readonly string[]).includes(host))
    throw new Error(`typeshade: ${where} needs "host": "run", "pending" or "none"`);
  if (tags !== undefined && (!isWords(tags) || new Set(tags).size !== tags.length))
    throw new Error(`typeshade: ${where}'s "tags" is not a list of distinct words`);
  if (
    tiers !== undefined &&
    (!isWords(tiers) ||
      tiers.length === 0 ||
      new Set(tiers).size !== tiers.length ||
      !tiers.every((t) => (TIERS as readonly string[]).includes(t)))
  )
    throw new Error(`typeshade: ${where}'s "tiers" is not a non-empty list of ${TIERS.join(', ')}`);
  const omitted = TIERS.filter(
    (t) => !((tiers as readonly string[] | undefined) ?? TIERS).includes(t),
  );
  const noted =
    tierNotes === undefined
      ? []
      : typeof tierNotes === 'object' && tierNotes !== null && !Array.isArray(tierNotes)
        ? Object.keys(tierNotes)
        : null;
  if (
    noted === null ||
    noted.length !== omitted.length ||
    !omitted.every(
      (t) =>
        typeof (tierNotes as Record<string, unknown> | undefined)?.[t] === 'string' &&
        (tierNotes as Record<string, string>)[t] !== '',
    )
  )
    throw new Error(
      `typeshade: ${where}'s "tierNotes" needs one line for each tier "tiers" omits ` +
        `(${JSON.stringify(omitted)}) and none for another`,
    );
  if (host === 'pending' ? typeof waitsFor !== 'string' || waitsFor === '' : waitsFor !== undefined)
    throw new Error(`typeshade: ${where} has "waitsFor" exactly when "host" is "pending"`);
  if (
    extras !== undefined &&
    (host !== 'run' || !isWords(extras) || !extras.every((x) => IDENTIFIER.test(x)))
  )
    throw new Error(
      `typeshade: ${where}'s "extras" is a list of export names, and needs "host": "run"`,
    );
  if (demonstrates !== undefined && (typeof demonstrates !== 'string' || demonstrates === ''))
    throw new Error(`typeshade: ${where}'s "demonstrates" is not a sentence`);
  if ((part === undefined) !== (step === undefined))
    throw new Error(`typeshade: ${where} has "part" and "step" together or neither`);
  if (part !== undefined && (typeof part !== 'string' || part === ''))
    throw new Error(`typeshade: ${where}'s "part" is not a name`);
  if (step !== undefined && (typeof step !== 'number' || !Number.isInteger(step) || step < 1))
    throw new Error(`typeshade: ${where}'s "step" is not a whole number from 1`);
  return {
    ...spec,
    group,
    host: host as HostKind,
    ...(tags === undefined ? {} : { tags }),
    ...(tiers === undefined ? {} : { tiers: tiers as Tier[] }),
    ...(tierNotes === undefined ? {} : { tierNotes: tierNotes as Partial<Record<Tier, string>> }),
    ...(waitsFor === undefined ? {} : { waitsFor: waitsFor as string }),
    ...(extras === undefined ? {} : { extras }),
    ...(demonstrates === undefined ? {} : { demonstrates: demonstrates as string }),
    ...(part === undefined ? {} : { part: part as string, step: step as number }),
  };
}

export function parseGroups(text: string): readonly Group[] {
  const parsed: unknown = JSON.parse(text);
  const fail = (why: string): never => {
    throw new Error(`typeshade: examples/groups.json ${why}`);
  };
  if (!Array.isArray(parsed) || parsed.length === 0) return fail('is not a non-empty list');
  const groups = parsed.map((g: unknown): Group => {
    const r = (typeof g === 'object' && g !== null ? g : {}) as Partial<Record<string, unknown>>;
    const { id, title, order, rule } = r;
    if (Object.keys(r).some((k) => !['id', 'title', 'order', 'rule'].includes(k)))
      fail(`has a group with an unknown field: ${JSON.stringify(r)}`);
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))
      return fail(`has a bad id: ${JSON.stringify(id)}`);
    if (typeof title !== 'string' || title === '') return fail(`group ${id} has no title`);
    if (typeof order !== 'number' || !Number.isInteger(order))
      return fail(`group ${id} has no whole "order"`);
    if (typeof rule !== 'string' || rule === '') return fail(`group ${id} has no rule`);
    return { id, title, order, rule };
  });
  if (new Set(groups.map((g) => g.id)).size !== groups.length) fail('repeats an id');
  if (new Set(groups.map((g) => g.order)).size !== groups.length) fail('repeats an order');
  return groups;
}

export function readGroups(): readonly Group[] {
  return parseGroups(readFileSync(GROUPS_FILE, 'utf8'));
}

export function hasManifest(dir: string): boolean {
  return existsSync(join(dir, MANIFEST_FILE));
}

export function readManifest(dir: string, id: string): Manifest {
  const file = join(dir, MANIFEST_FILE);
  return parseManifest(
    id,
    file.slice(HERE.length + 1),
    readFileSync(file, 'utf8'),
    readGroups().map((g) => g.id),
  );
}
