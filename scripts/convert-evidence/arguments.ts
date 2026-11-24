export interface ConvertArguments {
  readonly mode: 'report' | 'write';
  readonly json: boolean;
  readonly only: 'exact' | undefined;
  readonly file: string | undefined;
  readonly cited: string | undefined;
  readonly queue: string | undefined;
  readonly repo: string | undefined;
}

const VALUE_FLAGS = ['--file', '--cited', '--queue', '--repo', '--only'] as const;
const SWITCHES = ['--report', '--write', '--json'] as const;

export function parseArguments(args: readonly string[]): ConvertArguments | undefined {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '--') continue;
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = args[(at += 1)];
      if (value === undefined || value.startsWith('--')) return undefined;
      values.set(arg, value);
    } else if ((SWITCHES as readonly string[]).includes(arg)) {
      switches.add(arg);
    } else {
      return undefined;
    }
  }
  const only = values.get('--only');
  if (only !== undefined && only !== 'exact') return undefined;
  if (switches.has('--report') && switches.has('--write')) return undefined;
  const write = switches.has('--write');
  if (write && only === undefined) return undefined;
  if (!write && only !== undefined) return undefined;
  return {
    mode: write ? 'write' : 'report',
    json: switches.has('--json'),
    only: only === 'exact' ? 'exact' : undefined,
    file: values.get('--file'),
    cited: values.get('--cited'),
    queue: values.get('--queue'),
    repo: values.get('--repo'),
  };
}
