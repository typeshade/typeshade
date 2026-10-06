// ═══ A WebGL2 context of the runtime's own (change 0013, change 0054) ═══
//
// The call layer's WebGL2 tier makes one context on its first call that needs it and keeps it
// (`glContext`); the program runtime makes one of its own for each runtime it is not handed a
// context for (`makeGlContext`). Neither borrows or restores host state. A module of its own, so
// the program runtime carries no kernel loop to have a context. Like the rest of
// `typeshade/runtime` it imports nothing.

/** A new WebGL2 context on a 1 × 1 canvas, or null where the environment makes none. */
export function makeGlContext(): WebGL2RenderingContext | null {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : undefined;
    return (canvas?.getContext('webgl2') as WebGL2RenderingContext | null | undefined) ?? null;
  } catch {
    return null;
  }
}

let context: WebGL2RenderingContext | null | undefined;

/** The call layer's WebGL2 context, made on first use; null where there is none. */
export function glContext(): WebGL2RenderingContext | null {
  if (context === undefined) context = makeGlContext();
  return context;
}
