export const AREA_DEFINITION =
  'area = core/<dir> for a file under src/core/<dir>/ (a file directly in src/core/ is area core); ' +
  'compiler/ts/<dir> for a file under src/compiler/ts/<dir>/ (likewise); ' +
  'otherwise the top directory under src (a file directly in src is area src). ' +
  'A parent area and a child area are not other areas of each other: an area that contains the area of the file, or lies inside it, is left out of the count of BREADTH (for example core and core/ir).';

export function areasNest(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

const SUBDIVIDED: readonly (readonly string[])[] = [['core'], ['compiler', 'ts']];

export function areaOf(relPath: string): string {
  const parts = relPath.split('/');
  if (parts[0] !== 'src') return parts[0] ?? '';
  const inner = parts.slice(1, -1);
  if (inner.length === 0) return 'src';
  for (const prefix of SUBDIVIDED) {
    const matches = prefix.every((segment, at) => inner[at] === segment);
    if (!matches) continue;
    const next = inner[prefix.length];
    return next === undefined ? prefix.join('/') : [...prefix, next].join('/');
  }
  return inner[0]!;
}
