// A stand-in for `gh`, for the tests of `scripts/scope.ts --issue` and `scripts/scope-backtest.ts
// --collect`. It appends its argv, one JSON array per line, to the file named by FAKE_GH_LOG, then
// answers from its arguments. The proxy of a Claude Code cloud session refuses GraphQL. This fake
// refuses it too. Any call whose first argument is `issue` fails with a GraphQL 403.
// That covers `gh issue view --json` and `gh issue list --json`. The REST calls (`gh api <path>`) get canned
// JSON, one page per `page=` value.
//
// FAKE_GH_FULL makes a page full, so a test can reach a stop condition:
//   comments  the comments of issue 7: 100 on page 1, 1 on page 2;
//   issues    closed issues: 100 issues on every page;
//   mixed     closed issues: 50 issues and 50 pull requests on every page.
// Unset, the comments are one short page and the closed issues are two short pages.

import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) {
  appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);
}

if (argv[0] === 'issue') {
  process.stderr.write(
    'HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...).\n',
  );
  process.exit(1);
}

if (argv[0] !== 'api') {
  process.stderr.write(`fake gh: unexpected arguments ${JSON.stringify(argv)}\n`);
  process.exit(1);
}

const path = argv.find((arg) => arg.startsWith('repos/')) ?? '';
const page = Number(new URL(`https://fake.invalid/${path}`).searchParams.get('page') ?? '1');
const full = process.env.FAKE_GH_FULL ?? '';
const CANNED_TITLE = 'Canned title from the fake gh';

function reply(value) {
  process.stdout.write(JSON.stringify(value));
}

function comment(n) {
  return { body: `Comment ${n}.` };
}

function closedIssue(n) {
  return { number: n, title: `Closed issue ${n}`, body: `Body ${n}.` };
}

function pullRequest(n) {
  return { number: n, title: `Pull request ${n}`, body: 'x', pull_request: { url: 'x' } };
}

function range(count, make) {
  return Array.from({ length: count }, (_, i) => make(i + 1));
}

function commentsPage() {
  if (full === 'comments') {
    if (page === 1) return range(100, comment);
    if (page === 2) return [comment(101)];
    return [];
  }
  return page === 1
    ? [{ body: 'First comment. It names `fill(0)`.' }, { body: null }, { body: 'Second comment.' }]
    : [];
}

function closedPage() {
  const base = (page - 1) * 100;
  if (full === 'issues') return range(100, (i) => closedIssue(base + i));
  if (full === 'mixed') {
    return range(100, (i) => (i % 2 === 1 ? closedIssue(base + i) : pullRequest(base + i)));
  }
  if (page === 1) return [pullRequest(9), closedIssue(8)];
  if (page === 2) return [{ number: 6, title: 'Another closed issue', body: null }];
  return [];
}

if (/^repos\/[^/]+\/[^/]+\/issues\/\d+\/comments/.test(path)) {
  reply(commentsPage());
} else if (/^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(path)) {
  reply({
    number: 7,
    title: CANNED_TITLE,
    body: 'The body names `fill(0)` and `Tint`.',
    state: 'open',
  });
} else if (/^repos\/[^/]+\/[^/]+\/issues\?state=closed/.test(path)) {
  reply(closedPage());
} else {
  process.stderr.write(`fake gh: no canned reply for ${path}\n`);
  process.exit(1);
}
