// ═══ Scope step 1: what an issue names ═══
//
// Reads an issue's title and body and lists what the text names: its sections, the identifiers in
// its code spans and in its camelCase prose, its file paths, its diagnostic codes, its rules, its
// surface sections, its proposals, its issue and pull request numbers, its hex commit tokens and
// the words for similarity. Each list keeps the order of first appearance and holds no duplicate.
//
// Nothing here reads the repository. A path, an identifier or a commit is a claim from the text;
// the resolver of the next step decides which of them exist at the revision.
//
// URLs are masked before any rule runs, so the `#L26` of a link is no reference. The masked text
// keeps its length, so every position still names the same place in the issue.
//
// This is a report, not a gate. CI does not run it.

export interface Seeds {
  readonly title: string;
  readonly sections: Readonly<Record<string, string>>; // '## Heading' → body text, headings as written
  readonly identifiers: readonly string[]; // first-appearance order, unique
  readonly paths: readonly string[];
  readonly codes: readonly string[]; // 'TS8019', 'SD0001'
  readonly rules: readonly string[]; // '1.3', '12.7'
  readonly surface: readonly number[]; // 44, 18
  readonly proposals: readonly string[]; // '0047'
  readonly refs: readonly number[]; // issue or PR numbers
  readonly commits: readonly string[]; // hex tokens 7 to 40 long, unverified
  readonly words: readonly string[]; // the bag of words for similarity (section 6.4)
}

// The words an author writes in code and that name no repository symbol.
export const STOPWORDS: ReadonlySet<string> = new Set([
  // JavaScript and TypeScript keywords and type names
  'abstract',
  'any',
  'as',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'new',
  'never',
  'null',
  'number',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'string',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield',
  // TypeShade and the shader language names the issues repeat
  'use',
  'typeshade',
  'error',
  'fn',
  'wgsl',
  'glsl',
  'text',
  'ts',
  // scalar and vector type names
  'u32',
  'i32',
  'f32',
  'f16',
  'bool',
  'vec2',
  'vec3',
  'vec4',
]);

// The common English function words. They carry no topic for similarity.
export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'are',
  'was',
  'were',
  'has',
  'have',
  'not',
  'but',
  'its',
  'into',
  'when',
  'where',
  'which',
  'what',
  'does',
  'each',
  'one',
  'two',
  'any',
  'all',
  'can',
  'must',
  'should',
  'would',
  'only',
  'also',
  'than',
  'then',
  'there',
  'here',
  'they',
  'them',
  'same',
  'other',
  'such',
]);

// A URL ends before a backtick, a closing parenthesis or bracket, or an angle bracket.
const URL_PATTERN = /https?:\/\/[^\s`<>)\]]+/g;
const CODE_REGION = /```[\s\S]*?```|`[^`\n]*`/g;
// The lookbehind keeps a token from starting inside a number: `0x00000001` names no `x00000001`.
const CODE_IDENTIFIER = /(?<![\w$])[A-Za-z_$][\w$]*/g;
const PROSE_CAMEL = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const PROSE_PASCAL = /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/g;
const PATH = /(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]{1,5}\b/g;
// The lookbehind keeps a file name from starting inside a longer name: `zero.shade.ts` names no `shade.ts`.
const BARE_FILE = /(?<![\w./-])\b[\w-]+\.(?:ts|md|json|yml|mjs)\b/g;
const CODE = /\b(?:TS|SD)\d{4}\b/g;
const RULE = /\bRules? ((?:\d+\.\d+)(?:(?:,? and |,? or |, )\d+\.\d+)*)/g;
const RULE_SEPARATOR = /,? and |,? or |, /;
// A section sign not followed by a dot and a digit: `WGSL §17.1.1` names no surface section.
const SURFACE = /§\s?(\d+)(?![.\d])/g;
const PROPOSAL_PATTERNS: readonly RegExp[] = [
  /\b(?:proposal|change|Change:)\s+(\d{4})\b/gi,
  /\bfix\((\d{4})\)/g,
  /\((\d{4})\)/g,
  /\b(\d{4})-[a-z][\w-]*\.md\b/g,
];
const REF = /(?<![\w/&])#(\d{1,5})\b/g;
const COMMIT = /(?<!0x)\b[0-9a-f]{7,40}\b/g;
const SECTION_HEADING = /^## \S/;
const FENCE_LINE = /^\s*```/;

interface Hit<T> {
  readonly at: number;
  readonly value: T;
}

// Replaces every character of a match by a space, so the length and the positions stay the same.
const blank = (match: string): string => match.replace(/[^\n]/g, ' ');

// Lists the values a pattern finds, each with the position it was found at.
function hitsOf<T>(
  source: string,
  pattern: RegExp,
  offset: number,
  pick: (match: RegExpMatchArray) => readonly T[],
): Hit<T>[] {
  const hits: Hit<T>[] = [];
  for (const match of source.matchAll(pattern)) {
    for (const value of pick(match)) hits.push({ at: offset + (match.index ?? 0), value });
  }
  return hits;
}

// Orders the hits by position and drops every repeat after the first.
function ordered<T>(hits: readonly Hit<T>[]): T[] {
  const seen = new Set<T>();
  const values: T[] = [];
  for (const hit of [...hits].sort((a, b) => a.at - b.at)) {
    if (seen.has(hit.value)) continue;
    seen.add(hit.value);
    values.push(hit.value);
  }
  return values;
}

// A `## <heading>` line starts a section. A fenced block is code, so a heading inside one is text.
function sectionsOf(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let lines: string[] = [];
  let inFence = false;
  const close = (): void => {
    if (heading === null) return;
    const body = lines.join('\n').trim();
    const previous = sections.get(heading);
    sections.set(heading, previous === undefined ? body : `${previous}\n\n${body}`);
  };
  for (const line of text.split('\n')) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    if (!inFence && SECTION_HEADING.test(line)) {
      close();
      heading = line.trimEnd();
      lines = [];
    } else if (heading !== null) {
      lines.push(line);
    }
  }
  close();
  return sections;
}

// Words for similarity: lower-cased letter runs, camelCase humps split, short and stop words out.
function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !ENGLISH_STOPWORDS.has(word));
}

export function extractSeeds(title: string, body: string): Seeds {
  const text = `${title}\n${body}`;
  // Every rule below reads this copy: URLs are blanked, and nothing else changes.
  const base = text.replace(URL_PATTERN, blank);

  // Identifiers: the tokens of each code span, then the camelCase words of the prose.
  const identifierHits: Hit<string>[] = [];
  const keepIdentifier = (name: string): boolean => name.length >= 3 && !STOPWORDS.has(name);
  for (const region of base.matchAll(CODE_REGION)) {
    identifierHits.push(
      ...hitsOf(region[0], CODE_IDENTIFIER, region.index ?? 0, (match) =>
        keepIdentifier(match[0]) ? [match[0]] : [],
      ),
    );
  }
  const prose = base.replace(CODE_REGION, blank);
  for (const pattern of [PROSE_CAMEL, PROSE_PASCAL]) {
    identifierHits.push(
      ...hitsOf(prose, pattern, 0, (match) => (keepIdentifier(match[0]) ? [match[0]] : [])),
    );
  }

  // Paths first, so a bare file name inside a path is not counted twice.
  const pathHits = hitsOf(base, PATH, 0, (match) => [match[0].replace(/[:#].*$/, '')]);
  const withoutPaths = base.replace(PATH, blank);
  const bareHits = hitsOf(withoutPaths, BARE_FILE, 0, (match) => [match[0]]);

  const ruleHits = hitsOf(base, RULE, 0, (match) =>
    (match[1] ?? '')
      .split(RULE_SEPARATOR)
      .map((rule) => rule.trim())
      .filter((rule) => rule.length > 0),
  );

  const proposalHits = PROPOSAL_PATTERNS.flatMap((pattern) =>
    hitsOf(base, pattern, 0, (match) => [match[1] ?? '']),
  );

  return {
    title,
    sections: Object.fromEntries(sectionsOf(text)),
    identifiers: ordered(identifierHits),
    paths: ordered([...pathHits, ...bareHits]),
    codes: ordered(hitsOf(base, CODE, 0, (match) => [match[0]])),
    rules: ordered(ruleHits),
    surface: ordered(hitsOf(base, SURFACE, 0, (match) => [Number(match[1])])),
    proposals: ordered(proposalHits),
    refs: ordered(hitsOf(base, REF, 0, (match) => [Number(match[1])])),
    commits: ordered(
      hitsOf(base, COMMIT, 0, (match) =>
        /\d/.test(match[0]) && /[a-f]/.test(match[0]) ? [match[0]] : [],
      ),
    ),
    words: wordsOf(text),
  };
}
