import ts from 'typescript';

export function writtenMemberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

export const isPrivateName = (written: string): boolean => written.startsWith('#');

export const emittedMemberName = (written: string): string =>
  isPrivateName(written) ? written.slice(1) : written;

export const accessorFnName = (struct: string, half: 'get' | 'set', written: string): string =>
  `${struct}_${half}_${emittedMemberName(written)}`;
