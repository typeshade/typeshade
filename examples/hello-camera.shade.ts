"use typeshade"

class Camera {
  view: mat4
  pos: vec3
}

declare const camera: uniform<Camera>

export function origin(): vec3 {
  return camera.pos
}
