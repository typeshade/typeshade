import { unitsOfPath } from './compare-units.js';
import { createKeyer } from './binding-keys.js';
import { activeUnitsOf } from './clean-files.js';
import { buildImportGraph } from './import-graph.js';
import { createLinks } from './module-links.js';
import { lineCitedPaths } from './line-citations.js';
import { createSide } from './side-program.js';

const SAMPLE_FILES = 3;

interface CleanFileRow {
  readonly path: string;
  readonly units: number;
  readonly activeUnits: number;
  readonly inCycle: boolean;
  readonly citedByLine: boolean;
  readonly citingSegments: number;
}

interface CleanTotals {
  readonly files: number;
  readonly clean: number;
  readonly withActiveUnits: number;
  readonly activeUnits: number;
  readonly units: number;
  readonly inCycles: number;
}

export interface CleanReport {
  readonly total: CleanTotals;
  readonly directories: Record<string, CleanTotals>;
  readonly cycles: { readonly size: number; readonly files: string[] }[];
  readonly files: CleanFileRow[];
}

const isReportedFile = (path: string): boolean =>
  path.startsWith('src/') &&
  path.endsWith('.ts') &&
  !path.endsWith('.test.ts') &&
  !path.endsWith('.d.ts');

export function directoryOf(path: string): string {
  const parts = path.split('/').slice(1, -1);
  return parts.length === 0 ? '.' : parts.slice(0, 2).join('/');
}

const isClean = (row: CleanFileRow): boolean => !row.inCycle && row.activeUnits === 0;

function totalsOf(rows: readonly CleanFileRow[]): CleanTotals {
  return {
    files: rows.length,
    clean: rows.filter(isClean).length,
    withActiveUnits: rows.filter((row) => row.activeUnits > 0).length,
    activeUnits: rows.reduce((sum, row) => sum + row.activeUnits, 0),
    units: rows.reduce((sum, row) => sum + row.units, 0),
    inCycles: rows.filter((row) => row.inCycle).length,
  };
}

export function cleanReport(root: string, texts: ReadonlyMap<string, string>): CleanReport {
  const side = createSide(root, texts);
  const keyer = createKeyer(side, (unit) => `${unit.path}#${unit.index}`);
  const cited = lineCitedPaths(texts);
  const graph = buildImportGraph(side, createLinks(side, keyer));
  const files: CleanFileRow[] = [...texts.keys()]
    .filter(isReportedFile)
    .sort()
    .map((path) => ({
      path,
      units: unitsOfPath(side, path).length,
      activeUnits: activeUnitsOf(side, path).length,
      inCycle: graph.componentSize(path) > 1,
      citedByLine: cited.has(path),
      citingSegments: cited.get(path)?.segments ?? 0,
    }));
  const byDirectory = new Map<string, CleanFileRow[]>();
  for (const row of files) {
    const key = directoryOf(row.path);
    byDirectory.set(key, [...(byDirectory.get(key) ?? []), row]);
  }
  return {
    total: totalsOf(files),
    directories: Object.fromEntries(
      [...byDirectory]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, rows]) => [k, totalsOf(rows)]),
    ),
    cycles: graph.cycles().map((members) => ({ size: members.length, files: members })),
    files,
  };
}

const row = (label: string, t: CleanTotals): string =>
  [label.padEnd(28), t.files, t.clean, t.withActiveUnits, `${t.activeUnits}/${t.units}`, t.inCycles]
    .map((cell, at) => (at === 0 ? cell : String(cell).padStart(at === 4 ? 12 : 8)))
    .join('');

export function formatCleanReport(report: CleanReport): string {
  const header = `${'directory'.padEnd(28)}${'files'.padStart(8)}${'clean'.padStart(8)}${'active'.padStart(8)}${'units'.padStart(12)}${'cycle'.padStart(8)}`;
  const lines = [
    'Clean files of src/ (non-test): a file is clean when it is in no import cycle and has no active unit.',
    'Columns: files, clean files, files with active units, active/all top-level units, files in cycles.',
    header,
    row('total', report.total),
    ...Object.entries(report.directories).map(([name, totals]) => row(name, totals)),
    `Import cycles: ${report.cycles.length}`,
  ];
  for (const cycle of report.cycles) {
    const sample = cycle.files.slice(0, SAMPLE_FILES).join(', ');
    lines.push(`  ${cycle.size} files: ${sample}${cycle.size > SAMPLE_FILES ? ', ...' : ''}`);
  }
  const blocked = report.files.filter((file) => isClean(file) && file.citedByLine);
  lines.push(
    `Clean files cited by line (a move is refused until the citations are symbol anchors): ${blocked.length}`,
  );
  for (const file of blocked) lines.push(`  ${file.path}: ${file.citingSegments} citing segments`);
  return lines.join('\n');
}
