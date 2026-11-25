import type { ProgramFile } from './types.js';

function wordOf(text: string): string {
  const word = text.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  if (word === '') return 'module';
  return /^[0-9]/.test(word) ? `m${word}` : word;
}

export function stemOf(file: Pick<ProgramFile, 'name' | 'pkg'>): string {
  const base = file.name
    .slice(file.name.lastIndexOf('/') + 1)
    .replace(/(\.shade)?\.[mc]?tsx?$/, '');
  return file.pkg === undefined ? wordOf(base) : `${wordOf(file.pkg)}_${wordOf(base)}`;
}

export function shownPath(file: string): string {
  const at = file.indexOf('node_modules/');
  return at > 0 && file[at - 1] !== '/' ? file : at >= 0 ? file.slice(at) : file;
}
