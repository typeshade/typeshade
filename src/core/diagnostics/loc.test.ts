import { describe, it, expect, afterEach } from 'vitest';
import {
  setSourceTracing,
  isSourceTracing,
  captureLoc,
  recordLoc,
  getLoc,
  isInternalFrame,
  CORE_PREFIX,
} from './loc.js';
import { module, fn, f32T, f32 } from '../ir/index.js';

afterEach(() => setSourceTracing(false));

describe('source-location capture', () => {
  it('is off by default → captureLoc returns undefined (zero-cost)', () => {
    setSourceTracing(false);
    expect(isSourceTracing()).toBe(false);
    expect(captureLoc()).toBeUndefined();
  });

  it('toggles on/off', () => {
    setSourceTracing(true);
    expect(isSourceTracing()).toBe(true);
    setSourceTracing(false);
    expect(isSourceTracing()).toBe(false);
  });

  it('recordLoc is a no-op for an undefined loc', () => {
    const node = {};
    recordLoc(node, undefined);
    expect(getLoc(node)).toBeUndefined();
  });

  it('records and reads back an explicit loc by object identity', () => {
    const node = {};
    const loc = { file: '/x/a.ts', line: 5, col: 2 };
    recordLoc(node, loc);
    expect(getLoc(node)).toEqual(loc);
  });

  it('when ON, authored fn statements carry a loc; when OFF, none', () => {
    setSourceTracing(false);
    const off = fn('off_fn', { x: f32T }, f32T, ({ x }) => x.add(f32(1)));
    expect(getLoc(off.body[0])).toBeUndefined();

    setSourceTracing(true);
    const on = fn('on_fn', { x: f32T }, f32T, ({ x }) => x.add(f32(1)));
    const loc = getLoc(on.body[0]);
    expect(loc).toBeDefined();
    expect(loc!.file).toContain('loc.test.ts');
    expect(loc!.line).toBeGreaterThan(0);
    // The fn handle itself is loc-stamped too (Func-level diagnostics).
    expect(getLoc(on)).toBeDefined();

    void module({ funcs: [on] });
  });

  it.each(['named V8', 'anonymous V8', 'async anonymous V8', 'async file URL V8', 'JSC'])(
    'captures the native Windows author path from a %s stack',
    (kind) => {
      const original = Error.prepareStackTrace;
      const author =
        kind === 'async file URL V8'
          ? 'file:///C:/shader%20authors/scene.ts'
          : 'C:\\shader authors\\scene.ts';
      const frame =
        kind === 'named V8'
          ? `    at authored (${author}:41:9)`
          : kind === 'async anonymous V8' || kind === 'async file URL V8'
            ? `    at async ${author}:41:9`
            : kind === 'anonymous V8'
              ? `    at ${author}:41:9`
              : `authored@${author}:41:9`;
      Error.prepareStackTrace = () =>
        [
          'Error',
          `    at captureLoc (${CORE_PREFIX.replace(/\//g, '\\')}diagnostics\\loc.ts:1:1)`,
          frame,
          '    at runner (/vitest/runner.js:2:1)',
        ].join('\n');
      try {
        setSourceTracing(true);
        expect(captureLoc()).toEqual({ file: author, line: 41, col: 9 });
      } finally {
        Error.prepareStackTrace = original;
      }
    },
  );
});

// The filter that decides which stack frames are this package's OWN. It used to be the
// literal `/shader-dsl/src/core/`, which only ever matched a source checkout: a consumer
// running the package from any other layout got DSL-internal frames reported as its author
// locations. CORE_PREFIX is now derived from this module's URL at load time.
describe('internal-frame filter', () => {
  // The one fact loc.ts assumes about itself: it lives at `<root>/core/diagnostics/`, so
  // its grandparent is the implementation root. Move the file and this reddens, naming
  // the derivation to update.
  it('derives the package core root from this module, not a hardcoded path', () => {
    expect(CORE_PREFIX.endsWith('/core/')).toBe(true);
    expect(CORE_PREFIX).not.toBe('/shader-dsl/src/core/'); // derived, not the fallback
    expect(isInternalFrame(`${CORE_PREFIX}ir/builder.ts`)).toBe(true);
  });

  // The defect, pinned in both directions: the same built-layout frame is invisible to the
  // old literal and internal under the derived prefix. Neither half can pass by accident.
  const LEGACY = (file: string): boolean =>
    file.includes('/shader-dsl/src/core/') && !file.endsWith('.test.ts');

  it.each([
    ['a dist build', '/app/node_modules/typeshade/dist/core/', 'ir/builder.js'],
    ['a renamed install dir', '/app/vendor/typeshade-fork/core/', 'passes/opt/optimize.js'],
    ['a Vite /@fs dev URL', 'https://localhost:3000/@fs/w/pkg/dist/core/', 'ir/node.js'],
  ])('classifies %s as internal where the hardcoded filter did not', (_what, prefix, rest) => {
    const frame = prefix + rest;
    expect(LEGACY(frame)).toBe(false); // what shipped: an internal frame read as the author's
    expect(isInternalFrame(frame, prefix)).toBe(true);
  });

  it('still exempts a co-located *.test.ts and still passes consumer frames through', () => {
    const prefix = '/app/node_modules/typeshade/dist/core/';
    expect(isInternalFrame(`${prefix}ir/builder.test.ts`, prefix)).toBe(false);
    expect(isInternalFrame('/app/src/shaders/my-shader.ts', prefix)).toBe(false);
  });

  it('tolerates a query string on the frame (Vite appends ?t=/?v=)', () => {
    const prefix = '/w/pkg/src/core/';
    expect(isInternalFrame(`${prefix}ir/builder.ts?t=1717`, prefix)).toBe(true);
  });

  it.each([
    ['C:\\shader pkg\\src\\core\\ir\\builder.ts', 'file:///C:/shader%20pkg/src/core/'],
    ['file:///C:/shader%20pkg/src/core/ir/builder.ts', 'C:\\shader pkg\\src\\core\\'],
    ['\\\\host\\share\\shader pkg\\core\\ir\\builder.ts', 'file://host/share/shader%20pkg/core/'],
  ])('matches native and URL spellings of an internal frame: %s', (file, prefix) => {
    expect(isInternalFrame(file, prefix)).toBe(true);
    expect(isInternalFrame(file.replace('builder.ts', 'builder.test.ts'), prefix)).toBe(false);
  });

  it('still exempts a co-located test frame with a Vite query', () => {
    const prefix = '/w/pkg/src/core/';
    expect(isInternalFrame(`${prefix}diagnostics/loc.test.ts?t=1717`, prefix)).toBe(false);
  });
});
