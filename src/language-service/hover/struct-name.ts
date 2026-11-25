export function withDeclaredName(name: string, emitted: string, to: string): string {
  if (name === emitted) return to;
  return name.startsWith(`${emitted}_`) ? `${to}${name.slice(emitted.length)}` : name;
}
