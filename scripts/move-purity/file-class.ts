export const fileClassOf = (path: string): string => {
  if (path.endsWith('.shade.ts')) return 'shade';
  if (path.endsWith('.test.ts')) return 'test';
  if (path.endsWith('.d.ts')) return 'dts';
  return 'source';
};
