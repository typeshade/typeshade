"use typeshade"

/* @example
{
  "title": "Hello camera uniform",
  "blurb": "A `Camera` class of `mat4` + `vec3` behind `uniform<Camera>`, read by a plain helper function. Shows the std140 block both backends lay out, and that a module needs no entry point to be a module.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Plain data with no field metadata, written as the type alias §2 of the surface document
// illustrates for this very struct. A class, an interface and a type alias produce the same
// `StructDecl`, so the spelling says what the shape is FOR rather than changing what it emits:
// a class is the one that can carry `@location` and `@builtin`, which entry I/O needs and this
// does not.

type Camera = {
  view: mat4
  pos: vec3
}

declare const camera: uniform<Camera>

export function origin(): vec3 {
  return camera.pos
}
