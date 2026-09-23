// ═══ Every `"use typeshade"` block in the docs compiles ═══
//
// The drift this catches, measured 2026-09-14: README.md, docs/use-typeshade-surface.md §8
// and the org profile all carried the same Camera/paint example with `@align(16)` on a
// struct field — and the compiler REJECTS a field `@align` on purpose (structs.ts, "@align
// on a field is not applied", TS8010). The repository's front page therefore opened with a
// shader that does not compile. Nothing in the suite read the docs, so nothing said so.
//
// WHAT IS COMPILED. Every ```ts / ```typescript fence in README.md, AUTHORING.md,
// docs/*.md and examples/*.md that declares itself a TypeShade compilation unit. AUTHORING.md
// is the user guide typeshade.dev renders section by section, so a sample there that stopped
// compiling is on the website too:
//
//   single   the first code line is the `"use typeshade"` directive → compileTsSource
//   multi    `// name.ts` headers split the block into several files, each with the
//            directive → compileTsSources (a list of { fileName, source }); the LAST
//            section is the entry, which is how the docs order them
//
// A fence with no directive anywhere is a grammar fragment (a bare `class` body, a host-side
// snippet) and is not a compilation unit — those are skipped. The gate is that a fence which
// DOES mention the directive but fits neither shape fails the test rather than being quietly
// skipped, so a half-written example cannot hide in the "fragment" bucket. The documented
// escape hatch is an explicit marker directly above the fence:
//
//   <!-- doc-snippets: skip — why this block cannot be compiled -->
//
// and the reason is required, so a skip always carries its justification in the doc itself.
//
// WHY ERRORS ONLY. `diagnostics` also carries warnings, which say how an example could be
// written better; an error, by contrast, means the example cannot become shader code at all.
// Asserting on errors is the claim the docs actually make. (A return type an example leaves off
// is the body's to say, Rule 8.19; it was a "defaulting to void" warning before.)

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { compileTsSources } from './module.js';
import { USE_TYPESHADE } from './directive.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const markdownIn = (dir: string): string[] =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `${dir}/${f}`);

const DOC_FILES = ['README.md', 'AUTHORING.md', ...markdownIn('docs'), ...markdownIn('examples')];

/** A fenced TypeScript block, located by the doc file and the 1-based line its code starts on. */
interface Fence {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly skip?: string;
}

const FENCE_OPEN = /^```(ts|typescript)\s*$/;
const SKIP_MARKER = /^<!--\s*doc-snippets:\s*skip\s*(.*?)\s*-->$/;
/** `// math.ts` — the file header the multi-file doc examples use. */
const FILE_HEADER = /^\/\/\s*([A-Za-z0-9_./-]+\.ts)\s*$/;
const DIRECTIVE = new RegExp(`^["']${USE_TYPESHADE}["'];?$`);

function fences(file: string): Fence[] {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const out: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN.test(lines[i]!.trim())) continue;
    let end = i + 1;
    while (end < lines.length && lines[end]!.trim() !== '```') end++;
    // The marker sits on the closest preceding non-blank line.
    let before = i - 1;
    while (before >= 0 && lines[before]!.trim() === '') before--;
    const marker = before >= 0 ? SKIP_MARKER.exec(lines[before]!.trim()) : null;
    out.push({
      file,
      line: i + 2,
      code: lines.slice(i + 1, end).join('\n'),
      ...(marker ? { skip: marker[1] ?? '' } : {}),
    });
    i = end;
  }
  return out;
}

/** Split `// name.ts` sections into a record, or undefined when the block is not multi-file. */
function splitFiles(code: string): { files: Record<string, string>; entry: string } | undefined {
  const lines = code.split('\n');
  const files: Record<string, string> = {};
  let current: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (current) files[current] = body.join('\n').trim() + '\n';
  };
  for (const line of lines) {
    const header = FILE_HEADER.exec(line.trim());
    if (header) {
      flush();
      current = header[1]!;
      body = [];
      continue;
    }
    if (!current) {
      // Code before the first header: not the multi-file shape.
      if (line.trim() !== '') return undefined;
      continue;
    }
    body.push(line);
  }
  flush();
  const names = Object.keys(files);
  if (names.length < 2) return undefined;
  return { files, entry: names[names.length - 1]! };
}

function firstCodeLine(code: string): string {
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (t !== '') return t;
  }
  return '';
}

type Unit =
  | { kind: 'single'; fence: Fence }
  | { kind: 'multi'; fence: Fence; files: Record<string, string>; entry: string }
  | { kind: 'fragment'; fence: Fence }
  | { kind: 'skipped'; fence: Fence; reason: string }
  | { kind: 'malformed'; fence: Fence };

function classify(fence: Fence): Unit {
  if (fence.skip !== undefined) return { kind: 'skipped', fence, reason: fence.skip };
  const mentionsDirective = fence.code.split('\n').some((l) => DIRECTIVE.test(l.trim()));
  if (!mentionsDirective) return { kind: 'fragment', fence };
  if (DIRECTIVE.test(firstCodeLine(fence.code))) return { kind: 'single', fence };
  const split = splitFiles(fence.code);
  if (split && Object.values(split.files).every((src) => DIRECTIVE.test(firstCodeLine(src)))) {
    return { kind: 'multi', fence, files: split.files, entry: split.entry };
  }
  return { kind: 'malformed', fence };
}

const UNITS = DOC_FILES.flatMap((f) => fences(f).map(classify));

function errorsOf(diagnostics: readonly TsCompilerDiagnostic[]): string[] {
  return diagnostics
    .filter((d) => d.category === 'error')
    .map((d) => `${d.fileName}:${d.line}:${d.character} ${d.code ?? '-'} ${d.message}`);
}

describe('documentation snippets compile', () => {
  // A broken extractor (a fence syntax change, a moved docs/ directory) would make every
  // assertion below vacuous while staying green. This is the arm that notices.
  it('finds compilation units in the docs', () => {
    const compiled = UNITS.filter((u) => u.kind === 'single' || u.kind === 'multi');
    expect(compiled.length).toBeGreaterThanOrEqual(6);
    expect(UNITS.some((u) => u.fence.file === 'README.md' && u.kind === 'single')).toBe(true);
  });

  it('has no block that claims the directive without being a compilation unit', () => {
    const malformed = UNITS.filter((u) => u.kind === 'malformed').map(
      (u) => `${u.fence.file}:${u.fence.line}`,
    );
    // Fix the block, or mark it `<!-- doc-snippets: skip — reason -->` above the fence.
    expect(malformed).toEqual([]);
  });

  it('gives every skipped block a reason', () => {
    for (const u of UNITS) {
      if (u.kind !== 'skipped') continue;
      expect(u.reason, `${u.fence.file}:${u.fence.line} skip marker has no reason`).not.toBe('');
    }
  });

  const single = UNITS.filter((u): u is Extract<Unit, { kind: 'single' }> => u.kind === 'single');
  for (const u of single) {
    it(`${u.fence.file}:${u.fence.line} compiles`, () => {
      const r = compileTsSource(u.fence.code, {
        fileName: `${u.fence.file}:${u.fence.line}.ts`,
        requireDirective: true,
      });
      expect(errorsOf(r.diagnostics)).toEqual([]);
    });
  }

  const multi = UNITS.filter((u): u is Extract<Unit, { kind: 'multi' }> => u.kind === 'multi');
  for (const u of multi) {
    const names = Object.keys(u.files).join(' + ');
    it(`${u.fence.file}:${u.fence.line} compiles as a module (${names})`, () => {
      const r = compileTsSources(
        Object.entries(u.files).map(([fileName, source]) => ({ fileName, source })),
        u.entry,
      );
      expect(errorsOf(r.diagnostics)).toEqual([]);
    });
  }
});
