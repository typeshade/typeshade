#!/usr/bin/env node
// === `typeshade`: the Node host for the command in run.ts ===
//
// The one file in `src/` that runs on a host. The library build carries no host types
// (tsconfig.json `types: []`), so the handful of Node calls this makes are imported
// dynamically and typed by the small interfaces below, rather than by pulling `@types/node`
// into every file of the library build.
//
// In the npm tarball this runs as `dist/src/cli/bin.js` under Node (the `bin` entry the
// publish manifest derives). In this repository and in a submodule checkout, where the
// package resolves to source, run it with Bun: `bun src/cli/bin.ts check <paths>`.

import { runCli, type CliHost } from './run.js';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
  readdirSync(path: string): string[];
  statSync(
    path: string,
    options: { throwIfNoEntry: false },
  ): { isFile(): boolean; isDirectory(): boolean } | undefined;
}

interface NodeProcess {
  readonly argv: readonly string[];
  cwd(): string;
  exitCode?: number;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

const fsModule: string = 'node:fs';
const fs = (await import(fsModule)) as NodeFs;
const proc = (globalThis as unknown as { process: NodeProcess }).process;

/** The package's own version, read from the manifest beside the source or build tree. */
function packageVersion(): string {
  for (const up of ['../../package.json', '../../../package.json']) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(new URL(up, import.meta.url).pathname, 'utf8'),
      ) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === 'typeshade' && manifest.version !== undefined) return manifest.version;
    } catch {
      // not at this depth; try the next
    }
  }
  return 'unknown';
}

const host: CliHost = {
  cwd: proc.cwd().replace(/\\/g, '/'),
  readFile(path) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  writeFile: (path, text) => fs.writeFileSync(path, text),
  kind(path) {
    const stat = fs.statSync(path, { throwIfNoEntry: false });
    if (stat === undefined) return undefined;
    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined;
  },
  list: (path) => fs.readdirSync(path),
  stdout: (text) => void proc.stdout.write(text),
  stderr: (text) => void proc.stderr.write(text),
};

proc.exitCode = runCli(proc.argv.slice(2), host, { version: packageVersion() });
