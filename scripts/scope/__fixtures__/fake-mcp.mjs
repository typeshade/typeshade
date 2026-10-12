// A fake codebase-memory-mcp server for the tests of scripts/scope/resolve.ts.
//
// It speaks the MCP subset GraphSession uses: newline-delimited JSON-RPC 2.0 on stdio. It answers
// `initialize` and `tools/call`, and it ignores `notifications/initialized`. Its answers come from
// the recorded fixtures in this directory.
//
// Usage: node fake-mcp.mjs <mode>, with the mode one of:
//   ok          the handshake and every tool answer; the graph is indexed far in the future
//   stale       the graph is indexed at 2000-01-01T00:00:00Z
//   noproject   list_projects names a project other than FAKE_PROJECT
//   stall       never answers `initialize` or any `tools/call`
//   error       answers `initialize`; every `tools/call` answers isError true
//
// The environment variable FAKE_PROJECT names the project (default: the project the fixtures
// were recorded in). Every recorded project prefix is rewritten to FAKE_PROJECT in the answers.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODES = ['ok', 'stale', 'noproject', 'stall', 'error'];
const RECORDED_PROJECT = 'home-user-typeshade-scope';
const FRESH_INDEX = '2100-01-01T00:00:00Z';
const STALE_INDEX = '2000-01-01T00:00:00Z';

const mode = process.argv[2] ?? 'ok';
if (!MODES.includes(mode)) {
  process.stderr.write(`fake-mcp: unknown mode ${mode}; expected one of ${MODES.join(', ')}\n`);
  process.exit(2);
}

const project = process.env.FAKE_PROJECT || RECORDED_PROJECT;
const here = dirname(fileURLToPath(import.meta.url));

// The recorded text, with its project prefix renamed. Identity when FAKE_PROJECT is unset.
function fixture(name) {
  const text = readFileSync(join(here, name), 'utf8');
  return text.split(RECORDED_PROJECT).join(project);
}

const SEARCH = fixture('graph-search.json');
const TRACE = fixture('graph-trace.json');
const TRACE_AMBIGUOUS = fixture('graph-trace-ambiguous.json');
const QUERY = fixture('graph-query.json');

// The ambiguous fixture names one symbol with two definitions. Asking for that name answers
// ambiguous; asking for a suggestion's qualified name answers the ordinary trace.
const AMBIGUOUS_NAME = JSON.parse(TRACE_AMBIGUOUS).suggestions[0].name;

function listProjects() {
  const listed = mode === 'noproject' ? 'some-other-project' : project;
  return `projects: 1 (cols: name root_path branch)\n  ${listed} /home/user/fake main\n`;
}

function indexStatus() {
  const indexed = mode === 'stale' ? STALE_INDEX : FRESH_INDEX;
  return `project: ${project}\nstatus: ready\nindexed_at: ${indexed}\n`;
}

function traceAnswer(args) {
  const name = String(args.function_name ?? '');
  return name === AMBIGUOUS_NAME ? TRACE_AMBIGUOUS : TRACE;
}

// The answer of one tool call: { isError, text }.
function answer(tool, args) {
  switch (tool) {
    case 'list_projects':
      return { isError: false, text: listProjects() };
    case 'index_status':
      return { isError: false, text: indexStatus() };
    case 'search_graph':
      return { isError: false, text: SEARCH };
    case 'trace_path':
      return { isError: false, text: traceAnswer(args) };
    case 'query_graph':
      return { isError: false, text: QUERY };
    default:
      return { isError: true, text: `unknown tool ${tool}` };
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function onMessage(message) {
  if (message.method === 'initialize') {
    if (mode === 'stall') return;
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-codebase-memory-mcp', version: '0.0.0' },
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'tools/call') {
    if (mode === 'stall') return;
    const tool = String(message.params?.name ?? '');
    const args = message.params?.arguments ?? {};
    const out = mode === 'error' ? { isError: true, text: 'fake error' } : answer(tool, args);
    reply(message.id, {
      content: [{ type: 'text', text: out.text }],
      isError: out.isError,
    });
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `method not found: ${String(message.method)}` },
    });
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  onMessage(message);
});
lines.on('close', () => process.exit(0));
