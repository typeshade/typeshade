"use typeshade"

// Classes with methods (design #86, §26): a `class Ray` with a constructor, a method and a static
// function, and a `class Sphere` whose `hit(ray)` method returns the distance along the ray or
// a negative number for a miss. Each method is a function whose first parameter is the struct
// (`Ray_at(self: Ray, t: f32)`), the constructor `Ray_new(...)` starts from the zero struct and
// returns it, and `new Sphere()` on a class with no constructor is the zero struct with its field
// initializer. Both targets take a struct by value and spell a struct constructor, so the gate
// runs the same program through Tint and a WebGL2 context; a fullscreen triangle shades the
// sphere by its normal.

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class Ray {
  origin: vec3
  dir: vec3
  constructor(origin: vec3, dir: vec3) {
    this.origin = origin
    this.dir = normalize(dir)
  }
  at(t: f32): vec3 {
    return this.origin + this.dir * t
  }
  static forward(): vec3 {
    return vec3(0., 0., -1.)
  }
}

class Sphere {
  center: vec3
  radius: f32 = 1.
  hit(r: Ray): f32 {
    // Annotated for the editor: the ambient lib types vector arithmetic loosely, and `dot` is
    // generic over its two arguments.
    const oc: vec3 = r.origin - this.center
    const b = dot(oc, r.dir)
    const c = dot(oc, oc) - this.radius * this.radius
    const h = b * b - c
    if (h < 0.) {
      return -1.
    }
    return -b - sqrt(h)
  }
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  return { pos: vec4(p, 0., 1.), uv: p }
}

@fragment
export function fs(v: VsOut): vec4 {
  const ray = new Ray(vec3(0., 0., 2.), vec3(v.uv, 0.) + Ray.forward())
  const sphere = new Sphere()
  const t = sphere.hit(ray)
  if (t < 0.) {
    return vec4(0.05, 0.05, 0.1, 1.)
  }
  const n = normalize(ray.at(t) - sphere.center)
  return vec4(n * 0.5 + vec3(0.5), 1.)
}
