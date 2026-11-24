import { ANCHOR_SEPARATOR } from '../symbol-anchors/grammar.js';
import type { AnchorResolver } from '../symbol-anchors/resolve.js';
import type { Piece } from './parts.js';
import { anchorOf } from './source-index.js';

export interface BuiltAnchors {
  readonly text: string;
  readonly blocked: string | undefined;
}

const keyOf = (piece: Piece): string => anchorOf(piece.decl);

export function collapse(pieces: readonly Piece[]): Piece[] {
  const kept = new Map<string, Piece>();
  for (const piece of pieces) {
    const known = kept.get(keyOf(piece));
    if (known === undefined || (known.needle === undefined && piece.needle !== undefined)) {
      kept.set(keyOf(piece), piece);
    }
  }
  return [...kept.values()];
}

export const anchorText = (piece: Piece): string =>
  piece.needle === undefined ? keyOf(piece) : `${keyOf(piece)}~"${piece.needle}"`;

export function buildAnchors(
  resolver: AnchorResolver,
  path: string,
  pieces: readonly Piece[],
): BuiltAnchors {
  const anchors = collapse(pieces).map(anchorText);
  const text = anchors.join(ANCHOR_SEPARATOR);
  for (const anchor of anchors) {
    const [symbol, member] = (anchor.split('~')[0] ?? '').split('.');
    const needle = /~"([^"]*)"$/.exec(anchor)?.[1];
    const found = resolver.resolve(path, {
      text: anchor,
      ...(symbol === undefined ? {} : { symbol }),
      ...(member === undefined ? {} : { member }),
      ...(needle === undefined ? {} : { needle }),
    });
    if (!found.ok) return { text, blocked: `anchor ${anchor} does not resolve: ${found.message}` };
  }
  return { text, blocked: undefined };
}
