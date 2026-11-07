import { stageOf, type ModuleDecl } from '../../core/ir/nodes.js';
import { isPortableComputeEntry } from '../../core/passes/portable-kernel.js';
import { reachFrom } from '../../core/passes/stage-bindings.js';
import { fnWrites } from '../../core/passes/effects.js';

/**
 * The part of `m` its vertex and fragment programs are made of: the functions and bindings
 * its render entries (and its `portable` compute entries, which the GLSL writer draws as
 * fragments) reach. A compute entry runs on WebGL2 as its pass program, so the read-write
 * storage, the atomics and the barriers only it reaches stay out of the render programs.
 * `FnWrites` is keyed by function name and transitive, so a render entry's own row covers the
 * helpers it calls. Shared by compile() and the language service's output pane.
 */
export function renderPart(m: ModuleDecl): ModuleDecl {
  const entries = m.funcs.filter((f) => stageOf(f) !== undefined);
  const drawn = entries.filter((f) => stageOf(f) !== 'compute' || isPortableComputeEntry(f));
  if (drawn.length === entries.length) return m;
  const reach = reachFrom(m, drawn);
  const writes = fnWrites(m);
  const written = new Set(drawn.flatMap((f) => [...(writes.get(f.name) ?? [])]));
  return {
    ...m,
    funcs: m.funcs.filter((f) => reach.fns.has(f.name)),
    // Storage a compute entry writes and a render entry only reads is read-only to the render
    // programs, which read it as a data texture.
    bindings: m.bindings
      .filter((b) => reach.bindings.has(b.name))
      .map((b) =>
        b.space === 'storage' && b.access === 'read_write' && !written.has(b.name)
          ? { ...b, access: 'read' as const }
          : b,
      ),
  };
}
