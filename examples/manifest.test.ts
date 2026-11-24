import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGroups, parseManifest, readGroups, readManifest } from './_manifest.js';
import { exampleSource, shadeExamples } from './_shade.js';
import { PATH_ORDER } from './path/_order.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GROUPS = ['works', 'precision', 'feature', 'inspired', 'path'];
const BASE = { title: 'T', blurb: 'B', group: 'works', host: 'run', renderable: true };

function parse(extra: Record<string, unknown>, drop: string[] = []): unknown {
  const fields: Record<string, unknown> = { ...BASE, ...extra };
  for (const k of drop) delete fields[k];
  return parseManifest('demo', 'demo/example.json', JSON.stringify(fields), GROUPS);
}

describe('groups.json', () => {
  it('lists the four groups of change 0145 first, then the path', () => {
    const groups = readGroups();
    expect(groups.map((g) => g.id)).toEqual(GROUPS);
    expect(groups.map((g) => g.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses a repeated id, a missing field and an unknown field', () => {
    const g = { id: 'a', title: 'A', order: 1, rule: 'r' };
    expect(() => parseGroups(JSON.stringify([g, { ...g, order: 2 }]))).toThrow(/repeats an id/);
    expect(() => parseGroups(JSON.stringify([g, { ...g, id: 'b' }]))).toThrow(/repeats an order/);
    expect(() => parseGroups(JSON.stringify([{ id: 'a', title: 'A', order: 1 }]))).toThrow(/rule/);
    expect(() => parseGroups(JSON.stringify([{ ...g, extra: 1 }]))).toThrow(/unknown field/);
    expect(() => parseGroups('[]')).toThrow(/non-empty/);
  });
});

describe('the example.json schema', () => {
  it('accepts the required fields alone and every optional field together', () => {
    expect(parse({})).toMatchObject({ id: 'demo', title: 'T', group: 'works', host: 'run' });
    const full = parse({
      tags: ['a', 'b'],
      tiers: ['webgpu'],
      tierNotes: { webgl2: 'not supported yet', cpu: 'Rule 8.24' },
      extras: ['runSpecialized'],
      demonstrates: 'A report.',
      twinOf: 'x',
      part: 'P',
      step: 3,
    });
    expect(full).toMatchObject({ tiers: ['webgpu'], step: 3, part: 'P' });
    expect(parse({ host: 'pending', waitsFor: '0138 milestone 5' })).toMatchObject({
      waitsFor: '0138 milestone 5',
    });
    expect(parse({ host: 'none' })).toMatchObject({ host: 'none' });
    expect(parse({ renderable: false, reason: 'no entry point' })).toMatchObject({
      renderable: false,
    });
  });

  it.each([
    ['an unknown field', { id: 'demo' }, [], /unknown fields/],
    ['no title', {}, ['title'], /no "title"/],
    ['no blurb', {}, ['blurb'], /no "blurb"/],
    ['no group', {}, ['group'], /groups\.json lacks/],
    ['a group groups.json lacks', { group: 'nope' }, [], /groups\.json lacks/],
    ['no host', {}, ['host'], /"host"/],
    ['a bad host', { host: 'maybe' }, [], /"host"/],
    ['no renderable', {}, ['renderable'], /renderable/],
    ['renderable false without a reason', { renderable: false }, [], /"reason"/],
    ['a repeated tag', { tags: ['a', 'a'] }, [], /"tags"/],
    ['an empty tiers list', { tiers: [] }, [], /"tiers"/],
    ['an unknown tier', { tiers: ['metal'] }, [], /"tiers"/],
    ['an omitted tier with no note', { tiers: ['webgpu', 'cpu'] }, [], /"tierNotes"/],
    ['a note for a tier that runs', { tierNotes: { cpu: 'x' } }, [], /"tierNotes"/],
    ['pending without waitsFor', { host: 'pending' }, [], /"waitsFor"/],
    ['waitsFor on a run host', { waitsFor: '0138' }, [], /"waitsFor"/],
    ['extras on a pending host', { host: 'pending', waitsFor: 'x', extras: ['a'] }, [], /"extras"/],
    ['an extra that is no name', { extras: ['not a name'] }, [], /"extras"/],
    ['an empty demonstrates', { demonstrates: '' }, [], /"demonstrates"/],
    ['a step without a part', { step: 1 }, [], /together or neither/],
    ['a step of 0', { part: 'P', step: 0 }, [], /"step"/],
    ['a fractional step', { part: 'P', step: 1.5 }, [], /"step"/],
  ])('refuses %s', (_name, extra, drop, message) => {
    expect(() => parse(extra, drop)).toThrow(message);
  });

  it('refuses text that is not a JSON object', () => {
    const read = (text: string): unknown =>
      parseManifest('demo', 'demo/example.json', text, GROUPS);
    expect(() => read('{')).toThrow(/not JSON/);
    expect(() => read('[]')).toThrow(/not a JSON object/);
  });
});

describe('each example.json in the tree', () => {
  const dirs = ['path', 'gallery'].flatMap((place) =>
    readdirSync(join(HERE, place), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(HERE, place, d.name, 'example.json')))
      .map((d) => [place, d.name] as const),
  );

  it('is found in the 13 path steps', () => {
    expect(
      dirs
        .filter(([place]) => place === 'path')
        .map(([, id]) => id)
        .sort(),
    ).toEqual([...PATH_ORDER].sort());
  });

  it.each(dirs)('%s/%s passes the schema and sits beside its module', (place, id) => {
    const dir = join(HERE, place, id);
    const m = readManifest(dir, id);
    expect(existsSync(join(dir, `${id}.shade.ts`))).toBe(true);
    expect(existsSync(join(dir, 'host.ts')) === (m.host === 'run')).toBe(true);
    expect(readFileSync(join(dir, `${id}.shade.ts`), 'utf8')).not.toContain('@example');
    const registered = shadeExamples.find((e) => e.id === id)!;
    expect(registered.title).toBe(m.title);
    expect(registered.blurb).toBe(m.blurb);
    expect(registered.renderable).toBe(m.renderable);
  });

  it('is found in the gallery directories, and an fp64- id is in the precision group', () => {
    const gallery = dirs.filter(([place]) => place === 'gallery');
    expect(gallery.length).toBeGreaterThan(25);
    for (const [, id] of gallery) {
      const m = readManifest(join(HERE, 'gallery', id), id);
      expect(m.group === 'precision', id).toBe(id.startsWith('fp64-'));
    }
  });

  it('gives the path steps a rising step number along _order.ts', () => {
    const steps = PATH_ORDER.map((id) => readManifest(join(HERE, 'path', id), id).step!);
    expect(steps.every((s, i) => i === 0 || s > steps[i - 1]!)).toBe(true);
  });

  it('gives each path step the path group', () => {
    for (const id of PATH_ORDER)
      expect(readManifest(join(HERE, 'path', id), id).group, id).toBe('path');
  });
});

describe('after the last move of M4.3 (change 0145, amendment A2)', () => {
  it('leaves no top-level module, and every gallery module has an example.json and no header', () => {
    expect(shadeExamples.filter((e) => dirname(e.file) === '.').map((e) => e.id)).toEqual([]);
    const gallery = shadeExamples.filter((x) => dirname(x.file).startsWith('gallery/'));
    expect(gallery.length).toBeGreaterThan(90);
    for (const e of gallery) {
      expect(existsSync(join(HERE, dirname(e.file), 'example.json')), e.id).toBe(true);
      expect(exampleSource(e.id), e.id).not.toContain('@example');
    }
  });
});
