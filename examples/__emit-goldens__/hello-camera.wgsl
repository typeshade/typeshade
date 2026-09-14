struct Camera {
  view: mat4x4<f32>,
  pos: vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;

fn origin() -> vec3<f32> {
  return camera.pos;
}
