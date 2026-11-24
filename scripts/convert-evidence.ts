import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { analyze } from './convert-evidence/analysis.js';
import { applyWrite } from './convert-evidence/apply.js';
import { parseArguments } from './convert-evidence/arguments.js';
import { buildReport, formatReport } from './convert-evidence/report.js';
import { verifyWithCheckEvidence, type Verify } from './convert-evidence/verify.js';

const USAGE =
  'Usage: bun scripts/convert-evidence.ts [--report] [--json] [--queue <file.json>] [--file <coverage file>] [--cited <source path>] [--repo <path>]\n' +
  '       bun scripts/convert-evidence.ts --write --only exact [--file <coverage file>] [--cited <source path>] [--queue <file.json>] [--repo <path>]';

export async function runCli(
  args: string[],
  cwd: string,
  verify: Verify = verifyWithCheckEvidence,
): Promise<number> {
  const parsed = parseArguments(args);
  if (parsed === undefined) {
    console.error(USAGE);
    return 2;
  }
  const root = parsed.repo ?? cwd;
  const analysis = analyze(root, { file: parsed.file, cited: parsed.cited });
  const report = buildReport(analysis.results);
  if (parsed.queue !== undefined) {
    const target = isAbsolute(parsed.queue) ? parsed.queue : join(cwd, parsed.queue);
    writeFileSync(target, `${JSON.stringify(report.queue, null, 2)}\n`);
  }
  if (parsed.mode === 'report') {
    console.log(parsed.json ? JSON.stringify(report, null, 2) : formatReport(report).join('\n'));
    return 0;
  }
  const eligible = analysis.results.filter((result) => result.eligible);
  const outcome = await applyWrite(root, eligible, verify);
  if (outcome.problems.length > 0) {
    for (const problem of outcome.problems) console.error(problem);
    return 1;
  }
  console.log(`rewrote ${outcome.segments} segments in ${outcome.files.length} files`);
  for (const file of outcome.files) console.log(`  ${file}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2), process.cwd()));
}
