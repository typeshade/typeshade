// Packaging provenance (change 0083). Never run Git from the browser or mutate tracked sources.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const revisionPattern = /revision: (?:null|"[a-f0-9]{40,64}")/g;
const receiptName = '.typeshade-build.json';

/** Hash the emitted tree, normalizing only the stamp itself. A stale or modified artifact
 * must not acquire the clean source's revision merely because Git reports a clean tree. */
function fingerprint(targetDir: string): string {
  const hash = createHash('sha256');
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(targetDir, relative), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = `${relative}/${entry.name}`;
      if (file === `dist/${receiptName}`) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        let bytes = readFileSync(join(targetDir, file));
        if (file === 'dist/src/core/build-info.js')
          bytes = Buffer.from(bytes.toString('utf8').replace(revisionPattern, 'revision: null'));
        hash.update(file).update('\0').update(String(bytes.length)).update('\0').update(bytes);
      } else throw new Error('Unexpected linked build output.');
    }
  };
  visit('dist');
  return hash.digest('hex');
}

/** Called by the successful build, before packaging. Unstamped archives and dirty sources
 * receive a null receipt. The source buildInfo always remains null. */
export function recordBuildInfo(sourceDir: string): void {
  writeFileSync(
    join(sourceDir, 'dist', receiptName),
    JSON.stringify({ revision: sourceRevision(sourceDir), fingerprint: fingerprint(sourceDir) }),
  );
}

/** An exact revision only for this repository's clean root. An archive inside another Git
 * checkout must not accidentally inherit that enclosing repository's revision. */
export function sourceRevision(sourceDir: string): string | null {
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', sourceDir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    if (resolve(git('rev-parse', '--show-toplevel')) !== resolve(sourceDir)) return null;
    if (git('status', '--porcelain', '--untracked-files=normal') !== '') return null;
    const revision = git('rev-parse', '--verify', 'HEAD');
    return /^[a-f0-9]{40,64}$/.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

/** Stamp only the built module in the packaging tree, before rewriting its manifest. Calling
 * this again on modified/unstamped source clears any older stamp rather than reusing it. */
export function stampBuildInfo(sourceDir: string, targetDir = sourceDir): string | null {
  let revision: string | null = null;
  try {
    const source = sourceRevision(sourceDir);
    const receipt = JSON.parse(readFileSync(join(targetDir, 'dist', receiptName), 'utf8'));
    if (
      source !== null &&
      receipt.revision === source &&
      receipt.fingerprint === fingerprint(targetDir)
    )
      revision = source;
  } catch {
    // An absent receipt or unverifiable output is an unstamped build, not a guessed revision.
  }
  const file = join(targetDir, 'dist/src/core/build-info.js');
  const original = readFileSync(file, 'utf8');
  if ([...original.matchAll(revisionPattern)].length !== 1)
    throw new Error('Unexpected built buildInfo shape; run bun run build before packaging.');
  writeFileSync(file, original.replace(revisionPattern, `revision: ${JSON.stringify(revision)}`));
  return revision;
}

if (import.meta.url === `file://${process.argv[1]}`)
  recordBuildInfo(resolve(fileURLToPath(new URL('..', import.meta.url))));
