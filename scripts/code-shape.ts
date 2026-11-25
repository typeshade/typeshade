import { breadth, summariseBreadth } from './code-shape/breadth.js';
import { createContext, relativeToRoot } from './code-shape/context.js';
import { home, summariseHome } from './code-shape/home.js';
import { layer, summariseLayer } from './code-shape/layer.js';
import { formatJson, formatMarkdown, type SignalReport } from './code-shape/report.js';
import type { Finding, ShapeContext, Signal, SignalName } from './code-shape/types.js';

export interface RegisteredSignal {
  name: SignalName;
  run: Signal;
  summarise(ctx: ShapeContext, findings: readonly Finding[]): string[];
}

export const SIGNALS: readonly RegisteredSignal[] = [
  { name: 'layer', run: layer, summarise: summariseLayer },
  { name: 'breadth', run: breadth, summarise: summariseBreadth },
  { name: 'home', run: home, summarise: summariseHome },
];

const USAGE = 'Usage: bun scripts/code-shape.ts [--json] [--file <path>...] [--repo <path>]';

interface Options {
  json: boolean;
  files: string[];
  repo: string | undefined;
}

function parseArgs(args: readonly string[]): Options | undefined {
  const options: Options = { json: false, files: [], repo: undefined };
  let collecting = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '--json') {
      options.json = true;
      collecting = false;
    } else if (arg === '--file') {
      collecting = true;
      if (!(args[at + 1] ?? '--').startsWith('--')) continue;
      return undefined;
    } else if (arg === '--repo') {
      collecting = false;
      const value = args[at + 1];
      if (value === undefined || value.startsWith('--')) return undefined;
      options.repo = value;
      at += 1;
    } else if (collecting && !arg.startsWith('--')) {
      options.files.push(arg);
    } else {
      return undefined;
    }
  }
  return options;
}

export function runCli(args: string[], cwd: string): number {
  const options = parseArgs(args);
  if (options === undefined) {
    console.error(USAGE);
    return 2;
  }
  const root = options.repo ?? cwd;
  const files =
    options.files.length === 0
      ? undefined
      : options.files.map((path) => relativeToRoot(root, path));
  const ctx = createContext({ root, files });
  const signals: SignalReport[] = SIGNALS.map((signal) => {
    const findings = signal.run(ctx);
    return { name: signal.name, summary: signal.summarise(ctx, findings), findings };
  });
  const report = {
    allFiles: ctx.all.length,
    analysedFiles: ctx.analysed.length,
    skipped: ctx.skipped,
    signals,
  };
  console.log(options.json ? formatJson(report) : formatMarkdown(report));
  return 0;
}

if (import.meta.main) process.exit(runCli(process.argv.slice(2), process.cwd()));
