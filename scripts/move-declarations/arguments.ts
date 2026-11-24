export interface MoveOptions {
  readonly from: string;
  readonly to: string;
  readonly names: readonly string[];
  readonly closure: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly keep: boolean;
  readonly bake: boolean;
  readonly repo: string | undefined;
}

export const USAGE =
  'Usage: bun scripts/move-declarations.ts --from <source.ts> --to <target.ts> --move <name>[,<name>...] [--closure] [--dry-run] [--json] [--keep] [--bake] [--repo <path>]';

const VALUE_FLAGS = new Set(['--from', '--to', '--move', '--repo']);
const SWITCHES = new Set(['--closure', '--dry-run', '--json', '--keep', '--bake']);

export function parseArguments(args: readonly string[]): MoveOptions | string {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let at = 0; at < args.length; at += 1) {
    const flag = args[at]!;
    if (SWITCHES.has(flag)) switches.add(flag);
    else if (VALUE_FLAGS.has(flag) && args[at + 1] !== undefined) {
      values.set(flag, args[at + 1]!);
      at += 1;
    } else return `Unknown or incomplete argument: ${flag}`;
  }
  const names = (values.get('--move') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const from = values.get('--from');
  const to = values.get('--to');
  if (from === undefined || to === undefined || names.length === 0) {
    return 'Give --from, --to and at least one name in --move.';
  }
  return {
    from,
    to,
    names,
    closure: switches.has('--closure'),
    dryRun: switches.has('--dry-run'),
    json: switches.has('--json'),
    keep: switches.has('--keep'),
    bake: switches.has('--bake'),
    repo: values.get('--repo'),
  };
}
