import type { Finding } from '../types.js';
import type { Component, FileCohesion } from './components.js';

export const MIN_COMPONENT_LINES = 40;
export const GIANT_SHARE = 0.5;
export const GIANT_MIN_FILE_LINES = 200;

const round = (value: number): number => Math.round(value * 100) / 100;

function componentText(entry: FileCohesion, component: Component): string {
  const names = component.members
    .map((at) => `${entry.declarations[at]!.name}@${entry.declarations[at]!.line}`)
    .join(' ');
  const only = component.onlyImports.length === 0 ? 'none' : component.onlyImports.join(' ');
  return `${component.lines} lines: ${names}; imports only it uses: ${only}`;
}

function giantFinding(file: string, entry: FileCohesion): Finding | undefined {
  const giant = entry.declarations[entry.largest]!;
  const share = giant.lines / entry.fileLines;
  const single = entry.allComponents.length === 1 || entry.components.length === 1;
  if (!single || share < GIANT_SHARE || entry.fileLines < GIANT_MIN_FILE_LINES) return undefined;
  return {
    signal: 'cohesion',
    file,
    line: giant.line,
    kind: 'giant-declaration',
    evidence: {
      declaration: giant.name,
      declarationLines: giant.lines,
      fileLines: entry.fileLines,
      giantShare: round(share),
      references: entry.graph.references[entry.largest]!.size,
      note: 'a split by moving declarations does not separate this declaration; a cut would be inside it',
    },
    remedy: 'design change inside a declaration',
  };
}

function cutFinding(file: string, entry: FileCohesion): Finding | undefined {
  const big = entry.components.filter((component) => component.lines >= MIN_COMPONENT_LINES);
  if (big.length < 2) return undefined;
  const sorted = [...big].sort((a, b) => b.lines - a.lines);
  return {
    signal: 'cohesion',
    file,
    line: Math.min(...sorted.map((component) => entry.declarations[component.members[0]!]!.line)),
    kind: 'cut-line',
    evidence: {
      components: sorted.map((component) => componentText(entry, component)),
      hubs: entry.hubs.map((at) => entry.declarations[at]!.name),
      smallComponents: entry.components.length - big.length,
      fileLines: entry.fileLines,
      giantShare: round(entry.declarations[entry.largest]!.lines / entry.fileLines),
    },
    remedy: 'split along the components',
  };
}

export function findingOf(file: string, entry: FileCohesion): Finding | undefined {
  return cutFinding(file, entry) ?? giantFinding(file, entry);
}
