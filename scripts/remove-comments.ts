import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { isPolicedText, publicDefinitions } from './comment-policy.js';
import { lineCitationRefusals, workingCoverageTexts } from './move-purity/line-citations.js';
import { parseArguments } from './remove-comments/arguments.js';
import { removeFileComments, type FileResult } from './remove-comments/remove-file.js';
import { formatCandidates, formatResult, jsonOf } from './remove-comments/report.js';

const USAGE =
  'Usage: bun scripts/remove-comments.ts <path>... [--dry-run] [--json] [--keep-invariants] [--repo <path>]';

const SURFACE_PATH = 'src/__api__/surface.md';

export async function runCli(args: string[], cwd: string): Promise<number> {
  const parsed = parseArguments(args);
  if (parsed === undefined) {
    console.error(USAGE);
    return 2;
  }
  const root = parsed.repo ?? cwd;
  const surface = join(root, SURFACE_PATH);
  const keys = publicDefinitions(existsSync(surface) ? readFileSync(surface, 'utf8') : '');
  const coverage = workingCoverageTexts(root);
  const results: FileResult[] = [];
  let failed = false;
  for (const given of parsed.paths) {
    const path = isAbsolute(given) ? relative(root, given) : given;
    const full = join(root, path);
    const text = existsSync(full) ? readFileSync(full, 'utf8') : undefined;
    if (!path.startsWith('src/') || text === undefined || !isPolicedText(path, text)) {
      console.error(`${path}: not a policed .ts file of src/`);
      failed = true;
      continue;
    }
    const cited = lineCitationRefusals(coverage, path);
    if (cited.length > 0) {
      for (const line of cited) console.error(`${path}: ${line}`);
      failed = true;
      continue;
    }
    const result = await removeFileComments(root, path, text, keys, {
      keepInvariants: parsed.keepInvariants,
    });
    results.push(result);
    if (!parsed.json) {
      for (const line of formatCandidates(result)) console.log(line);
      for (const line of formatResult(result, parsed.dryRun)) console.log(line);
    }
    if (result.problems.length > 0) failed = true;
    else if (!parsed.dryRun && result.text !== text) writeFileSync(full, result.text);
  }
  if (parsed.json) console.log(jsonOf(results, parsed.dryRun));
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await runCli(process.argv.slice(2), process.cwd()));
