import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function frontEndSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return frontEndSources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

export function remedySitesIn(path: string): string[] {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`\s*\+\s*`/g, '')
    .replace(/\s*\n\s*/g, ' ');
  return [...source.matchAll(/[Ww]rite \\?"[^`]{0,80}/g)].map((m) => m[0]);
}
