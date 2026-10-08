// ═══ Which sampler each texture is sampled with (Rule 11.10, change 0028) ═══
//
// One fact, two consumers. The WebGL2 tier fuses each texture with the one sampler its calls
// pass it (`glDrawOf` in `manifest.ts`), and a WebGPU host lays a texture out `'float'` or
// `'unfilterable-float'` by whether any call gives it a sampler (`reflect()`'s `sampleType`).
// WebGPU refuses a texture laid out `'unfilterable-float'` that a call pairs with a `filtering`
// sampler, and lays every `sampler` binding out `filtering`, so a texture that is wrongly left
// out here is a pipeline the device refuses. Measured on Chromium 153 (Dawn on SwiftShader): the
// refusal comes for `textureSample`, `textureSampleLevel` and `textureGather` alike, for a pair
// made through a helper function's parameters, and for one made through a `let` alias of the
// bindings; a texture only loaded, measured or counted meets no sampler, whatever sampler the
// layout holds beside it.
//
// So the pairing is read where the handles flow, not only at the call that names the bindings:
//
//   - a call pairs every texture it is given with every plain `sampler` it is given, wherever they
//     stand among its arguments: `textureGather` takes its component first, and a builtin added
//     later that takes both needs no row here;
//   - a helper function pairs the parameters its body pairs, and a call of it pairs the handles
//     it passes there;
//   - a `let` of a texture or a sampler is the handle it names.
//
// A comparison sampler pairs with a depth texture alone, which is laid out `'depth'` whatever
// meets it, so it is left out. Read-only over the IR, and no backend: `reflect()` is target-neutral.
//
// Implements: Rule 11.10 (docs/language-design.md; traced in reqs/).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { stageOf } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { reachFrom } from './stage-bindings.js';
import { bodyHasRaw } from './opt/dce.js';

/** Where a handle comes from inside one function: a module binding, by name, or a parameter of
 *  the function, by index. */
type Origin = string | number;

/** A texture and the plain sampler a call pairs it with. */
type Pair = readonly [texture: Origin, sampler: Origin];

const isTexture = (t: ShaderType): boolean => t.kind === 'texture' || t.kind === 'depth-texture';
const isSampler = (t: ShaderType): boolean =>
  t.kind === 'sampler' || t.kind === 'sampler-comparison';
const isHandle = (t: ShaderType): boolean => isTexture(t) || isSampler(t);

/**
 * The plain sampler bindings each texture binding is paired with, in the calls of the functions
 * in `closure` (an entry and every function it reaches). A texture no call pairs is absent.
 *
 * @param closure - names of the functions to read: an entry's closure.
 * @param byName - every function of the module, by name.
 * @param declared - the names of the functions the module declares, which a call is to a helper
 *   and not to a builtin.
 * @param bindings - the names of the module's bindings, which a handle's name is one of unless
 *   it is a local or a parameter.
 * @param comparison - pair a depth texture with the comparison sampler it is compared through
 *   as well, which the WebGL2 compute tier fuses into one shadow sampler (change 0054); off,
 *   only a plain `sampler` pairs.
 */
export function texturePairs(
  closure: ReadonlySet<string>,
  byName: ReadonlyMap<string, FuncDecl>,
  declared: ReadonlySet<string>,
  bindings: ReadonlySet<string>,
  comparison = false,
): Map<string, Set<string>> {
  const pairs = (t: ShaderType): boolean =>
    t.kind === 'sampler' || (comparison && t.kind === 'sampler-comparison');
  const summaries = new Map<string, readonly Pair[]>();
  const open = new Set<string>();

  /** The pairs `f`'s body makes, in `f`'s own terms: its parameters by index, the bindings by
   *  name, through the helpers it calls. */
  const summary = (f: FuncDecl): readonly Pair[] => {
    const done = summaries.get(f.name);
    if (done !== undefined) return done;
    // WGSL has no recursion; a cycle would only be a program the front end refuses.
    if (open.has(f.name)) return [];
    open.add(f.name);

    const found = new Map<string, Pair>();
    const add = (t: Origin, s: Origin): void => {
      found.set(`${typeof t}${t}|${typeof s}${s}`, [t, s]);
    };
    // The handles a name stands for here: a parameter is its index, and a `let` of a handle is
    // whatever it was given. A name is a binding too unless a local of that name hides it, which
    // this does not track by scope, so a local of a binding's name keeps both.
    const env = new Map<string, Set<Origin>>();
    f.params.forEach((p, i) => {
      if (isHandle(p.type)) env.set(p.name, new Set([i]));
    });
    const originsOf = (e: Expr | undefined): Origin[] => {
      if (e === undefined) return [];
      if (e.op === 'param') return [...(env.get(e.name) ?? [])];
      if (e.op !== 'varref') return [];
      return [...(bindings.has(e.name) ? [e.name] : []), ...(env.get(e.name) ?? [])];
    };
    const alias = (name: string, init: Expr): void => {
      if (!isHandle(init.type)) return;
      let set = env.get(name);
      if (set === undefined) env.set(name, (set = new Set()));
      for (const o of originsOf(init)) set.add(o);
    };

    const calls = (root: Expr): void =>
      eachExpr(root, (x) => {
        if (x.op !== 'call') return;
        const callee = declared.has(x.fn) ? byName.get(x.fn) : undefined;
        if (callee !== undefined) {
          // A helper pairs the parameters its body pairs: here, the handles passed there.
          const at = (o: Origin): Origin[] => (typeof o === 'number' ? originsOf(x.args[o]) : [o]);
          for (const [t, s] of summary(callee))
            for (const a of at(t)) for (const b of at(s)) add(a, b);
          return;
        }
        // A builtin, or a function the host provides: each texture it is given meets each plain
        // sampler it is given (and each comparison sampler, when those are asked for).
        const textures = x.args.filter((a) => isTexture(a.type)).flatMap(originsOf);
        const samplers = x.args.filter((a) => pairs(a.type)).flatMap(originsOf);
        for (const t of textures) for (const s of samplers) add(t, s);
      });
    const walk = (s: Stmt): void => {
      if (s.s === 'let') alias(s.name, s.expr);
      else if (s.s === 'var' && s.init !== undefined) alias(s.name, s.init);
      eachStmtExpr(s, calls, walk);
    };
    for (const s of f.body) walk(s);

    open.delete(f.name);
    const out = [...found.values()];
    summaries.set(f.name, out);
    return out;
  };

  const out = new Map<string, Set<string>>();
  for (const name of closure) {
    const f = byName.get(name);
    if (f === undefined) continue;
    // Only the pairs between bindings are the module's: a parameter's are its callers'.
    for (const [t, s] of summary(f)) {
      if (typeof t !== 'string' || typeof s !== 'string') continue;
      let set = out.get(t);
      if (set === undefined) out.set(t, (set = new Set()));
      set.add(s);
    }
  }
  return out;
}

/**
 * The texture bindings a call of the module's entries pairs with a plain `sampler`: the ones a
 * host lays out `'float'`, since a `sampler` binding is laid out `filtering`. Every other `f32`
 * texture the module declares is only loaded, measured or counted, or read by no entry at all.
 * A module with no entry is a library a host writes its entries over, so it is read whole.
 *
 * `undefined` when the module holds a `raw` statement in what its entries reach: its text is
 * opaque, and can pair any texture with any sampler. A caller takes every texture as sampled.
 */
export function sampledTextures(m: ModuleDecl): ReadonlySet<string> | undefined {
  const entries = m.funcs.filter((f) => stageOf(f) !== undefined);
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const reach = reachFrom(m, entries.length > 0 ? entries : m.funcs).fns;
  for (const name of reach) if (bodyHasRaw(byName.get(name)!.body)) return undefined;
  const pairs = texturePairs(
    reach,
    byName,
    new Set(byName.keys()),
    new Set(m.bindings.map((b) => b.name)),
  );
  return new Set(pairs.keys());
}
