const PREFERRED_CONDITIONS = ['default', 'import', 'types'];

function targetOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const conditions = value as Record<string, unknown>;
  for (const name of PREFERRED_CONDITIONS) {
    const found = targetOf(conditions[name]);
    if (found !== undefined) return found;
  }
  return Object.values(conditions)
    .map(targetOf)
    .find((t) => t !== undefined);
}

function sourceOf(target: string): string {
  const path = target.replace(/^\.\//, '');
  const built = /^dist\/(src\/.*)\.js$/.exec(path);
  return built ? `${built[1]}.ts` : path;
}

export function packageEntries(texts: ReadonlyMap<string, string>): Map<string, string> {
  const entries = new Map<string, string>();
  const text = texts.get('package.json');
  if (text === undefined) return entries;
  let manifest: { name?: string; exports?: Record<string, unknown> };
  try {
    manifest = JSON.parse(text) as typeof manifest;
  } catch {
    return entries;
  }
  const { name, exports } = manifest;
  if (typeof name !== 'string' || typeof exports !== 'object' || exports === null) return entries;
  for (const [subpath, value] of Object.entries(exports)) {
    const target = targetOf(value);
    if (target === undefined || !subpath.startsWith('.')) continue;
    const file = sourceOf(target);
    if (file.endsWith('.ts') && texts.has(file)) {
      entries.set(subpath === '.' ? name : `${name}${subpath.slice(1)}`, file);
    }
  }
  return entries;
}
