export function shownNames(uris: readonly string[]): ReadonlyMap<string, string> {
  const segments = new Map(uris.map((uri) => [uri, uri.split(/[\\/]/).filter((s) => s !== '')]));
  const tail = (uri: string, n: number): string => segments.get(uri)!.slice(-n).join('/');
  const out = new Map<string, string>();
  for (const uri of uris) {
    const own = segments.get(uri)!;
    let n = 1;
    while (n < own.length && uris.some((u) => u !== uri && tail(u, n) === tail(uri, n))) n++;
    out.set(uri, n < own.length ? tail(uri, n) : uri);
  }
  return out;
}
