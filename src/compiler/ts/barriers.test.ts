// Barriers and the lockstep dispatch (roadmap 0.2 item 5, design #82 step 2, §25).
// `workgroupBarrier()` / `storageBarrier()` are statements every invocation of a workgroup
// reaches before any runs on. Measured on `main` before this: the names were unknown
// functions, and the CPU oracle had no way to run a workgroup as a workgroup. What is pinned
// here: the WGSL each spelling emits, the placement rules, `dispatch` on both CPU modules
// running a reduction to the right sums with the right number of barrier phases, the
// divergence error, the direct-call refusal, the debugger stepping one invocation through,
// the effect table keeping the barrier, and the void-value fix that rode along.
//
// Verifies: Rule 8.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimizeAt } from '../../core/passes/opt/optimize.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { reflect } from '../../core/reflect.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const REDUCE = `"use typeshade";
declare const src: storage<array<f32>>;
declare const sums: storage<array<f32>, "read_write">;
let tile: workgroup<array<f32, 64>>;
@compute([64, 1, 1])
export function reduce(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
): void {
  tile[lid.x] = src[gid.x];
  workgroupBarrier();
  for (let stride: u32 = 32; stride > 0; stride /= 2) {
    if (lid.x < stride) {
      tile[lid.x] = tile[lid.x] + tile[lid.x + stride];
    }
    workgroupBarrier();
  }
  if (lid.x === 0) {
    sums[wid.x] = tile[0];
  }
}
`;

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const HEAD = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
`;
const kernel = (body: string) => `${HEAD}@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`;

describe('barriers: the WGSL', () => {
  it('spells both barriers bare, as statements', () => {
    const r = compile(REDUCE);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('  workgroupBarrier();');
    expect(r.wgsl).not.toContain('_ = workgroupBarrier');
    const s = compile(
      kernel('  out[gid.x] = 1.\n  storageBarrier()\n  out[gid.x] = out[gid.x] + 1.'),
    );
    expect(s.diagnostics).toEqual([]);
    expect(s.wgsl).toContain('  storageBarrier();');
    expect(s.glsl).toBeUndefined();
  });

  it('is kept by the optimizer, once per barrier', () => {
    const r = compile(REDUCE);
    const w = emitModule(optimizeAt(r.module, 'O2'));
    expect(w.match(/workgroupBarrier\(\);/g)).toHaveLength(2);
  });
});

describe('barriers: dispatch runs a workgroup in lockstep', () => {
  it('the oracle and the codegen reduce 128 values into two sums', () => {
    for (const make of [compileModule, compileModuleJs]) {
      const r = compile(REDUCE);
      const cm = make(r.module);
      const src = Array.from({ length: 128 }, (_, i) => i + 1);
      const sums = [0, 0];
      cm.setBinding('src', src);
      cm.setBinding('sums', sums);
      const report = cm.dispatch('reduce', 2);
      // 1 + ... + 64 and 65 + ... + 128.
      expect(sums, make.name).toEqual([2080, 6176]);
      // One barrier after the load and one per round of the six-round loop, per workgroup.
      expect(report, make.name).toEqual({ workgroups: 2, invocations: 128, barrierPhases: 14 });
    }
  });

  it('fills every compute builtin and hands a scalar binding back', () => {
    const src = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
declare const last: storage<u32, "read_write">;
@compute([4, 1, 1])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("local_invocation_index") li: u32,
  @builtin("workgroup_id") wid: vec3u,
  @builtin("num_workgroups") n: vec3u,
): void {
  out[gid.x] = lid.x * 1000 + li * 100 + wid.x * 10 + n.x;
  storageBarrier();
  last = gid.x;
}
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    const cm = compileModule(r.module);
    const out = Array.from({ length: 12 }, () => 0);
    cm.setBinding('out', out);
    cm.setBinding('last', 0);
    const report = cm.dispatch('k', [3, 1, 1]);
    expect(report).toEqual({ workgroups: 3, invocations: 12, barrierPhases: 3 });
    expect(out.slice(0, 4)).toEqual([3, 1103, 2203, 3303]);
    expect(out.slice(8, 12)).toEqual([23, 1123, 2223, 3323]);
  });

  it('runs a two-dimensional workgroup over a two-dimensional grid, on both CPU modules', () => {
    // A 2x2 box sum over a 4x4 image, one invocation per pixel: each workgroup of [2, 2]
    // loads its tile, waits, and reads its neighbours' slots. The ids are WGSL's: gid is
    // wid * size + lid per axis, and local_invocation_index is lid.x + lid.y * 2.
    const src = `"use typeshade";
declare const img: storage<array<u32>>;
declare const out: storage<array<u32>, "read_write">;
declare const ids: storage<array<u32>, "read_write">;
let tile: workgroup<array<u32, 4>>;
@compute([2, 2])
export function box(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("local_invocation_index") li: u32,
  @builtin("workgroup_id") wid: vec3u,
): void {
  const p: u32 = gid.y * 4 + gid.x;
  tile[li] = img[p];
  workgroupBarrier();
  out[p] = tile[0] + tile[1] + tile[2] + tile[3];
  ids[p] = wid.y * 1000 + wid.x * 100 + lid.y * 10 + lid.x;
}
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@compute @workgroup_size(2, 2)');
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module);
      const img = Array.from({ length: 16 }, (_, i) => i);
      const out = Array.from({ length: 16 }, () => 0);
      const ids = Array.from({ length: 16 }, () => 0);
      cm.setBinding('img', img);
      cm.setBinding('out', out);
      cm.setBinding('ids', ids);
      const report = cm.dispatch('box', [2, 2, 1]);
      expect(report, make.name).toEqual({ workgroups: 4, invocations: 16, barrierPhases: 4 });
      // The top-left tile holds pixels 0, 1, 4, 5; the bottom-right one 10, 11, 14, 15.
      expect(out, make.name).toEqual([
        10, 10, 18, 18, 10, 10, 18, 18, 42, 42, 50, 50, 42, 42, 50, 50,
      ]);
      expect(ids, make.name).toEqual([
        0, 1, 100, 101, 10, 11, 110, 111, 1000, 1001, 1100, 1101, 1010, 1011, 1110, 1111,
      ]);
    }
  });

  it('refuses a workgroup whose invocations do not all reach the barrier', () => {
    const src = REDUCE.replace(
      '  tile[lid.x] = src[gid.x];\n',
      '  if (lid.x > 60) {\n    return;\n  }\n  tile[lid.x] = src[gid.x];\n',
    );
    const r = compile(src);
    // The front end catches this one at the line now (§54): a `return` under a condition the
    // invocations do not share leaves a subset of them to reach the barrier, and Tint says so
    // too — measured, `if (id.x > 4u) { return }` above a barrier is `'workgroupBarrier' must
    // only be called from uniform control flow`. The runtime check below is what still stands
    // behind a module that reaches it anyway, assembled by the EDSL or composed at run time,
    // and it is the one that can count the invocations.
    expect(new Set(r.diagnostics.map((d) => d.code))).toEqual(new Set([TS_CODES.UNIFORMITY]));
    const cm = compileModule(r.module);
    cm.setBinding(
      'src',
      Array.from({ length: 64 }, () => 1),
    );
    cm.setBinding('sums', [0]);
    expect(() => cm.dispatch('reduce', 1)).toThrow(
      'workgroupBarrier() at line 14 was reached by 61 of 64 invocations of workgroup (0, 0, 0); 3 returned before it.',
    );
  });

  it('a direct call on a kernel with a barrier names dispatch, on both CPU modules', () => {
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(compile(REDUCE).module);
      cm.setBinding(
        'src',
        Array.from({ length: 64 }, () => 1),
      );
      cm.setBinding('sums', [0]);
      expect(() => cm.fns['reduce']!([0, 0, 0], [0, 0, 0], [0, 0, 0])).toThrow(
        'run the entry with dispatch(name, workgroups)',
      );
    }
  });

  it('dispatch takes a compute entry only', () => {
    const cm = compileModule(
      compile(`"use typeshade";
@fragment
export function fs(): vec4 { return vec4(1.); }
`).module,
    );
    expect(() => cm.dispatch('fs', 1)).toThrow('dispatch runs a @compute entry; "fs" is fragment');
  });

  it('the debugger, stepping one invocation alone, refuses the barrier with the same words', () => {
    // Alone, invocation 0 would add the zeros the others never wrote and show a sum no
    // workgroup produces; the oracle-vs-step sweep over the examples holds the three paths to
    // one answer.
    const r = compile(REDUCE);
    const s = startDebugSession(
      r.module,
      'reduce',
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      { bindings: { src: Array.from({ length: 64 }, () => 1), sums: [0] } },
    );
    expect(() => s.continue()).toThrow('run the entry with dispatch(name, workgroups)');
  });
});

describe('barriers: where one may stand', () => {
  // The rule is the UNIFORMITY of the branch, not the presence of one (§54). It used to be
  // "no `if`, no `switch`", which is stricter than both the spec and Tint: measured on
  // Chromium 141 and 153 alike, `if (k > 0.5)` on a uniform buffer value is ACCEPTED, and
  // `if (id.x > 4u)` on `local_invocation_id` is `'workgroupBarrier' must only be called from
  // uniform control flow`. What it means is unchanged — every invocation of the workgroup has
  // to reach the barrier — and the walk reports one whenever the control flow is not PROVABLY
  // uniform, so a shape it cannot read keeps the refusal it had.
  const branchedOn = (name: string, cause: string) =>
    `${TS_CODES.UNIFORMITY} ${name}() is reached under ${cause}, and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. Move it out of the branch, or branch on a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`;

  it('not inside a branch on a value the invocations do not share', () => {
    expect(errorsOf(kernel('  if (gid.x > 1) {\n    workgroupBarrier()\n  }'))).toEqual([
      branchedOn('workgroupBarrier', '"gid" (@builtin(global_invocation_id))'),
    ]);
    expect(
      errorsOf(
        kernel(
          '  switch (gid.x) {\n    case 1: { storageBarrier(); break }\n    default: { break }\n  }',
        ),
      ),
    ).toEqual([branchedOn('storageBarrier', '"gid" (@builtin(global_invocation_id))')]);
  });

  it('inside a branch on a value the whole workgroup shares, it may', () => {
    const uniform = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
declare const k: uniform<f32>;
@compute([64, 1, 1])
export function g(@builtin("global_invocation_id") gid: vec3u): void {
  if (k > 0.5) {
    workgroupBarrier();
  }
  out[gid.x] = 1.;
}
`;
    expect(errorsOf(uniform)).toEqual([]);
    // `@builtin("workgroup_id")` is one of the four WGSL declares uniform, so a branch on it
    // is the same answer for every invocation of the group.
    const byGroup = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([64, 1, 1])
export function g(@builtin("workgroup_id") wg: vec3u, @builtin("local_invocation_id") id: vec3u): void {
  if (wg.x > u32(1)) {
    workgroupBarrier();
  }
  out[id.x] = 1.;
}
`;
    expect(errorsOf(byGroup)).toEqual([]);
  });

  it('inside a for loop, and inside a helper, it may', () => {
    expect(
      errorsOf(kernel('  for (let i: u32 = 0; i < 4; i++) {\n    workgroupBarrier()\n  }')),
    ).toEqual([]);
    expect(
      errorsOf(`${HEAD}function sync(): void {
  workgroupBarrier()
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  sync()
}
`),
    ).toEqual([]);
  });

  it('not in a vertex or fragment entry, not as a value, not with an argument', () => {
    expect(
      errorsOf(`${HEAD}@fragment
export function fs(): vec4 {
  workgroupBarrier()
  return vec4(1.)
}
`),
    ).toEqual([
      `${TS_CODES.BARRIER_PLACEMENT} workgroupBarrier() belongs in a compute entry or a function it calls; a fragment entry has no workgroup to wait for.`,
    ]);
    expect(errorsOf(kernel('  const x = workgroupBarrier()'))).toEqual([
      `${TS_CODES.BARRIER_PLACEMENT} workgroupBarrier() is a statement with no value; write it on its own line.`,
    ]);
    expect(errorsOf(kernel('  workgroupBarrier(1)'))).toEqual([
      `${TS_CODES.ARITY_MISMATCH} workgroupBarrier expects 0 arguments, got 1.`,
    ]);
  });

  it('names the return or the loop that made the flow non-uniform, not a branch', () => {
    // No branch surrounds either barrier, so "move it out of the branch" pointed at nothing
    // the author could find (Rule 12.1). Each remedy named compiles on Tint: the barrier above
    // the `if (…) { return; }`, and a loop bound every invocation shares.
    const lid = `${HEAD}@compute([64, 1, 1])
export function k(@builtin("local_invocation_id") lid: vec3u): void {
`;
    expect(errorsOf(`${lid}  if (lid.x > 2) { return; }\n  workgroupBarrier();\n}\n`)).toEqual([
      `${TS_CODES.UNIFORMITY} workgroupBarrier() is reached after a return taken under "lid" (@builtin(local_invocation_id)), and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. Move it above the return, or return on a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`,
    ]);
    expect(errorsOf(`${lid}  workgroupBarrier();\n  if (lid.x > 2) { return; }\n}\n`)).toEqual([]);
    const inLoop = `${TS_CODES.UNIFORMITY} workgroupBarrier() is reached in a loop whose condition reads "lid" (@builtin(local_invocation_id)), and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. Move it out of the loop, or bound the loop by a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`;
    expect(
      errorsOf(
        `${lid}  let i: u32 = lid.x;\n  while (i < 8) {\n    workgroupBarrier();\n    i++;\n  }\n}\n`,
      ),
    ).toEqual([inLoop]);
    expect(
      errorsOf(`${lid}  for (let i: u32 = 0; i < lid.x; i++) {\n    workgroupBarrier();\n  }\n}\n`),
    ).toEqual([inLoop]);
  });

  it('a function the file declares under the name keeps the call', () => {
    const r = compileTsSource(`${HEAD}function workgroupBarrier(): void {
  out[0] = 1.
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  workgroupBarrier()
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('fn workgroupBarrier() {');
  });
});

describe('a call that returns nothing is not a value', () => {
  it('cannot initialize a local', () => {
    // Before this it emitted `let x = store(1u);`, which Tint refuses, with no diagnostic.
    expect(
      errorsOf(`${HEAD}function store(i: u32): void {
  out[i] = 1.
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  const x = store(1)
}
`),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} "store(1)" returns nothing, so it cannot initialize "x"; call it on its own line.`,
    ]);
  });
});

// #152: `textureBarrier` and `workgroupUniformLoad`. Both were unknown names; both carry the
// two placement rules this file already pins, and each rule below is one Tint states in its
// own words, measured with a broken shader fed to the same instrument first.
describe("textureBarrier and workgroupUniformLoad carry a barrier's rules", () => {
  const errorsOf = (src: string): string[] =>
    compileTsSource(src)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => d.message);
  /** The same with each code in front, for the pins that assert both (Rule 12.5). */
  const codedErrorsOf = (src: string): string[] =>
    compileTsSource(src)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => `${d.code} ${d.message}`);

  const CS = (decls: string, body: string): string => `"use typeshade"
declare const o: storage<array<u32>, "read_write">
${decls}
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`;

  it('emits textureBarrier bare, and names the language feature it belongs to', () => {
    // Measured: Tint compiles `textureBarrier()` in a compute entry with NO storage texture in
    // sight, so nothing in the module's shape announces the requirement.
    const r = compile(CS('', '  o[gid.x] = 1\n  textureBarrier()'));
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('textureBarrier();');
    expect(reflect(r.module).requiredLanguageFeatures).toEqual([
      'readonly_and_readwrite_storage_textures',
    ]);
  });

  it('refuses textureBarrier outside a compute entry and inside a branch', () => {
    // Tint: "built-in cannot be used by vertex pipeline stage" / "'textureBarrier' must only be
    // called from uniform control flow". Both are said here first, in the author's own file.
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  textureBarrier();
  return vec4(0.);
}
`)[0],
    ).toBe(
      'textureBarrier() belongs in a compute entry or a function it calls; a fragment entry ' +
        'has no workgroup whose texture writes it could order.',
    );
    // Still refused inside a branch, and now by §54's walk rather than by a branch-depth check
    // in the lowering: `textureBarrier` is one of `BARRIER_INTRINSICS`, and the uniformity
    // analysis reads that set, so it inherited the same relaxation the other two barriers got
    // — a branch on a value the invocations do NOT share is what WGSL refuses, not a branch.
    // `o[0]` is a storage read, which the walk cannot prove uniform, so the refusal stands and
    // the code moved from `BARRIER_PLACEMENT` to `UNIFORMITY`.
    const branched = errorsOf(CS('', '  if (o[0] === 1) {\n    textureBarrier()\n  }'))[0];
    expect(branched).toContain('textureBarrier() is reached under');
    expect(branched).toContain('every invocation of the workgroup has to reach it');
  });

  it('spells workgroupUniformLoad as the pointer WGSL takes, on any shape', () => {
    for (const [decl, read, expected] of [
      ['let w: workgroup<u32>', 'workgroupUniformLoad(w)', 'workgroupUniformLoad(&w)'],
      ['let w: workgroup<vec4u>', 'workgroupUniformLoad(w).x', 'workgroupUniformLoad(&w).x'],
      [
        'let w: workgroup<array<u32, 8>>',
        'workgroupUniformLoad(w[2])',
        'workgroupUniformLoad(&w[2])',
      ],
    ] as const) {
      const r = compile(CS(decl, `  o[gid.x] = ${read}`));
      expect(
        r.diagnostics.filter((d) => d.category === 'error'),
        decl,
      ).toEqual([]);
      expect(r.wgsl, decl).toContain(expected);
    }
  });

  it('refuses workgroupUniformLoad of storage, of a branch, and of a render stage', () => {
    // Tint: "no matching call to 'workgroupUniformLoad(ptr<storage, u32, read_write>)'", with
    // two candidates, both workgroup pointers. The surface says which memory it reads instead.
    expect(errorsOf(CS('', '  o[gid.x] = workgroupUniformLoad(o[1])'))[0]).toBe(
      'workgroupUniformLoad reads WORKGROUP memory; this value is not in it. Declare the ' +
        'variable "let w: workgroup<T>" and read it as workgroupUniformLoad(w).',
    );
    // Under a branch on a value the invocations do not share, it is the barrier's refusal,
    // from §54's walk: `o` is a read_write storage buffer, which Tint reads as non-uniform,
    // and it answers "'workgroupUniformLoad' must only be called from uniform control flow".
    expect(
      codedErrorsOf(
        CS('let w: workgroup<u32>', '  if (o[0] === 1) {\n    o[1] = workgroupUniformLoad(w)\n  }'),
      ),
    ).toEqual([
      `${TS_CODES.UNIFORMITY} workgroupUniformLoad() is reached under "o" (a read_write storage buffer), and every ` +
        'invocation of the workgroup has to reach it: one that does not is a workgroup that ' +
        'waits forever. Move it out of the branch, or branch on a value the whole workgroup ' +
        'shares (a uniform, a module const, @builtin("workgroup_id")).',
    ]);
    // A fragment entry has no workgroup memory at all, and Tint refuses the VARIABLE there
    // ("var with 'workgroup' address space cannot be used by fragment pipeline stage") rather
    // than the builtin. So does this surface, by a rule that predates the builtin and fires
    // while the argument is lowered — which is why `lowerWorkgroupUniformLoad` carries no stage
    // arm of its own. The message names what the author has to move.
    expect(
      errorsOf(`"use typeshade";
let w: workgroup<u32>;
@fragment
export function fs(): vec4 {
  return vec4(f32(workgroupUniformLoad(w)) * 0., 0., 0., 1.);
}
`)[0],
    ).toBe(
      '"w" is workgroup memory, which only a compute entry has; a fragment entry cannot read ' +
        'or write it.',
    );
  });

  // Proposal 0008 §4: the load answers to §54's walk, as a barrier does, and no longer to a
  // rule of its own that refused every `if` and `switch`. Measured on Chromium 141 with the
  // instrument reporting first: Tint ACCEPTS the load under `if (k > 0.5)` on a uniform, under
  // `if (wid.x > 2u)`, in a `switch` on `workgroup_id`, and in a loop with a constant bound; it
  // refuses it after a `return` taken under `local_invocation_id`, in a helper called under a
  // branch on it, in a `while` or a `for` it bounds, and below a `break` taken under it, each
  // as "'workgroupUniformLoad' must only be called from uniform control flow". The old rule
  // refused the first four and passed the last five.
  const LOAD_HEAD = `"use typeshade";
declare const o: storage<array<u32>, "read_write">;
declare const k: uniform<f32>;
let w: workgroup<u32>;
`;
  const load = (body: string, helpers = ''): string =>
    `${LOAD_HEAD}${helpers}@compute([64, 1, 1])
export function cs(@builtin("local_invocation_id") lid: vec3u, @builtin("workgroup_id") wid: vec3u): void {
${body}
}
`;
  const refusal = (reached: string, move: string, on: string): string =>
    `${TS_CODES.UNIFORMITY} workgroupUniformLoad() is reached ${reached}, and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. ${move}, or ${on} a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`;
  const LID = '"lid" (@builtin(local_invocation_id))';

  it.each([
    ['a uniform', '  if (k > 0.5) {\n    o[0] = workgroupUniformLoad(w);\n  }'],
    ['workgroup_id', '  if (wid.x > 2) {\n    o[0] = workgroupUniformLoad(w);\n  }'],
    [
      'a switch on workgroup_id',
      '  switch (i32(wid.x)) {\n    case 0: {\n      o[0] = workgroupUniformLoad(w);\n      break;\n    }\n    default: { }\n  }',
    ],
    [
      'a constant loop bound',
      '  for (let i: u32 = 0; i < 4; i++) {\n    o[i] = workgroupUniformLoad(w);\n  }',
    ],
  ])('takes workgroupUniformLoad under %s, which the whole workgroup shares', (_what, body) => {
    const r = compile(load(body));
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('workgroupUniformLoad(&w)');
  });

  // Where the walk cannot classify the flow, the load keeps the answer its old rule gave: each
  // of these compiled before, outside any `if` or `switch`, and Tint accepts each, measured.
  // `opaque` returns the uniform `k`, which the walk does not see through (#180).
  const OPAQUE = 'function opaque(): f32 {\n  return k;\n}\n';
  it.each([
    [
      'after a return under a helper',
      '  if (opaque() > 0.5) { return; }\n  o[0] = workgroupUniformLoad(w);',
      OPAQUE,
    ],
    [
      'in a loop a helper bounds',
      '  for (let i: u32 = 0; i < u32(opaque()); i++) {\n    o[i] = workgroupUniformLoad(w);\n  }',
      OPAQUE,
    ],
    [
      'right of an && on a helper',
      '  if (opaque() > 0.5 && workgroupUniformLoad(w) > 0) { o[0] = 1; }',
      OPAQUE,
    ],
    [
      'right of an && on a uniform',
      '  if (k > 0.5 && workgroupUniformLoad(w) > 0) { o[0] = 1; }',
      '',
    ],
    [
      'right of an || on workgroup_id',
      '  if (wid.x > 2 || workgroupUniformLoad(w) > 0) { o[0] = 1; }',
      '',
    ],
    [
      'in a loop the length of a read_write array bounds',
      '  for (let i: u32 = 0; i < o.length; i++) {\n    o[i] = workgroupUniformLoad(w);\n  }',
      '',
    ],
  ])('takes workgroupUniformLoad %s', (_what, body, helpers) => {
    const r = compile(load(body, helpers));
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('workgroupUniformLoad(&w)');
  });

  it.each([
    [
      'after a return taken under local_invocation_id',
      load('  if (lid.x > 2) { return; }\n  o[0] = workgroupUniformLoad(w);'),
      refusal(`after a return taken under ${LID}`, 'Move it above the return', 'return on'),
    ],
    [
      'in a helper called under a branch on it',
      load(
        '  if (lid.x > 2) {\n    o[0] = peek();\n  }',
        'function peek(): u32 {\n  return workgroupUniformLoad(w);\n}\n',
      ),
      refusal(`under ${LID}`, 'Move it out of the branch', 'branch on'),
    ],
    [
      'in a while it bounds',
      load(
        '  let i: u32 = lid.x;\n  while (i < 8) {\n    o[i] = workgroupUniformLoad(w);\n    i++;\n  }',
      ),
      refusal(
        `in a loop whose condition reads ${LID}`,
        'Move it out of the loop',
        'bound the loop by',
      ),
    ],
    [
      'in a for it bounds',
      load('  for (let i: u32 = 0; i < lid.x; i++) {\n    o[i] = workgroupUniformLoad(w);\n  }'),
      refusal(
        `in a loop whose condition reads ${LID}`,
        'Move it out of the loop',
        'bound the loop by',
      ),
    ],
    [
      'below a break taken under it',
      load(
        '  for (let i: u32 = 0; i < 4; i++) {\n    if (lid.x > 2) { break; }\n    o[i] = workgroupUniformLoad(w);\n  }',
      ),
      refusal(
        `in a loop some invocations leave by a break taken under ${LID}`,
        'Move it out of the loop',
        'break on',
      ),
    ],
    // The condition runs at the top of every iteration, so a later one reaches it with the
    // invocations a jump or the condition itself left behind.
    [
      'in the condition of a loop a continue taken under it cuts short',
      load(
        '  for (let i: u32 = 0; i < workgroupUniformLoad(w); i++) {\n    if (lid.x > 2) { continue; }\n    o[i] = 1;\n  }',
      ),
      refusal(
        `in a loop where some invocations skip ahead by a continue taken under ${LID}`,
        'Move it out of the loop',
        'continue on',
      ),
    ],
    [
      'in the condition of a loop a break taken under it leaves',
      load(
        '  for (let i: u32 = 0; i < workgroupUniformLoad(w); i++) {\n    if (lid.x > 2) { break; }\n    o[i] = 1;\n  }',
      ),
      refusal(
        `in a loop some invocations leave by a break taken under ${LID}`,
        'Move it out of the loop',
        'break on',
      ),
    ],
    [
      'in the condition of a loop that condition bounds by it',
      load(
        '  for (let i: u32 = 0; i < lid.x + workgroupUniformLoad(w); i++) {\n    o[i] = 1;\n  }',
      ),
      refusal(
        `in a loop whose condition reads ${LID}`,
        'Move it out of the loop',
        'bound the loop by',
      ),
    ],
    [
      'right of an && on it',
      load('  if (lid.x > 2 && workgroupUniformLoad(w) > 0) { o[0] = 1; }'),
      refusal(
        `on the right of an && or || whose left side reads ${LID}`,
        'Call it before the && or ||',
        'make the left side',
      ),
    ],
    [
      'right of an || on it',
      load('  if (lid.x > 2 || workgroupUniformLoad(w) > 0) { o[0] = 1; }'),
      refusal(
        `on the right of an && or || whose left side reads ${LID}`,
        'Call it before the && or ||',
        'make the left side',
      ),
    ],
    // Inside an `if`, where its old rule refused every one, a condition the walk cannot
    // classify is still refused, and now says why. Conservative (#180): Tint accepts it.
    [
      'under a branch on a helper',
      load(
        '  if (opaque() > 0.5) {\n    o[0] = workgroupUniformLoad(w);\n  }',
        'function opaque(): f32 {\n  return k;\n}\n',
      ),
      refusal(
        'under the expression, which this compiler cannot prove uniform',
        'Move it out of the branch',
        'branch on',
      ),
    ],
  ])('refuses workgroupUniformLoad %s', (_what, src, want) => {
    expect(codedErrorsOf(src)).toEqual([want]);
  });

  it('fails closed on GLSL ES 3.00, which has neither', () => {
    // Both live in the barrier family's GLSL column, which throws: there is no compute stage
    // there, so no workgroup memory and no texture barrier.
    const r = compile(
      CS('let w: workgroup<u32>', '  textureBarrier()\n  o[gid.x] = workgroupUniformLoad(w)'),
    );
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl).toBeUndefined();
  });
});

// Proposal 0008 §4 on the editor's side (Rule 12.7): the language service runs the same walk,
// so a refusal reads the same in both, and a program that compiles is clean in both.
describe('a jump and workgroupUniformLoad read the same in the editor', () => {
  const both = (src: string): { compiled: string[]; editor: string[] } => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', src);
    return {
      compiled: compileTsSource(src)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => `${d.code} ${d.message}`),
      editor: service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)} ${d.message}`),
    };
  };
  const kernel = (body: string): string => `"use typeshade";
declare const o: storage<array<u32>, "read_write">;
let w: workgroup<u32>;
@compute([64, 1, 1])
export function cs(@builtin("local_invocation_id") lid: vec3u, @builtin("workgroup_id") wid: vec3u): void {
${body}
}
`;
  const LID = '"lid" (@builtin(local_invocation_id))';
  const said = (callee: string, reached: string, move: string, on: string): string =>
    `${TS_CODES.UNIFORMITY} ${callee}() is reached ${reached}, and every invocation of the workgroup has to reach it: one that does not is a workgroup that waits forever. ${move}, or ${on} a value the whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).`;

  it.each([
    [
      'a barrier below a break',
      '  for (let i: u32 = 0; i < 4; i++) {\n    if (lid.x > 2) { break; }\n    workgroupBarrier();\n  }',
      said(
        'workgroupBarrier',
        `in a loop some invocations leave by a break taken under ${LID}`,
        'Move it out of the loop',
        'break on',
      ),
    ],
    [
      'a barrier above a continue',
      '  for (let i: u32 = 0; i < 4; i++) {\n    workgroupBarrier();\n    if (lid.x > 2) { continue; }\n  }',
      said(
        'workgroupBarrier',
        `in a loop where some invocations skip ahead by a continue taken under ${LID}`,
        'Move it out of the loop',
        'continue on',
      ),
    ],
    [
      'a barrier after a break out of a switch case',
      '  switch (i32(wid.x)) {\n    case 0: {\n      if (lid.x > 2) { break; }\n      workgroupBarrier();\n      break;\n    }\n    default: { }\n  }',
      said(
        'workgroupBarrier',
        `after a break out of the switch taken under ${LID}`,
        'Move it above the break',
        'break on',
      ),
    ],
    [
      'a load after a return',
      '  if (lid.x > 2) { return; }\n  o[0] = workgroupUniformLoad(w);',
      said(
        'workgroupUniformLoad',
        `after a return taken under ${LID}`,
        'Move it above the return',
        'return on',
      ),
    ],
  ])('refuses %s in both', (_what, body, want) => {
    expect(both(kernel(body))).toEqual({ compiled: [want], editor: [want] });
  });

  it('takes a barrier below the loop a break left, and a load under a uniform branch, in both', () => {
    expect(
      both(
        kernel(
          '  for (let i: u32 = 0; i < 4; i++) {\n    if (lid.x > 2) { break; }\n    o[i] = 1;\n  }\n  workgroupBarrier();\n  if (wid.x > 2) {\n    o[0] = workgroupUniformLoad(w);\n  }',
        ),
      ),
    ).toEqual({ compiled: [], editor: [] });
  });
});
