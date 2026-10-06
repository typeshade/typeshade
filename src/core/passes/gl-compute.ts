// ═══ A compute entry as the WebGL2 executor's pass program (change 0054, step 2) ═══
//
// `phase-split.ts` cuts an entry into phases and `memory-words.ts` rewrites its memory to
// 32-bit words. This file turns the result into what the WebGL2 executor (`core/gl-compute.ts`)
// runs: one fragment program, drawn once for each slice of its output, and the data the
// executor needs to read what it writes.
//
// One fragment is one invocation; its index is its pixel, `x + y * width`, plus the layer of
// invocations the draw writes (`batch`) times `width × layerRows`. Memory and state are read from
// 2D array textures in the same layout (`GlComputeLayout`). The program:
//
//   1. derives the invocation's builtins from its index and the dispatch's shape (uniforms);
//   2. restores the invocation's state, every private variable of the split entry, from the
//      state texture: `stateWords` words for each invocation, in `state` order;
//   3. if the executor marked the invocation active, runs the phase function, whose memory
//      reads are `_phLoad` (its own log first, else the memory texture as the pass began) and
//      whose writes are `_phStore` (to its log);
//   4. writes its words: the state again, then the log (a count, then each entry's key and
//      value), then the atomic request of the cut it stopped at (a word and two operands).
//
// A draw has four `RGBA32UI` targets, sixteen words, so the executor draws the program once
// for each slice of `outputWords` (the uniform `group` picks it). A log entry's key is the root
// in its top four bits and the word in the rest; the word of a workgroup root already counts
// the workgroup's copy (`index × fixed`), so the scatter needs no more than the key.

import type { Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from '../ir/nodes.js';
import {
  boolT,
  f32T,
  i32T,
  u32T,
  vec2iT,
  vec3uT,
  vec4fT,
  vec4uT,
  type ShaderType,
} from '../ir/types.js';
import { workgroupShapeOf } from '../ir/index.js';
import { sourceSpanOf } from '../ir/span.js';
import { emitGlslStages } from '../backends/glsl.js';
import { isGlslReserved } from '../backends/glsl-sanitize.js';
import { CAS_RESULT_STRUCTS } from '../ir/types.js';
import { validate } from './validate.js';
import { layoutOf } from '../manifest.js';
import type { Layout } from '../host-entry.js';
import { autoVars } from './opt/index.js';
import { splitPhases } from './phase-split.js';
import { lowerMemoryWords, type WordPlan } from './memory-words.js';

/** The width of every texture the executor makes: memory, state and output wrap into rows. */
export const GL_COMPUTE_WIDTH = 2048;

/** The rows of one layer. Memory, state and output are 2D array textures, so a buffer of any
 *  size is layers of `GL_COMPUTE_WIDTH × GL_COMPUTE_LAYER_ROWS` words; 2048 is the least
 *  `MAX_TEXTURE_SIZE` WebGL2 guarantees. */
export const GL_COMPUTE_LAYER_ROWS = 2048;

/** The shape of the executor's textures: a word `w` is texel `(w % width, (w / width) %
 *  layerRows)` of layer `w / (width × layerRows)`. A test passes a small one, so a few words
 *  already span several layers. */
export interface GlComputeLayout {
  readonly width: number;
  readonly layerRows: number;
}

/** The words of one log: four entries of four lanes (change 0054, decision 4). */
const LOG_WORDS = 16;

/** One memory root, as the executor allocates and the host packs it. */
export interface GlRoot {
  readonly name: string;
  readonly space: 'storage' | 'workgroup';
  /** For a workgroup root, the words of one workgroup's copy. For a storage root, the words
   *  before a runtime-sized array, which `stride` words follow per element. */
  readonly fixed: number;
  readonly stride: number;
  /** The private variable that holds a runtime-sized root's element count, if the entry
   *  reads it. */
  readonly length?: string;
}

/** One atomic cut's request, as the executor's resolve pass performs it. */
export interface GlRequest {
  readonly fn: string;
  readonly root: number;
  readonly elem: 'u32' | 'i32';
  /** The state word its value goes to, and whether the value is the
   *  `atomicCompareExchangeWeak` result (two words: the old value, then `exchanged`). */
  readonly result: number | undefined;
  readonly pair: boolean;
}

/** What the executor runs for one entry. Plain data: the executor imports no compiler. */
export interface GlComputeProgram {
  readonly entry: string;
  /** The texture shape the program reads and the executor allocates. */
  readonly layout: GlComputeLayout;
  /** The fullscreen vertex stage and the pass program. */
  readonly vertex: string;
  readonly fragment: string;
  readonly workgroupSize: readonly [number, number, number];
  readonly roots: readonly GlRoot[];
  /** Words of state per invocation, and the state word of the resume point. */
  readonly stateWords: number;
  readonly pcWord: number;
  /** The state word the executor sets to 1 for an invocation that runs this pass. */
  readonly activeWord: number;
  /** Each private variable's first state word and its initial words, which the executor
   *  writes into every invocation's state before the first pass. */
  readonly init: readonly (readonly [number, readonly number[]])[];
  /** Each length variable's state word. */
  readonly lengthWords: Readonly<Record<string, number>>;
  /** Words each invocation writes per pass, and where the log and the request start. */
  readonly outputWords: number;
  readonly logAt: number;
  readonly requestAt: number;
  /** The resume point of a finished invocation, and the cut each other resume point ends. */
  readonly done: number;
  readonly cuts: Readonly<Record<number, 'barrier' | 'atomic' | 'log'>>;
  /** Each barrier cut's builtin and line, for the message a divergent workgroup gets. */
  readonly barriers: Readonly<Record<number, { readonly fn: string; readonly line: string }>>;
  readonly requests: Readonly<Record<number, GlRequest>>;
  /** The uniform bindings the program reads: each one's name, the std140 block GLSL declares
   *  for it, and the layout its host value packs by. */
  readonly uniforms: readonly {
    readonly name: string;
    readonly block: string;
    readonly layout: Layout;
  }[];
}

export class GlComputeError extends Error {}

const lit = (v: number, t: ShaderType = u32T): Expr => ({ op: 'lit', type: t, value: v });
const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const bin = (
  bop: '+' | '-' | '*' | '/' | '%' | '<<' | '|' | '&',
  a: Expr,
  b: Expr,
  t: ShaderType = u32T,
): Expr => ({
  op: 'binop',
  type: t,
  bop,
  a,
  b,
});
const call = (fn: string, type: ShaderType, args: Expr[]): Expr => ({ op: 'call', type, fn, args });
const member = (base: Expr, field: string, type: ShaderType): Expr => ({
  op: 'member',
  type,
  base,
  field,
});
const index = (base: Expr, idx: Expr, type: ShaderType): Expr => ({ op: 'index', type, base, idx });
const assign = (target: Expr, expr: Expr): Stmt => ({ s: 'assign', target, expr });
const cmp = (cop: '<' | '>=' | '==' | '!=', a: Expr, b: Expr): Expr => ({
  op: 'compare',
  type: boolT,
  cop,
  a,
  b,
});

const texU32: ShaderType = { kind: 'texture', dim: '2d-array', elem: 'u32' } as ShaderType;

/** `textureLoad` of word `w` of the array texture `tex`, laid out as `layout` says. */
const fetchIn =
  ({ width, layerRows }: GlComputeLayout) =>
  (tex: string, w: Expr): Expr => {
    const row = bin('/', w, lit(width));
    const coords: Expr = {
      op: 'construct',
      type: vec2iT,
      args: [
        call('i32', i32T, [bin('%', w, lit(width))]),
        call('i32', i32T, [bin('%', row, lit(layerRows))]),
      ],
    };
    const layer = call('i32', i32T, [bin('/', row, lit(layerRows))]);
    return member(
      call('textureLoadArray', vec4uT, [ref(tex, texU32), coords, layer, lit(0, i32T)]),
      'x',
      u32T,
    );
  };

/** The 32-bit lanes of a value of `t`, in the state's order: what a state variable takes. */
class Lanes {
  constructor(private readonly structs: ReadonlyMap<string, StructDecl>) {}

  count(t: ShaderType): number {
    switch (t.kind) {
      case 'scalar':
      case 'atomic':
        return 1;
      case 'vec':
        return t.n;
      case 'mat':
        return t.cols * t.rows;
      case 'struct':
        return this.structs.get(t.name)!.fields.reduce((n, f) => n + this.count(f.type), 0);
      case 'array':
        if (t.size === undefined) throw new GlComputeError('a runtime-sized array in state');
        return t.size * this.count(t.elem);
      default:
        throw new GlComputeError(`a ${t.kind} cannot be kept in state`);
    }
  }

  /** The words of `v`, lane by lane. */
  words(t: ShaderType, v: Expr): Expr[] {
    switch (t.kind) {
      case 'scalar':
      case 'atomic': {
        const s = t.kind === 'scalar' ? t.scalar : t.elem;
        if (s === 'u32') return [v];
        if (s === 'i32') return [call('u32', u32T, [v])];
        if (s === 'f32') return [call('bitcastU32', u32T, [v])];
        if (s === 'bool')
          return [{ op: 'select', type: u32T, cond: v, ifTrue: lit(1), ifFalse: lit(0) }];
        throw new GlComputeError(`a ${s} cannot be kept in state`);
      }
      case 'vec':
        return Array.from({ length: t.n }, (_, k) =>
          this.words(
            { kind: 'scalar', scalar: t.elem },
            member(v, 'xyzw'[k]!, { kind: 'scalar', scalar: t.elem }),
          ),
        ).flat();
      case 'mat': {
        const col: ShaderType = { kind: 'vec', n: t.rows, elem: 'f32' };
        return Array.from({ length: t.cols }, (_, c) =>
          this.words(col, index(v, lit(c), col)),
        ).flat();
      }
      case 'struct':
        return this.structs
          .get(t.name)!
          .fields.flatMap((f) => this.words(f.type, member(v, f.name, f.type)));
      case 'array':
        return Array.from({ length: t.size! }, (_, i) =>
          this.words(t.elem, index(v, lit(i), t.elem)),
        ).flat();
      default:
        throw new GlComputeError(`a ${t.kind} cannot be kept in state`);
    }
  }

  /** A value of `t` from `words`, consumed from the front. */
  value(t: ShaderType, words: Expr[]): Expr {
    switch (t.kind) {
      case 'scalar':
      case 'atomic': {
        const w = words.shift()!;
        const s = t.kind === 'scalar' ? t.scalar : t.elem;
        if (s === 'u32') return w;
        if (s === 'i32') return call('i32', i32T, [w]);
        if (s === 'f32') return call('bitcastF32', f32T, [w]);
        return cmp('!=', w, lit(0));
      }
      case 'vec':
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.n }, () =>
            this.value({ kind: 'scalar', scalar: t.elem }, words),
          ),
        };
      case 'mat': {
        const col: ShaderType = { kind: 'vec', n: t.rows, elem: 'f32' };
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.cols }, () => this.value(col, words)),
        };
      }
      case 'struct':
        return {
          op: 'construct',
          type: t,
          args: this.structs.get(t.name)!.fields.map((f) => this.value(f.type, words)),
        };
      case 'array':
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.size! }, () => this.value(t.elem, words)),
        };
      default:
        throw new GlComputeError(`a ${t.kind} cannot be kept in state`);
    }
  }

  /** The words of a constant initializer, evaluated here: a literal or a construct of them. */
  initial(t: ShaderType, init: Expr | undefined): number[] {
    const n = this.count(t);
    if (init === undefined) return new Array<number>(n).fill(0);
    const flat: (number | boolean)[] = [];
    const walk = (e: Expr): void => {
      if (e.op === 'lit') flat.push(e.value);
      else if (e.op === 'construct') e.args.forEach(walk);
      else throw new GlComputeError('a private variable whose initializer is not a literal');
    };
    walk(init);
    const view = new DataView(new ArrayBuffer(4));
    const scalars: string[] = [];
    const kinds = (x: ShaderType): void => {
      if (x.kind === 'scalar') scalars.push(x.scalar);
      else if (x.kind === 'vec') for (let k = 0; k < x.n; k++) scalars.push(x.elem);
      else if (x.kind === 'mat') for (let k = 0; k < x.cols * x.rows; k++) scalars.push('f32');
      else if (x.kind === 'struct') this.structs.get(x.name)!.fields.forEach((f) => kinds(f.type));
      else if (x.kind === 'array') for (let i = 0; i < x.size!; i++) kinds(x.elem);
    };
    kinds(t);
    // A vector literal of one argument is a splat.
    const values =
      flat.length === 1 && n > 1 ? new Array<number | boolean>(n).fill(flat[0]!) : flat;
    return values.map((v, i) => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (scalars[i] === 'f32') {
        view.setFloat32(0, v, true);
        return view.getUint32(0, true);
      }
      return v >>> 0;
    });
  }
}

/** Split `entry` of `m` and build its pass program. `m` is a module as `compile()` returns it. */
export function buildGlCompute(
  m: ModuleDecl,
  entry: string,
  layout: GlComputeLayout = { width: GL_COMPUTE_WIDTH, layerRows: GL_COMPUTE_LAYER_ROWS },
): GlComputeProgram {
  validate(m);
  const fetch = fetchIn(layout);
  const W = layout.width;
  const plan: WordPlan = lowerMemoryWords(splitPhases(autoVars(m), entry));
  const pm = plan.module;
  const structs = new Map<string, StructDecl>([
    ...CAS_RESULT_STRUCTS.map((c) => [c.name, c] as const),
    ...pm.structs.map((s) => [s.name, s] as const),
  ]);
  const lanes = new Lanes(structs);
  const decl = pm.funcs.find((f) => f.name === entry)!;
  const size = workgroupShapeOf(decl) ?? [64, 1, 1];
  const perGroup = size[0] * size[1] * size[2];

  // The state: every private variable, then the active flag.
  const privates = (pm.vars ?? []).filter((v) => v.space === 'private');
  const at = new Map<string, number>();
  const init: [number, number[]][] = [];
  let words = 0;
  for (const v of privates) {
    at.set(v.name, words);
    init.push([words, lanes.initial(v.type, v.init)]);
    words += lanes.count(v.type);
  }
  const activeWord = words++;
  const stateWords = words;
  const logAt = stateWords;
  const requestAt = logAt + 1 + 2 * LOG_WORDS;
  const outputWords = requestAt + 3;
  const slices = Math.ceil(outputWords / 16);

  // The control uniform: which slice this draw writes, and the dispatch's shape.
  const CTL = '_phx_ctl';
  const ctlT: ShaderType = { kind: 'struct', name: '_PhCtl' };
  const ctlStruct: StructDecl = {
    name: '_PhCtl',
    fields: [
      { name: 'nwg', type: { kind: 'vec', n: 4, elem: 'u32' } },
      { name: 'misc', type: { kind: 'vec', n: 4, elem: 'u32' } },
    ],
  };
  const ctl = (field: 'nwg' | 'misc', k: number): Expr =>
    member(member(ref(CTL, ctlT), field, vec4uT), 'xyzw'[k]!, u32T);
  const group = ctl('misc', 0);
  const count = ctl('misc', 1);
  const batch = ctl('misc', 2);

  // The memory textures, one per root, and the state texture.
  const memTex = plan.roots.map((_, i) => `_phx_mem${String(i)}`);
  const STATE = '_phx_state';
  const textures = [...memTex, STATE];

  // The log, the invocation's index and its workgroup's linear index.
  const LA = '_phx_la';
  const LV = '_phx_lv';
  const LN = '_phx_ln';
  const WG = '_phx_wg';
  const logT: ShaderType = { kind: 'array', elem: u32T, size: LOG_WORDS };
  const extraPrivates = [
    { name: LA, space: 'private' as const, type: logT },
    { name: LV, space: 'private' as const, type: logT },
    { name: LN, space: 'private' as const, type: u32T },
    { name: WG, space: 'private' as const, type: u32T },
  ];

  // `_phLoad(root, word)` and `_phStore(root, word, bits)`.
  const physical = (word: Expr, r: number): Expr =>
    plan.roots[r]!.space === 'workgroup'
      ? bin('+', word, bin('*', ref(WG, u32T), lit(plan.roots[r]!.fixed)))
      : word;
  const key = (r: number, w: Expr): Expr => bin('|', bin('<<', lit(r), lit(28)), w);
  const rootP = ref('root', u32T);
  const wordP = ref('word', u32T);
  const loadBody: Stmt[] = [
    {
      s: 'switch',
      scrut: rootP,
      cases: plan.roots.map((_, r) => {
        const P = ref(`p${String(r)}`, u32T);
        const K = ref(`k${String(r)}`, u32T);
        const I = ref(`i${String(r)}`, u32T);
        return {
          values: [r],
          body: [
            { s: 'let', name: `p${String(r)}`, expr: physical(wordP, r) },
            { s: 'let', name: `k${String(r)}`, expr: key(r, P) },
            {
              s: 'for',
              init: { s: 'var', name: `i${String(r)}`, type: u32T, init: ref(LN, u32T) },
              cond: cmp('>=', I, lit(1)),
              update: assign(I, bin('-', I, lit(1))),
              body: [
                {
                  s: 'if',
                  arms: [
                    {
                      cond: cmp('==', index(ref(LA, logT), bin('-', I, lit(1)), u32T), K),
                      body: [
                        { s: 'return', expr: index(ref(LV, logT), bin('-', I, lit(1)), u32T) },
                      ],
                    },
                  ],
                },
              ],
            },
            { s: 'return', expr: fetch(memTex[r]!, P) },
          ],
        } as { values: number[]; body: Stmt[] };
      }),
      defaultBody: [],
    },
    { s: 'return', expr: lit(0) },
  ];
  const loadFn: FuncDecl = {
    name: '_phLoad',
    params: [
      { name: 'root', type: u32T },
      { name: 'word', type: u32T },
    ],
    ret: u32T,
    body: loadBody,
  };
  const storeFn: FuncDecl = {
    name: '_phStore',
    params: [
      { name: 'root', type: u32T },
      { name: 'word', type: u32T },
      { name: 'bits', type: u32T },
    ],
    ret: { kind: 'void' },
    body: [
      {
        s: 'switch',
        scrut: rootP,
        cases: plan.roots.map((_, r) => ({
          values: [r],
          body: [
            assign(index(ref(LA, logT), ref(LN, u32T), u32T), key(r, physical(wordP, r))),
            assign(index(ref(LV, logT), ref(LN, u32T), u32T), ref('bits', u32T)),
          ],
        })),
        defaultBody: [],
      },
      assign(ref(LN, u32T), bin('+', ref(LN, u32T), lit(1))),
    ],
  };

  // The phase function, no longer an entry.
  const run: FuncDecl = {
    name: '_phx_run',
    params: decl.params.map((p) => ({ name: p.name, type: p.type })),
    ret: { kind: 'void' },
    body: decl.body,
  };

  // The fragment entry.
  const pos = ref('pos', vec4fT);
  const idx = ref('idx', u32T);
  const lidx = ref('lidx', u32T);
  const wl = ref('wl', u32T);
  const nwg = (k: number): Expr => ctl('nwg', k);
  const v3 = (a: Expr, b: Expr, c: Expr): Expr => ({
    op: 'construct',
    type: vec3uT,
    args: [a, b, c],
  });
  const wid = v3(
    bin('%', wl, nwg(0)),
    bin('%', bin('/', wl, nwg(0)), nwg(1)),
    bin('/', wl, bin('*', nwg(0), nwg(1))),
  );
  const lid = v3(
    bin('%', lidx, lit(size[0])),
    bin('%', bin('/', lidx, lit(size[0])), lit(size[1])),
    bin('/', lidx, lit(size[0] * size[1])),
  );
  const builtin = (name: string | undefined): Expr => {
    switch (name) {
      case 'local_invocation_index':
        return lidx;
      case 'local_invocation_id':
        return ref('lid', vec3uT);
      case 'workgroup_id':
        return ref('wid', vec3uT);
      case 'num_workgroups':
        return v3(nwg(0), nwg(1), nwg(2));
      case 'global_invocation_id':
        return {
          op: 'binop',
          type: vec3uT,
          bop: '+',
          a: {
            op: 'binop',
            type: vec3uT,
            bop: '*',
            a: ref('wid', vec3uT),
            b: v3(lit(size[0]), lit(size[1]), lit(size[2])),
          },
          b: ref('lid', vec3uT),
        };
      default:
        throw new GlComputeError(`a compute entry parameter with no builtin (${name ?? 'none'})`);
    }
  };
  const stateWord = (k: number): Expr =>
    fetch(STATE, bin('+', bin('*', idx, lit(stateWords)), lit(k)));
  const restore: Stmt[] = privates.map((v) => {
    const ws = Array.from({ length: lanes.count(v.type) }, (_, k) =>
      stateWord(at.get(v.name)! + k),
    );
    return assign(ref(v.name, v.type), lanes.value(v.type, ws));
  });
  const outT: ShaderType = { kind: 'array', elem: u32T, size: slices * 16 };
  const O = ref('o', outT);
  const put = (k: number, e: Expr): Stmt => assign(index(O, lit(k), u32T), e);
  const save: Stmt[] = privates.flatMap((v) =>
    lanes.words(v.type, ref(v.name, v.type)).map((w, k) => put(at.get(v.name)! + k, w)),
  );
  const logOut: Stmt[] = [
    put(logAt, ref(LN, u32T)),
    ...Array.from({ length: LOG_WORDS }, (_, i) => [
      put(logAt + 1 + i, index(ref(LA, logT), lit(i), u32T)),
      put(logAt + 1 + LOG_WORDS + i, index(ref(LV, logT), lit(i), u32T)),
    ]).flat(),
  ];
  const pc = ref(plan.pc, u32T);
  const requestOut: Stmt = {
    s: 'switch',
    scrut: pc,
    cases: [...plan.requests].map(([p, rq]) => ({
      values: [p],
      body: [
        put(requestAt, rq.word),
        ...rq.operands
          .slice(0, 2)
          .map((o, i) => put(requestAt + 1 + i, lanes.words(o.type, o)[0]!)),
      ],
    })),
    defaultBody: [],
  };
  const OUT = '_PhOut';
  const outStruct: StructDecl = {
    name: OUT,
    fields: [0, 1, 2, 3].map((t) => ({
      name: `t${String(t)}`,
      type: vec4uT,
      location: t,
      attr: `@location(${String(t)})`,
    })),
  };
  const slice = (t: number): Expr => ({
    op: 'construct',
    type: vec4uT,
    args: [0, 1, 2, 3].map((c) =>
      index(O, bin('+', bin('*', group, lit(16)), lit(t * 4 + c)), u32T),
    ),
  });
  const main: FuncDecl = {
    name: '_phx_pass',
    params: [{ name: 'pos', type: vec4fT, builtin: 'position' }],
    ret: { kind: 'struct', name: OUT },
    attrs: ['@fragment'],
    stage: 'fragment',
    body: [
      { s: 'var', name: 'o', type: outT },
      {
        s: 'let',
        name: 'idx',
        expr: bin(
          '+',
          bin(
            '+',
            call('u32', u32T, [member(pos, 'x', f32T)]),
            bin('*', call('u32', u32T, [member(pos, 'y', f32T)]), lit(W)),
          ),
          bin('*', batch, lit(W * layout.layerRows)),
        ),
      },
      {
        s: 'if',
        arms: [
          {
            cond: cmp('<', idx, count),
            body: [
              { s: 'let', name: 'lidx', expr: bin('%', idx, lit(perGroup)) },
              { s: 'let', name: 'wl', expr: bin('/', idx, lit(perGroup)) },
              { s: 'let', name: 'wid', expr: wid },
              { s: 'let', name: 'lid', expr: lid },
              assign(ref(WG, u32T), wl),
              assign(ref(LN, u32T), lit(0)),
              ...restore,
              {
                s: 'if',
                arms: [
                  {
                    cond: cmp('!=', stateWord(activeWord), lit(0)),
                    body: [
                      {
                        s: 'call',
                        expr: call(
                          '_phx_run',
                          { kind: 'void' },
                          decl.params.map((p) => builtin(p.builtin)),
                        ),
                      },
                    ],
                  },
                ],
              },
              ...save,
              put(activeWord, lit(0)),
              ...logOut,
              requestOut,
            ],
          },
        ],
      },
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: { kind: 'struct', name: OUT },
          args: [0, 1, 2, 3].map(slice),
        },
      },
    ],
  };

  const uniforms = pm.bindings
    .filter((b) => b.space === 'uniform')
    .map((b) => {
      const layout = layoutOf(b.type, 'std140', structs);
      if ('none' in layout) throw new GlComputeError(`uniform '${b.name}': ${layout.none}`);
      return {
        name: b.name,
        block: b.type.kind === 'struct' ? b.type.name : `_PhU_${b.name}`,
        layout,
      };
    });
  const module: ModuleDecl = {
    ...pm,
    structs: [...pm.structs, ctlStruct, outStruct],
    bindings: [
      ...pm.bindings.filter((b) => b.space === 'uniform'),
      { group: 1, binding: 0, name: CTL, space: 'uniform', type: ctlT },
      ...textures.map((name, i) => ({
        group: 2,
        binding: i,
        name,
        space: 'uniform' as const,
        type: texU32,
      })),
    ],
    vars: [...(pm.vars ?? []).filter((v) => v.space === 'private'), ...extraPrivates],
    funcs: [...pm.funcs.filter((f) => f.name !== entry), run, loadFn, storeFn, main],
  };
  const { vertex, fragment } = emitGlslStages(fullscreen(legalize(module)), {
    fragmentEntry: '_phx_pass',
    vertexEntry: '_phx_vs',
  });

  const cuts: Record<number, 'barrier' | 'atomic' | 'log'> = {};
  const barriers: Record<number, { fn: string; line: string }> = {};
  for (const [p, c] of plan.cuts) {
    cuts[p] = c.kind;
    if (c.kind !== 'barrier') continue;
    const where = c.stmt ? sourceSpanOf(c.stmt) : undefined;
    barriers[p] = {
      fn: c.fn,
      line: where === undefined ? 'a line without a span' : `line ${where.line}`,
    };
  }
  const requests: Record<number, GlRequest> = {};
  for (const [p, rq] of plan.requests) {
    requests[p] = {
      fn: rq.fn,
      root: rq.root,
      elem: rq.elem,
      result: rq.result === undefined ? undefined : at.get(rq.result),
      pair: rq.fn === 'atomicCompareExchangeWeak',
    };
  }
  const lengthWords: Record<string, number> = {};
  const roots: GlRoot[] = plan.roots.map((r) => {
    const len = `_phx_len_${r.name}`;
    if (at.has(len)) lengthWords[r.name] = at.get(len)!;
    return {
      name: r.name,
      space: r.space,
      fixed: r.fixed,
      stride: r.stride,
      ...(at.has(len) ? { length: len } : {}),
    };
  });
  return {
    entry,
    layout,
    vertex,
    fragment,
    workgroupSize: size,
    roots,
    stateWords,
    pcWord: at.get(plan.pc)!,
    activeWord,
    init,
    lengthWords,
    outputWords,
    logAt,
    requestAt,
    done: plan.done,
    cuts,
    barriers,
    requests,
    uniforms,
  };
}

/** `m` with a vertex entry that draws the fullscreen triangle. */
function fullscreen(m: ModuleDecl): ModuleDecl {
  const vi = ref('vi', u32T);
  const x = call('f32', f32T, [bin('&', bin('<<', vi, lit(1)), lit(2))]);
  const y = call('f32', f32T, [bin('&', vi, lit(2))]);
  const vs: FuncDecl = {
    name: '_phx_vs',
    params: [{ name: 'vi', type: u32T, builtin: 'vertex_index' }],
    ret: vec4fT,
    attrs: ['@vertex'],
    stage: 'vertex',
    retAttr: '@builtin(position)',
    retBuiltin: 'position',
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: vec4fT,
          args: [
            bin('-', bin('*', x, lit(2, f32T), f32T), lit(1, f32T), f32T),
            bin('-', bin('*', y, lit(2, f32T), f32T), lit(1, f32T), f32T),
            lit(0, f32T),
            lit(1, f32T),
          ],
        },
      },
    ],
  };
  return { ...m, funcs: [...m.funcs, vs] };
}

/** Rebuild plain IR data with `f` applied to every object, children first. A call's `declRef`
 *  and a node's `span` are kept as they are. */
function deepMap(x: unknown, f: (o: Record<string, unknown>) => unknown): unknown {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((y) => deepMap(y, f));
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x))
    o[k] = k === 'declRef' || k === 'span' ? v : deepMap(v, f);
  return f(o);
}

/** `m` as the GLSL writer takes it for the pass program:
 *
 *  - a uniform binding of a type that is not a struct becomes a struct of one field, `v`, whose
 *    std140 bytes are the value's own, since GLSL ES 3.00 binds a uniform buffer as a block;
 *  - the struct `atomicCompareExchangeWeak` answers takes a name of its own, since GLSL keeps
 *    every name with `__` in it;
 *  - a struct field whose name GLSL keeps takes another: memory is words here, so no host reads
 *    a field by its name. */
function legalize(m: ModuleDecl): ModuleDecl {
  const wrapped = new Map<string, ShaderType>();
  const structs: StructDecl[] = [...m.structs];
  const bindings = m.bindings.map((b) => {
    if (b.space !== 'uniform' || b.type.kind === 'struct' || b.type.kind === 'texture') return b;
    const name = `_PhU_${b.name}`;
    wrapped.set(b.name, b.type);
    structs.push({ name, fields: [{ name: 'v', type: b.type }] });
    return { ...b, type: { kind: 'struct' as const, name } };
  });
  const cas = new Map(CAS_RESULT_STRUCTS.map((c) => [c.name, `_PhCas_${c.name.slice(-3)}`]));
  for (const c of CAS_RESULT_STRUCTS) structs.push({ name: cas.get(c.name)!, fields: c.fields });
  const renamed = new Map<string, Map<string, string>>();
  const fixed = structs.map((s) => {
    const names = new Map<string, string>();
    for (const f of s.fields) if (isGlslReserved(f.name)) names.set(f.name, `_phx_f_${f.name}`);
    if (names.size === 0) return s;
    renamed.set(s.name, names);
    return { ...s, fields: s.fields.map((f) => ({ ...f, name: names.get(f.name) ?? f.name })) };
  });
  const out = deepMap({ ...m, structs: fixed, bindings }, (o) => {
    if (o['kind'] === 'struct' && typeof o['name'] === 'string' && cas.has(o['name'])) {
      return { ...o, name: cas.get(o['name']) };
    }
    if (o['op'] === 'member') {
      const base = o['base'] as Expr;
      const names = base.type.kind === 'struct' ? renamed.get(base.type.name) : undefined;
      const field = o['field'] as string;
      if (names?.has(field)) return { ...o, field: names.get(field) };
    }
    if ((o['op'] === 'varref' || o['op'] === 'param') && wrapped.has(o['name'] as string)) {
      const name = o['name'] as string;
      const t = wrapped.get(name)!;
      return member({ op: 'varref', type: { kind: 'struct', name: `_PhU_${name}` }, name }, 'v', t);
    }
    return o;
  }) as ModuleDecl;
  return out;
}
