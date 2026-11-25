import { AREA_DEFINITION } from './areas.js';
import { SKIP_RULES } from './context.js';
import type { Finding, SignalName } from './types.js';

export interface SignalReport {
  name: SignalName;
  summary: string[];
  findings: Finding[];
}

export interface ReportInput {
  allFiles: number;
  analysedFiles: number;
  skipped: Readonly<Record<string, number>>;
  unmatchedFiles: string[];
  signals: SignalReport[];
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function evidenceText(finding: Finding): string {
  return Object.entries(finding.evidence)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('; ');
}

const byPlace = (a: Finding, b: Finding): number =>
  a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;

function signalSection(report: SignalReport): string[] {
  const lines = [`## Signal: ${report.name}`, ''];
  lines.push(...report.summary.map((line) => `- ${line}`), '');
  if (report.findings.length === 0) return [...lines, 'No finding.', ''];
  lines.push('| file | line | kind | evidence | remedy |', '| --- | --- | --- | --- | --- |');
  for (const finding of [...report.findings].sort(byPlace)) {
    lines.push(
      `| ${cell(finding.file)} | ${finding.line} | ${cell(finding.kind)} | ${cell(evidenceText(finding))} | ${cell(finding.remedy)} |`,
    );
  }
  return [...lines, ''];
}

export function formatMarkdown(input: ReportInput): string {
  const lines = [
    '# Code shape report',
    '',
    'This report only reports. No finding fails a check.',
    '',
    '## Definitions',
    '',
    `- ${AREA_DEFINITION}`,
    `- Files read: ${input.allFiles}. Files analysed: ${input.analysedFiles}.`,
    '- Skipped files, by rule:',
    ...SKIP_RULES.map(
      (rule) => `  - ${rule.name}: ${input.skipped[rule.name] ?? 0}. ${rule.reason}.`,
    ),
    ...input.unmatchedFiles.map(
      (path) => `- No analysed file matches ${path} (skipped or missing).`,
    ),
    '',
  ];
  for (const report of input.signals) lines.push(...signalSection(report));
  return lines.join('\n');
}

export function formatJson(input: ReportInput): string {
  return JSON.stringify(
    {
      definitions: {
        area: AREA_DEFINITION,
        skipRules: SKIP_RULES.map((rule) => ({
          name: rule.name,
          reason: rule.reason,
          count: input.skipped[rule.name] ?? 0,
        })),
      },
      allFiles: input.allFiles,
      analysedFiles: input.analysedFiles,
      unmatchedFiles: input.unmatchedFiles,
      signals: input.signals.map((report) => ({
        name: report.name,
        summary: report.summary,
        findings: [...report.findings].sort(byPlace),
      })),
    },
    null,
    2,
  );
}
