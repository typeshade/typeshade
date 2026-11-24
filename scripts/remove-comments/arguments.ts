export interface RemoveArguments {
  readonly paths: string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly keepInvariants: boolean;
  readonly repo: string | undefined;
}

export function parseArguments(args: readonly string[]): RemoveArguments | undefined {
  const paths: string[] = [];
  let repo: string | undefined;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '--repo') {
      repo = args[(at += 1)];
    } else if (arg === '--') {
      continue;
    } else if (!arg.startsWith('--')) {
      paths.push(arg);
    }
  }
  const known = new Set(['--dry-run', '--json', '--keep-invariants', '--repo']);
  const unknown = args.some((arg) => arg !== '--' && arg.startsWith('--') && !known.has(arg));
  if (paths.length === 0 || unknown || (args.includes('--repo') && repo === undefined)) {
    return undefined;
  }
  return {
    paths,
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    keepInvariants: args.includes('--keep-invariants'),
    repo,
  };
}
