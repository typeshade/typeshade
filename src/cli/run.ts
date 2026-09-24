// === The `typeshade` command, over an injected host ===
//
// Argument parsing, file discovery and output, with every filesystem and process call behind
// `CliHost`. `bin.ts` supplies the Node host; a test supplies an in-memory one. Keeping the
// command host-free is what keeps `src/` free of host types (tsconfig.json `types: []`), which
// the library has never needed and the command should not be the reason it starts to.

import { checkDocuments, type CheckDocument } from '../language-service/check.js';
import { CHECK_FORMATS, formatCheckReport, type CheckFormat } from './format.js';
import {
  formatBuildErrors,
  hostFace,
  hostViewPath,
  isShaderModulePath,
} from '../compiler/ts/host-face.js';

/** What the command needs from its host. Paths are absolute, joined with `/`. */
export interface CliHost {
  /** The working directory, absolute. */
  readonly cwd: string;
  readFile(path: string): string | undefined;
  /** Write `text` to the file at `path`, replacing it; `typeshade sync` writes host views. */
  writeFile(path: string, text: string): void;
  /** `'file'`, `'directory'`, or `undefined` when nothing is at `path`. */
  kind(path: string): 'file' | 'directory' | undefined;
  /** The names directly inside the directory at `path`. */
  list(path: string): readonly string[];
  stdout(text: string): void;
  stderr(text: string): void;
}

/** The package version the command reports for `--version`. */
export interface CliInfo {
  readonly version: string;
}

/** Directories a walk never enters: installed packages, build output and version control. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git']);

/** The file suffix a directory walk collects, the same default filter the Vite plugin uses. */
const SHADE_SUFFIX = '.shade.ts';

export const USAGE = `Usage: typeshade check [options] [paths...]
       typeshade sync [--check] [paths...]

Checks "use typeshade" files the way the editor does, and runs the WGSL and GLSL
backends the way compile() does. A directory is searched for *.shade.ts files
(node_modules, dist and .git are skipped); a file is checked whatever its name.
With no path, the working directory is searched.

sync writes the host view of each *.shade.ts beside it, name.shade.typeshade.ts,
which a host tsconfig with moduleSuffixes [".typeshade", ""] reads for an import of
the module (the Vite plugin rewrites them as modules change). Run it before tsc on
a clean checkout; its home is the "prepare" script. With --check it writes
nothing and fails when a view is missing or stale.

Options:
  --check                     sync: check the views instead of writing them
  --format <text|short|json>  text (default): each diagnostic with its source line
                              short: one line per diagnostic
                              json: the report as data (one-based lines and columns)
  --deprecations              also report deprecation warnings (TS8053)
  -h, --help                  show this help
  -v, --version               show the version

Exit status: 0 when no error was found, 1 when at least one was, 2 when the
command itself could not run (a bad option, a missing path, no files to check).
`;

/** `a/b` joined onto `base`, with `.` and `..` segments resolved. */
function resolvePath(base: string, path: string): string {
  const joined = path.startsWith('/') ? path : `${base.replace(/\/+$/, '')}/${path}`;
  const parts: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** `path` relative to `from`, for display; `path` itself when it is not under `from`. */
function relativeTo(from: string, path: string): string {
  const prefix = from.endsWith('/') ? from : `${from}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function walk(host: CliHost, dir: string, out: string[]): void {
  for (const name of [...host.list(dir)].sort()) {
    const path = `${dir}/${name}`;
    const kind = host.kind(path);
    if (kind === 'directory') {
      if (!SKIPPED_DIRECTORIES.has(name)) walk(host, path, out);
    } else if (kind === 'file' && name.endsWith(SHADE_SUFFIX)) out.push(path);
  }
}

interface ParsedArgs {
  readonly command?: string;
  readonly paths: readonly string[];
  readonly format: CheckFormat;
  readonly deprecations: boolean;
  readonly check: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | undefined;
  const paths: string[] = [];
  let format: CheckFormat = 'text';
  let deprecations = false;
  let check = false;
  let help = false;
  let version = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '-v' || arg === '--version') version = true;
    else if (arg === '--deprecations') deprecations = true;
    else if (arg === '--check') check = true;
    else if (arg === '--format' || arg.startsWith('--format=')) {
      const value = arg === '--format' ? argv[++i] : arg.slice('--format='.length);
      if (!(CHECK_FORMATS as readonly string[]).includes(value ?? '')) {
        return {
          paths,
          format,
          deprecations,
          check,
          help,
          version,
          error: `--format takes one of ${CHECK_FORMATS.join(', ')}; got ${value === undefined ? 'nothing' : JSON.stringify(value)}.`,
        };
      }
      format = value as CheckFormat;
    } else if (arg.startsWith('-')) {
      return {
        paths,
        format,
        deprecations,
        check,
        help,
        version,
        error: `Unknown option ${arg}.`,
      };
    } else if (command === undefined) command = arg;
    else paths.push(arg);
  }
  return { command, paths, format, deprecations, check, help, version };
}

/**
 * Runs the command line `argv` (the arguments after the program name) against `host` and
 * returns the exit status: 0 when no error diagnostic was found, 1 when one was, and 2 when
 * the command could not run at all.
 */
export function runCli(argv: readonly string[], host: CliHost, info: CliInfo): number {
  const args = parseArgs(argv);
  if (args.error !== undefined) {
    host.stderr(`typeshade: ${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.version) {
    host.stdout(`${info.version}\n`);
    return 0;
  }
  if (args.help || args.command === undefined) {
    (args.help ? host.stdout : host.stderr)(USAGE);
    return args.help ? 0 : 2;
  }
  if (args.command !== 'check' && args.command !== 'sync') {
    host.stderr(`typeshade: unknown command ${JSON.stringify(args.command)}.\n\n${USAGE}`);
    return 2;
  }

  const files: string[] = [];
  for (const given of args.paths.length > 0 ? args.paths : ['.']) {
    const path = resolvePath(host.cwd, given);
    const kind = host.kind(path);
    if (kind === undefined) {
      host.stderr(`typeshade: no file or directory at ${given}.\n`);
      return 2;
    }
    if (kind === 'file') files.push(path);
    else walk(host, path, files);
  }
  const unique = [...new Set(files)];
  if (unique.length === 0) {
    host.stderr(
      `typeshade: no ${SHADE_SUFFIX} files under ${args.paths.length > 0 ? args.paths.join(', ') : 'the working directory'}.\n`,
    );
    return 2;
  }

  if (args.command === 'sync') return sync(unique, host, args.check);

  const docs: CheckDocument[] = [];
  for (const path of unique) {
    const text = host.readFile(path);
    if (text === undefined) {
      host.stderr(`typeshade: cannot read ${relativeTo(host.cwd, path)}.\n`);
      return 2;
    }
    docs.push({ path: relativeTo(host.cwd, path), uri: path, text });
  }
  const report = checkDocuments(docs, {
    readDocument: (uri) => (host.kind(uri) === 'file' ? host.readFile(uri) : undefined),
    deprecations: args.deprecations,
  });
  host.stdout(formatCheckReport(report, args.format, new Map(docs.map((d) => [d.path, d.text]))));
  return report.errors > 0 ? 1 : 0;
}

/**
 * `typeshade sync`: write the host view of each shader module beside it (surface §64), or with
 * `check`, report each one that is missing or stale and write nothing. A module that does not
 * compile has no view; its errors are printed, and the status is 1.
 */
function sync(files: readonly string[], host: CliHost, check: boolean): number {
  let status = 0;
  let written = 0;
  let current = 0;
  for (const path of files) {
    const shown = relativeTo(host.cwd, path);
    if (!isShaderModulePath(path)) {
      host.stderr(
        `typeshade: ${shown} is not named *.shade.ts; a host imports a shader module by that name (Rule 3.8).\n`,
      );
      return 2;
    }
    const text = host.readFile(path);
    if (text === undefined) {
      host.stderr(`typeshade: cannot read ${shown}.\n`);
      return 2;
    }
    const face = hostFace(text, { fileName: shown });
    if (face.view === undefined) {
      host.stderr(`${formatBuildErrors(face.diagnostics)}\n`);
      status = 1;
      continue;
    }
    const viewPath = hostViewPath(path);
    const viewShown = relativeTo(host.cwd, viewPath);
    if (host.readFile(viewPath) === face.view) {
      current++;
      continue;
    }
    if (check) {
      host.stderr(
        `${viewShown} is ${host.kind(viewPath) === 'file' ? 'stale' : 'missing'}; run typeshade sync.\n`,
      );
      status = 1;
      continue;
    }
    host.writeFile(viewPath, face.view);
    host.stdout(`wrote ${viewShown}\n`);
    written++;
  }
  const s = (n: number): string => (n === 1 ? '' : 's');
  if (status === 0)
    host.stdout(
      check
        ? `${current} host view${s(current)} up to date.\n`
        : `${written} host view${s(written)} written, ${current} up to date.\n`,
    );
  return status;
}
