"use typeshade";

/* @example
{
  "title": "Class-based Capsule Corp. spaceship on Namek",
  "blurb": "A class-based conversion of a Dragon Ball Z Capsule Corp. spaceship scene: the ship, landing gear, trees, terrain, lettering, materials, cel shading and camera are organized as TypeShade classes around a shared SDF scene.",
  "renderable": true
}
*/


// =======================================================================================================
// Capsule Corp. Spaceship from Dragon Ball Z, landed on Namek
//
// Class-based TypeShade conversion of the original ShaderToy shader.
// The rendering logic is kept intact while the major shader systems are
// represented as ordinary TypeScript classes.
// =======================================================================================================

class Uniforms {
  time: f32;
  resolution: vec2;
  mouse: vec2;
}

declare const u: uniform<Uniforms>;

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

const AA: i32 = 1;

const PI = 3.14159265;
const TAU = 6.28318531;

const GROUND = -1.04;
const BAND_TOP = 0.08;
const BAND_BOT = -0.52;

const WIN_N = 12.0;
const WIN_Y = -0.22;
const WIN_A = 0.10;
const WIN_BULGE = 0.06;

const RING_Y = 0.71;
const RING_H = 0.04;

const DOOR_HW = 0.17;
const DOOR_Y0 = -0.60;
const DOOR_Y1 = 0.21;
const DOOR_T = 0.005;

const LEG_LON = 0.7854;
const FLAP_Y = -0.60;
const FLAP_LEN = 0.36;
const FLAP_HW = 0.125;
const FLAP_TIP_HW = 0.08;
const FLAP_T = 0.03;
const FLAP_OPEN = 2.2;
const BAY_DEPTH = 0.03;

const LEG_R = 0.99;
const SHOCK_Y = GROUND + 0.12;
const BELLY_R = 0.26;
const BELLY_Y = -sqrt(1.0 - BELLY_R * BELLY_R);
const BELLY_EXT = 0.06;
const SHAFT_R = 0.10;

const CAPS_LON = 0.08;
const CAPS_LAT = 0.547;
const CAPS_H = 0.25;

const CORP_LON = 0.02;
const CORP_LAT = 0.284;
const CORP_H = 0.10;

const ADV = 0.78;

const COAST_R = 10.0;
const MESA_R = 18.0;

const SW = 0.085;

const SHEEN_R = 0.99;
const HATCH_W = 0.02;
const HATCH_L = 0.09;
const HATCH_D = 0.09;

const SCUFFS = 10.0;

const DIRT_GRAIN = vec2(0.7, 0.0);
const DIRT_TILT = 0.3;

// Material palette

const INK = vec3(0.05, 0.07, 0.09);
const HULL = vec3(0.92, 0.95, 0.91);
const BLACK = vec3(0.07, 0.11, 0.14);
const BLACK_HI = vec3(0.47, 0.68, 0.68);
const METAL = vec3(0.74, 0.76, 0.78);
const GLASS_LO = vec3(0.36, 0.70, 0.80);
const GLASS_HI = vec3(0.06, 0.33, 0.50);
const SHADE = vec3(0.64, 0.76, 0.86);

const SKY_TOP = vec3(0.30, 0.67, 0.37);
const SKY_MID = vec3(0.58, 0.78, 0.50);
const SKY_HZ = vec3(0.74, 0.87, 0.70);
const CLOUD = vec3(0.84, 0.93, 0.77);
const HAZE = vec3(0.62, 0.80, 0.74);
const GRASS = vec3(0.20, 0.57, 0.58);
const GRASS_DK = vec3(0.15, 0.45, 0.50);
const SAND = vec3(0.86, 0.80, 0.62);
const SAND_RIM = vec3(0.80, 0.50, 0.38);
const DIRT_DK = vec3(0.60, 0.43, 0.28);
const SEA = vec3(0.435, 0.663, 0.494);
const SEA_SHOAL = vec3(0.55, 0.77, 0.62);
const SEA_HI = vec3(0.80, 0.91, 0.80);
const MESA_TOP = vec3(0.30, 0.62, 0.55);
const CLIFF_A = vec3(0.86, 0.58, 0.48);
const CLIFF_B = vec3(0.95, 0.80, 0.66);
const CLIFF_C = vec3(0.66, 0.38, 0.36);
const LEAF = vec3(0.13, 0.48, 0.60);
const LEAF_HI = vec3(0.38, 0.72, 0.78);
const TRUNK = vec3(0.86, 0.88, 0.78);

const LIG = normalize(vec3(-0.59, 0.36, 0.73));

const CROSS: array<vec2, 4> = [
  vec2(-1.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, -1.0),
  vec2(0.0, 1.0)
];

const TET: array<vec3, 4> = [
  vec3(1.0, -1.0, -1.0),
  vec3(-1.0, -1.0, 1.0),
  vec3(-1.0, 1.0, -1.0),
  vec3(1.0)
];

// ---------------------------------------------------------------------
// Utility result types
// ---------------------------------------------------------------------

class PolarResult {
  point: vec3;
  index: f32;

  constructor(point: vec3, index: f32) {
    this.point = point;
    this.index = index;
  }
}

class MarchResult {
  hit: vec2;
  edge: f32;
  winEdge: f32;
  tEdge: f32;

  constructor(hit: vec2, edge: f32, winEdge: f32, tEdge: f32) {
    this.hit = hit;
    this.edge = edge;
    this.winEdge = winEdge;
    this.tEdge = tEdge;
  }
}

// ---------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------

class Noise {
  static hash12(p: vec2): f32 {
    let p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  static value(p: vec2): f32 {
    const i = floor(p);
    const f = fract(p);
    const q = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        Noise.hash12(i),
        Noise.hash12(i + vec2(1.0, 0.0)),
        q.x
      ),
      mix(
        Noise.hash12(i + vec2(0.0, 1.0)),
        Noise.hash12(i + vec2(1.0, 1.0)),
        q.x
      ),
      q.y
    );
  }

  static fbm(p: vec2): f32 {
    const rotation = mat2(1.6, 1.2, -1.2, 1.6);
    let q = p;
    let sum = 0.0;
    let amplitude = 0.5;

    for (let i = 0; i < 4; i++) {
      sum += amplitude * Noise.value(q);
      q = rotation * q;
      amplitude *= 0.5;
    }

    return sum / 0.9375;
  }

  static wrapX(p: vec2, n: f32): f32 {
    const i = floor(p);
    const f = fract(p);
    const q = f * f * (3.0 - 2.0 * f);
    const i0 = mod(i.x, n);
    const i1 = mod(i.x + 1.0, n);

    return mix(
      mix(
        Noise.hash12(vec2(i0, i.y)),
        Noise.hash12(vec2(i1, i.y)),
        q.x
      ),
      mix(
        Noise.hash12(vec2(i0, i.y + 1.0)),
        Noise.hash12(vec2(i1, i.y + 1.0)),
        q.x
      ),
      q.y
    );
  }

  static fbmWrapX(p: vec2, n: f32): f32 {
    let q = p;
    let period = n;
    let sum = 0.0;
    let amplitude = 0.5;

    for (let i = 0; i < 4; i++) {
      sum += amplitude * Noise.wrapX(q, period);
      q = 2.0 * q + vec2(0.0, 5.3);
      period *= 2.0;
      amplitude *= 0.5;
    }

    return sum / 0.9375;
  }
}

// ---------------------------------------------------------------------
// SDF primitives
// ---------------------------------------------------------------------

function inverseMat2(a: f32, b: f32, c: f32, d: f32): mat2 {
  const determinant = a * d - b * c;

  return mat2(
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant
  );
}

class SDF {
  static union(a: vec2, b: vec2): vec2 {
    return a.x < b.x ? a : b;
  }

  static segment(p: vec2, a: vec2, b: vec2): f32 {
    const pa = p - a;
    const ba = b - a;

    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }

  static box(p: vec3, b: vec3): f32 {
    const q = abs(p) - b;
    return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  static box2(p: vec2, b: vec2): f32 {
    const q = abs(p) - b;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
  }

  static trapezoid(p: vec2, r1: f32, r2: f32, height: f32): f32 {
    const k1 = vec2(r2, height);
    const k2 = vec2(r2 - r1, 2.0 * height);
    const qx = abs(p.x);
    const q = vec2(qx, p.y);

    const ca = vec2(
      qx - min(qx, q.y < 0.0 ? r1 : r2),
      abs(q.y) - height
    );

    const cb =
      q -
      k1 +
      k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);

    const sign = cb.x < 0.0 && ca.y < 0.0 ? -1.0 : 1.0;

    return sign * sqrt(min(dot(ca, ca), dot(cb, cb)));
  }

  static cylinderY(p: vec3, radius: f32, y0: f32, y1: f32): f32 {
    const d = vec2(
      length(p.xz) - radius,
      abs(p.y - 0.5 * (y0 + y1)) - 0.5 * (y1 - y0)
    );

    return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
  }

  static coneY(p: vec3, rb: f32, rt: f32, y0: f32, y1: f32): f32 {
    const halfHeight = 0.5 * (y1 - y0);
    const q = vec2(
      length(p.xz),
      p.y - y0 - halfHeight
    );

    const k1 = vec2(rt, halfHeight);
    const k2 = vec2(rt - rb, 2.0 * halfHeight);

    const ca = vec2(
      q.x - min(q.x, q.y < 0.0 ? rb : rt),
      abs(q.y) - halfHeight
    );

    const cb =
      q -
      k1 +
      k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);

    const sign = cb.x < 0.0 && ca.y < 0.0 ? -1.0 : 1.0;

    return sign * sqrt(min(dot(ca, ca), dot(cb, cb)));
  }

  static cutSphereBelow(p: vec3, radius: f32, height: f32): f32 {
    const width = sqrt(radius * radius - height * height);
    const q = vec2(length(p.xz), -p.y);
    const h = -height;

    const s = max(
      (h - radius) * q.x * q.x +
        width * width * (h + radius - 2.0 * q.y),
      h * q.x - width * q.y
    );

    return s < 0.0
      ? length(q) - radius
      : q.x < width
        ? h - q.y
        : length(q - vec2(width, h));
  }

  static cylinderSegment(p: vec3, a: vec3, b: vec3, radius: f32): f32 {
    const pa = p - a;
    const ba = b - a;
    const lengthAB = length(ba);
    const h = dot(pa, ba) / lengthAB;

    const d = vec2(
      length(pa - ba * (h / lengthAB)) - radius,
      abs(h - 0.5 * lengthAB) - 0.5 * lengthAB
    );

    return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
  }

  static capsule(p: vec3, a: vec3, b: vec3, radius: f32): f32 {
    const pa = p - a;
    const ba = b - a;

    return length(
      pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)
    ) - radius;
  }

  static rotate(p: vec2, angle: f32): vec2 {
    const c = cos(angle);
    const s = sin(angle);

    return mat2(c, s, -s, c) * p;
  }

  static arch(p: vec2, halfWidth: f32, y0: f32, y1: f32): f32 {
    const d =
      length(
        vec2(
          p.x,
          p.y - clamp(p.y, y0 - halfWidth, y1 - halfWidth)
        )
      ) - halfWidth;

    return max(d, y0 - p.y);
  }

  static polarY(
    angle: f32,
    radius: f32,
    y: f32,
    count: f32,
    offset: f32
  ): PolarResult {
    const sector = TAU / count;
    const shifted = angle - offset;
    const index = floor(shifted / sector + 0.5);
    const localAngle = shifted - index * sector;

    return new PolarResult(
      vec3(
        radius * sin(localAngle),
        y,
        radius * cos(localAngle)
      ),
      index
    );
  }
}

// ---------------------------------------------------------------------
// Ship
// ---------------------------------------------------------------------

class Ship {
  legCount: f32;

  constructor() {
    this.legCount = 4.0;
  }

  flapOutline(s: vec3): f32 {
    const radius = 0.06;
    const angle =
      asin(FLAP_Y) -
      atan(s.y, length(s.xz));

    return SDF.trapezoid(
      vec2(s.x, angle - 0.5 * FLAP_LEN),
      FLAP_HW - radius,
      FLAP_TIP_HW - radius,
      0.5 * FLAP_LEN - radius
    ) - radius;
  }

  flapHome(l: vec3): vec3 {
    const hinge = vec2(
      sqrt(1.0 - FLAP_Y * FLAP_Y),
      FLAP_Y
    );

    const q =
      hinge +
      SDF.rotate(
        l.zy - hinge,
        -FLAP_OPEN
      );

    return vec3(l.x, q.y, q.x);
  }

  flap(l: vec3): f32 {
    const home = this.flapHome(l);

    return max(
      abs(length(home) - 1.0 + 0.5 * FLAP_T) - 0.5 * FLAP_T,
      this.flapOutline(home)
    );
  }

  mapLeg(l: vec3, best: f32): vec2 {
    let y = -0.73;
    const sag = 0.02;

    const hinge = vec2(
      sqrt(1.0 - FLAP_Y * FLAP_Y),
      FLAP_Y
    );

    const tipLat = asin(FLAP_Y) - FLAP_LEN;

    const tip =
      hinge +
      SDF.rotate(
        vec2(cos(tipLat), sin(tipLat)) - hinge,
        FLAP_OPEN
      );

    let bounds = max(
      SDF.segment(l.zy, hinge, tip) - FLAP_T - FLAP_HW,
      abs(l.x) - FLAP_HW
    );

    const lo = vec3(-0.1, GROUND, 0.0);
    const hi = vec3(0.1, y + sag + 0.02, LEG_R + 0.1);

    bounds = min(
      bounds,
      SDF.box(
        l - 0.5 * (lo + hi),
        0.5 * (hi - lo)
      )
    );

    if (bounds > min(best, 0.1)) {
      return vec2(bounds, 5.0);
    }

    const c = l - vec3(0.0, 0.0, LEG_R);

    let leg =
      SDF.cylinderY(
        c,
        0.05,
        SHOCK_Y + 0.01,
        -0.72
      ) - 0.01;

    leg = min(
      leg,
      SDF.cylinderY(
        c,
        0.025,
        GROUND + 0.05,
        SHOCK_Y
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(0.0, y + sag, 0.6),
        vec3(0.0, y, LEG_R),
        0.018
      )
    );

    const ySeparation = 0.09;
    const xSeparation = 0.05;
    const joint = LEG_R - 0.2;

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(-xSeparation, y, 0.6),
        vec3(-xSeparation, y - ySeparation, joint),
        0.018
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(xSeparation, y, 0.6),
        vec3(xSeparation, y - ySeparation, joint),
        0.018
      )
    );

    y -= ySeparation;

    const jointWidth = xSeparation + 0.02;

    leg = min(
      leg,
      SDF.cylinderSegment(
        l,
        vec3(-jointWidth, y + sag, joint),
        vec3(jointWidth, y + sag, joint),
        0.05
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(xSeparation, y + sag, joint),
        vec3(xSeparation, y, LEG_R),
        0.012
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(-xSeparation, y + sag, joint),
        vec3(-xSeparation, y, LEG_R),
        0.012
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(xSeparation, y + sag, joint),
        vec3(xSeparation, y, 0.2),
        0.012
      )
    );

    leg = min(
      leg,
      SDF.capsule(
        l,
        vec3(-xSeparation, y + sag, joint),
        vec3(-xSeparation, y, 0.2),
        0.012
      )
    );

    let result = vec2(leg, 5.0);

    result = SDF.union(
      result,
      vec2(
        SDF.coneY(
          c,
          0.094,
          0.024,
          GROUND + 0.006,
          GROUND + 0.064
        ) - 0.006,
        6.0
      )
    );

    result = SDF.union(
      result,
      vec2(this.flap(l), 10.0)
    );

    return result;
  }

  map(p: vec3): vec2 {
    const bound =
      length(p - vec3(0.0, -0.3, 0.0)) - 1.6;

    if (bound > 0.25) {
      return vec2(bound, 0.0);
    }

    const radius = length(p);
    const longitude = atan(p.x, p.z);
    const horizontalRadius = length(p.xz);

    const legFrame = SDF.polarY(
      longitude,
      horizontalRadius,
      p.y,
      this.legCount,
      LEG_LON
    );

    const l = legFrame.point;

    const bay = max(
      this.flapOutline(l),
      1.0 - FLAP_T - BAY_DEPTH - radius
    );

    let result =
      radius - 1.0 > -bay
        ? vec2(radius - 1.0, 0.0)
        : vec2(-bay, 11.0);

    if (BELLY_Y - p.y > result.x) {
      result = vec2(BELLY_Y - p.y, 12.0);
    }

    result = SDF.union(
      result,
      vec2(
        max(
          radius - 1.022,
          abs(p.y - RING_Y) - RING_H
        ),
        1.0
      )
    );

    const door =
      SDF.arch(
        vec2(longitude * horizontalRadius, p.y),
        DOOR_HW,
        DOOR_Y0,
        DOOR_Y1
      );

    result = SDF.union(
      result,
      vec2(
        max(radius - 1.0 - DOOR_T, door),
        4.0
      )
    );

    const windowFrame = SDF.polarY(
      longitude,
      horizontalRadius,
      p.y,
      WIN_N,
      0.0
    );

    if (abs(windowFrame.index) > 0.5) {
      const center = vec3(
        0.0,
        WIN_Y,
        sqrt(1.0 - WIN_Y * WIN_Y)
      );

      const w = windowFrame.point - center;
      const h = dot(w, center);
      const glassRadius =
        (WIN_A * WIN_A + WIN_BULGE * WIN_BULGE) /
        (2.0 * WIN_BULGE);

      result = SDF.union(
        result,
        vec2(
          length(
            windowFrame.point -
            center * (1.0 + WIN_BULGE - glassRadius)
          ) - glassRadius,
          2.0
        )
      );

      result = SDF.union(
        result,
        vec2(
          length(
            vec2(
              length(w - h * center) - 0.114,
              h
            )
          ) - 0.017,
          3.0
        )
      );
    }

    result = SDF.union(
      result,
      this.mapLeg(l, result.x)
    );

    const bellyPoint =
      p + vec3(0.0, BELLY_EXT, 0.0);

    result = SDF.union(
      result,
      vec2(
        SDF.cutSphereBelow(
          bellyPoint,
          1.0,
          BELLY_Y
        ),
        bellyPoint.y - BELLY_Y > length(bellyPoint) - 1.0
          ? 12.0
          : 0.0
      )
    );

    result = SDF.union(
      result,
      vec2(
        SDF.cylinderY(
          p,
          SHAFT_R,
          BELLY_Y - BELLY_EXT - 0.01,
          BELLY_Y + 0.05
        ),
        7.0
      )
    );

    return result;
  }
}

// ---------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------

class NamekTree {
  position: vec2;
  height: f32;
  radius: f32;

  constructor(position: vec2, height: f32, radius: f32) {
    this.position = position;
    this.height = height;
    this.radius = radius;
  }

  map(p: vec3): vec2 {
    const q =
      p -
      vec3(
        this.position.x,
        GROUND,
        this.position.y
      );

    const bound =
      length(
        q - vec3(0.0, 0.5 * this.height, 0.0)
      ) -
      0.5 * this.height -
      this.radius -
      0.1;

    if (bound > 0.2) {
      return vec2(bound, 8.0);
    }

    const taper =
      mix(
        0.018,
        0.012,
        clamp(q.y / this.height, 0.0, 1.0)
      );

    const trunk =
      length(
        vec2(
          length(q.xz),
          q.y - clamp(q.y, -0.2, this.height)
        )
      ) -
      taper;

    const canopyCenter =
      q -
      vec3(0.0, this.height, 0.0);

    const normal =
      canopyCenter /
      (length(canopyCenter) + 1e-4);

    const bump =
      sin(9.0 * normal.x + 1.0) *
      sin(9.0 * normal.y + 2.0) *
      sin(9.0 * normal.z + 3.0);

    const leaves =
      (
        length(canopyCenter) -
        this.radius * (1.0 + 0.07 * bump)
      ) *
      0.8;

    return SDF.union(
      vec2(trunk, 8.0),
      vec2(leaves, 9.0)
    );
  }

  shadowRadius(): f32 {
    return 0.5 * this.height + this.radius + 0.1;
  }

  shadowCenter(): vec3 {
    return vec3(
      this.position.x,
      GROUND + 0.5 * this.height,
      this.position.y
    );
  }
}

class NamekTrees {
  first: NamekTree;
  second: NamekTree;

  constructor() {
    this.first = new NamekTree(
      vec2(1.86, 0.83),
      0.65,
      0.15
    );

    this.second = new NamekTree(
      vec2(-5.9, -4.4),
      1.9,
      0.38
    );
  }

  map(p: vec3): vec2 {
    let result = this.first.map(p);
    result = SDF.union(result, this.second.map(p));
    return result;
  }

  nearest(p: vec3): NamekTree {
    const firstDistance =
      length(p.xz - this.first.position);

    const secondDistance =
      length(p.xz - this.second.position);

    return firstDistance < secondDistance
      ? this.first
      : this.second;
  }

  casterExit(ro: vec3, rd: vec3, current: f32): f32 {
    const firstExit = this.sphereExit(
      ro,
      rd,
      this.first.shadowCenter(),
      this.first.shadowRadius()
    );

    const secondExit = this.sphereExit(
      ro,
      rd,
      this.second.shadowCenter(),
      this.second.shadowRadius()
    );

    return max(current, max(firstExit, secondExit));
  }

  private sphereExit(
    ro: vec3,
    rd: vec3,
    center: vec3,
    radius: f32
  ): f32 {
    const oc = ro - center;
    const b = dot(oc, rd);
    const h =
      b * b -
      dot(oc, oc) +
      radius * radius;

    return h > 0.0
      ? -b + sqrt(h)
      : 0.0;
  }
}

// ---------------------------------------------------------------------
// Ship surface details
// ---------------------------------------------------------------------

class ShipDetails {
  private ship: Ship;
  private trees: NamekTrees;

  constructor(ship: Ship, trees: NamekTrees) {
    this.ship = ship;
    this.trees = trees;
  }

  private tickRow(
    q: vec2,
    seed: vec2,
    n: i32,
    gap: f32,
    len: f32,
    bend: f32,
    curl: f32,
    spread: f32,
    lw: f32
  ): f32 {
    const mid = 0.5 * f32(n - 1);
    const radius = 2.0 * mid * gap / PI;
    const bendSign = bend < 0.0 ? -1.0 : 1.0;

    let distance = 1e9;

    for (let k = 0; k < 9; k++) {
      if (k >= n) {
        break;
      }

      const fk = (f32(k) - mid) / mid;

      const h = vec4(
        Noise.hash12(seed + f32(k) * 3.1 + 51.0),
        Noise.hash12(seed + f32(k) * 5.7 + 63.0),
        Noise.hash12(seed + f32(k) * 2.3 + 77.0),
        Noise.hash12(seed + f32(k) * 4.9 + 89.0)
      );

      let base = vec2(
        gap * (f32(k) - mid),
        bend * fk * fk + max(-bend, 0.0)
      );

      base = mix(
        base,
        radius *
          vec2(
            sin(0.5 * PI * fk),
            bendSign * (1.0 - cos(0.5 * PI * fk))
          ),
        curl
      );

      base += vec2(
        0.4 * gap * (h.x - 0.5),
        0.35 * len * h.y
      );
      const bladeLength =
        len *
        (1.0 - spread * Noise.hash12(seed + f32(k) * 6.1 + 97.0));

      const angle = 0.5 * (h.z - 0.5);

      distance = min(
        distance,
        SDF.segment(
          q,
          base,
          base +
            bladeLength *
            vec2(
              sin(angle),
              cos(angle)
            )
        ) -
        (0.5 + h.w) * lw
      );
    }

    return distance;
  }

  scuffInk(
    p: vec3,
    t: f32,
    lineA: f32,
    aa: f32
  ): f32 {
    const cellA =
      max(
        sqrt(0.6 / SCUFFS),
        0.12
      );

    const fill =
      SCUFFS *
      cellA *
      cellA;

    const normal = normalize(p);

    const lat = asin(clamp(normal.y, -1.0, 1.0));
    const lon = atan(normal.x, normal.z);

    const lw = 0.2 * lineA * t;

    let distance = 1e9;

    for (let j = -1; j <= 1; j++) {
      const ring = floor(lat / cellA) + f32(j);
      const ringCells =
        max(
          1.0,
          floor(
            TAU *
            cos((ring + 0.5) * cellA) /
            cellA
          )
        );

      const deltaAngle = TAU / ringCells;

      for (let i = -1; i <= 1; i++) {
        const cell = vec2(
          mod(
            floor(lon / deltaAngle) + f32(i),
            ringCells
          ),
          ring
        );

        if (Noise.hash12(cell * 1.17 + 3.9) > fill) {
          continue;
        }

        const g = vec4(
          Noise.hash12(cell + 7.3),
          Noise.hash12(cell + 19.1),
          Noise.hash12(cell + 23.9),
          Noise.hash12(cell + 37.3)
        );

        const cellLat =
          (ring + 0.25 + 0.5 * g.x) * cellA;

        const cellLon =
          (cell.x + 0.25 + 0.5 * g.y) * deltaAngle;

        const center = vec3(
          cos(cellLat) * sin(cellLon),
          sin(cellLat),
          cos(cellLat) * cos(cellLon)
        );

        const east = vec3(
          cos(cellLon),
          0.0,
          -sin(cellLon)
        );

        const local = SDF.rotate(
          vec2(
            dot(normal - center, east),
            dot(
              normal - center,
              cross(center, east)
            )
          ),
          2.4 * (g.z - 0.5)
        );

        if (dot(local, local) > 0.0225) {
          continue;
        }

        const hatchTest =
          SDF.arch(
            vec2(
              atan(center.x, center.z) * length(center.xz),
              center.y
            ),
            DOOR_HW,
            DOOR_Y0,
            DOOR_Y1
          );

        if (hatchTest < 0.15) {
          continue;
        }

        const h = vec4(
          Noise.hash12(cell + 41.7),
          Noise.hash12(cell + 53.3),
          Noise.hash12(cell + 67.1),
          Noise.hash12(cell + 79.9)
        );

        const count = 2 + i32(7.0 * g.w);
        const gap = 0.016 * (0.75 + 0.5 * h.x);
        const len = 0.001 + 0.044 * h.y * h.y;
        const bend =
          0.6 *
          gap *
          0.5 *
          f32(count - 1) *
          (2.0 * h.z - 1.0);
        const curl = step(0.85, h.w);

        distance = min(
          distance,
          this.tickRow(
            local,
            cell + 101.0,
            count,
            gap,
            len,
            bend,
            curl,
            0.7,
            lw
          )
        );
      }
    }

    return 1.0 - smoothstep(-aa, aa, distance);
  }

  hatchedSheen(
    normal: vec3,
    viewRight: vec3,
    viewUp: vec3,
    aa: f32
  ): f32 {
    const sheenCenter =
      0.6 * viewUp -
      0.8 * viewRight;

    const c0 =
      cos(
        SHEEN_R +
        0.1 *
        (
          Noise.value(
            7.0 *
            vec2(
              dot(normal, viewRight),
              dot(normal, viewUp)
            )
          ) -
          0.5
        )
      );

    const rho = max(length(normal.xz), 1e-4);
    const hH = length(sheenCenter.xz);
    const m = normal.y * sheenCenter.y;
    const w = rho * hH;
    const angle =
      acos(
        clamp(
          dot(normal.xz, sheenCenter.xz) / w,
          -1.0,
          1.0
        )
      );

    const q = (c0 - m) / w;

    let e = 0.0;
    let de = 0.0;

    if (abs(q) < 1.0) {
      const lit = acos(q);

      e = rho * (lit - angle);

      de =
        -normal.y * (lit - angle) -
        (
          c0 * normal.y -
          sheenCenter.y
        ) /
        (
          w *
          max(
            sqrt(1.0 - q * q),
            0.05
          )
        );
    } else {
      const hm =
        m +
        sign(q) * w;

      const gap =
        abs(c0 - hm) /
        sqrt(
          max(
            1.0 - hm * hm,
            1e-4
          )
        );

      const arc =
        q > 0.0
          ? angle
          : PI - angle;

      e =
        -sign(q) *
        (gap + rho * arc);

      de =
        sign(q) *
        normal.y *
        arc;
    }

    const s =
      asin(
        clamp(normal.y, -1.0, 1.0)
      ) /
      HATCH_W;

    const c1 = floor(s + 0.5);
    const u1 = s - c1;

    const c2 = floor(s);
    const u2 = s - c2 - 0.5;

    const fit =
      min(
        1.0,
        1.25 *
        rho /
        max(HATCH_L, HATCH_D)
      );

    const lightLength =
      fit *
      HATCH_L *
      (
        0.15 +
        0.85 *
        Noise.hash12(vec2(c1, 3.1))
      );

    const darkLength =
      fit *
      HATCH_D *
      (
        0.15 +
        0.85 *
        Noise.hash12(vec2(c2, 7.7))
      );

    const z =
      e +
      lightLength * (1.0 - 2.0 * abs(u1)) -
      darkLength * (1.0 - 2.0 * abs(u2));

    const dz =
      de +
      2.0 *
      (
        darkLength * sign(u2) -
        lightLength * sign(u1)
      ) /
      HATCH_W;

    return smoothstep(
      -aa,
      aa,
      z / sqrt(1.0 + dz * dz)
    );
  }
}

// ---------------------------------------------------------------------
// Lettering
// ---------------------------------------------------------------------

class Lettering {
  strokeWidth: f32;

  constructor() {
    this.strokeWidth = SW;
  }

  rect(
    p: vec2,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32
  ): f32 {
    return SDF.box2(
      p - 0.5 * vec2(x0 + x1, y0 + y1),
      0.5 * vec2(x1 - x0, y1 - y0)
    );
  }

  stroke(p: vec2, a: vec2, b: vec2): f32 {
    return SDF.segment(p, a, b) - this.strokeWidth;
  }

  arc(
    p: vec2,
    center: vec2,
    radius: f32,
    start: f32,
    end: f32
  ): f32 {
    const q = p - center;

    if (mod(atan(q.y, q.x) - start, TAU) < end - start) {
      return abs(length(q) - radius) - this.strokeWidth;
    }

    return min(
      length(q - radius * vec2(cos(start), sin(start))),
      length(q - radius * vec2(cos(end), sin(end)))
    ) - this.strokeWidth;
  }

  glyph(p: vec2, glyphId: i32): f32 {
    let d = 0.0;

    if (glyphId === 0) {
      d = min(
        this.arc(
          p,
          vec2(0.0, 0.2),
          0.215,
          0.5,
          PI
        ),
        this.arc(
          p,
          vec2(0.0, -0.2),
          0.215,
          PI,
          TAU - 0.5
        )
      );

      d = min(
        d,
        this.rect(
          p,
          -0.3,
          -0.2,
          -0.13,
          0.2
        )
      );
    } else if (glyphId === 1) {
      d = min(
        this.stroke(
          p,
          vec2(-0.245, -0.6),
          vec2(-0.01, 0.6)
        ),
        this.stroke(
          p,
          vec2(0.245, -0.6),
          vec2(0.01, 0.6)
        )
      );

      d = min(
        d,
        this.rect(
          p,
          -0.16,
          -0.22,
          0.16,
          -0.06
        )
      );
    } else if (glyphId === 2 || glyphId === 8) {
      d = min(
        this.rect(
          p,
          -0.28,
          -0.5,
          -0.11,
          0.5
        ),
        this.rect(
          p,
          -0.28,
          0.33,
          0.0,
          0.5
        )
      );

      d = min(
        d,
        this.rect(
          p,
          -0.28,
          -0.08,
          0.0,
          0.09
        )
      );

      d = min(
        d,
        this.arc(
          p,
          vec2(0.0, 0.205),
          0.21,
          -0.5 * PI,
          0.5 * PI
        )
      );

      if (glyphId === 8) {
        d = min(
          d,
          this.stroke(
            p,
            vec2(0.0, 0.0),
            vec2(0.24, -0.6)
          )
        );
      }
    } else if (glyphId === 3) {
      d = min(
        this.arc(
          p,
          vec2(0.0, 0.2075),
          0.2075,
          0.4,
          1.5 * PI
        ),
        this.arc(
          p,
          vec2(0.0, -0.2075),
          0.2075,
          PI + 0.4,
          2.5 * PI
        )
      );
    } else if (glyphId === 4) {
      d = min(
        this.rect(
          p,
          -0.3,
          -0.2,
          -0.13,
          0.5
        ),
        this.rect(
          p,
          0.13,
          -0.2,
          0.3,
          0.5
        )
      );

      d = min(
        d,
        this.arc(
          p,
          vec2(0.0, -0.2),
          0.215,
          PI,
          TAU
        )
      );
    } else if (glyphId === 5) {
      d = min(
        this.rect(
          p,
          -0.27,
          -0.5,
          -0.10,
          0.5
        ),
        this.rect(
          p,
          -0.27,
          -0.5,
          0.26,
          -0.33
        )
      );
    } else if (glyphId === 6) {
      d = min(
        this.rect(
          p,
          -0.27,
          -0.5,
          -0.10,
          0.5
        ),
        this.rect(
          p,
          -0.27,
          0.33,
          0.26,
          0.5
        )
      );

      d = min(
        d,
        min(
          this.rect(
            p,
            -0.27,
            -0.085,
            0.2,
            0.085
          ),
          this.rect(
            p,
            -0.27,
            -0.5,
            0.26,
            -0.33
          )
        )
      );
    } else if (glyphId === 7) {
      d =
        abs(
          length(
            vec2(
              p.x,
              p.y - clamp(p.y, -0.2, 0.2)
            )
          ) -
          0.215
        ) - this.strokeWidth;
    } else {
      d =
        length(
          p - vec2(-0.26, -0.4)
        ) -
        0.1;
    }

    return max(d, abs(p.y) - 0.5);
  }

  render(p: vec3, aa: f32): f32 {
    const longitude = atan(p.x, p.z);
    const latitude =
      asin(
        clamp(
          p.y / length(p),
          -1.0,
          1.0
        )
      );

    let ink = 0.0;

    let caps = vec2(
      (longitude - CAPS_LON) * cos(CAPS_LAT),
      latitude - CAPS_LAT
    ) / CAPS_H;

    let index =
      floor(caps.x / ADV + 3.5);

    if (
      abs(caps.y) < 0.6 &&
      index >= 0.0 &&
      index < 7.0
    ) {
      ink =
        1.0 -
        smoothstep(
          -aa,
          aa,
          CAPS_H *
          this.glyph(
            vec2(
              caps.x - (index - 3.0) * ADV,
              caps.y
            ),
            i32(index)
          )
        );
    }

    let corp = vec2(
      (longitude - CORP_LON) * cos(CORP_LAT),
      latitude - CORP_LAT
    ) / CORP_H;

    index =
      floor(corp.x / ADV + 2.5);

    if (
      abs(corp.y) < 0.6 &&
      index >= 0.0 &&
      index < 5.0
    ) {
      const glyphId: i32 =
        index < 0.5
          ? 0
          : index < 1.5
            ? 7
            : index < 2.5
              ? 8
              : index < 3.5
                ? 2
                : 9;

      ink = max(
        ink,
        1.0 -
        smoothstep(
          -aa,
          aa,
          CORP_H *
          this.glyph(
            vec2(
              corp.x - (index - 2.0) * ADV,
              corp.y
            ),
            glyphId
          )
        )
      );
    }

    return ink;
  }
}

// ---------------------------------------------------------------------
// Cel shading and ship material
// ---------------------------------------------------------------------

class ShipMaterial {
  static celShadow(ro: vec3, rd: vec3, ship: Ship, trees: NamekTrees): f32 {
    const pen = 0.4;

    let tmax =
      ShipMaterial.sphereExit(
        ro,
        rd,
        vec3(0.0, -0.3, 0.0),
        1.6 + pen
      );

    tmax =
      trees.casterExit(
        ro,
        rd,
        tmax
      );

    tmax = min(tmax, 9.0);

    if (tmax < 0.02) {
      return 1.0;
    }

    let result = 1.0;
    let t = 0.02;

    for (let i = 0; i < 64; i++) {
      const h =
        ShipMaterial.mapCel(ro + rd * t, ship, trees).x;

      result =
        min(
          result,
          10.0 * h / t
        );

      t += clamp(h, 0.01, 0.3);

      if (result < 0.0 || t > tmax) {
        break;
      }
    }

    return smoothstep(0.25, 0.4, result);
  }

  static shade(
    p: vec3,
    n: vec3,
    rd: vec3,
    id: f32,
    t: f32,
    pixA: f32,
    lineA: f32,
    ship: Ship,
    trees: NamekTrees,
    details: ShipDetails,
    lettering: Lettering
  ): vec3 {
    const aa =
      0.7 *
      pixA *
      t /
      max(dot(n, -rd), 0.3);

    const lw =
      0.5 *
      lineA *
      t;

    let lightAmount =
      smoothstep(
        -0.02,
        0.02,
        dot(n, LIG)
      );

    if (lightAmount > 0.0) {
      lightAmount *=
        ShipMaterial.celShadow(
          p + n * 0.004,
          LIG,
          ship,
          trees
        );
    }

    const lit =
      mix(
        SHADE,
        vec3(1.0),
        lightAmount
      );

    let col = vec3(0.0);

    if (id < 0.5) {
      const cap =
        smoothstep(
          -aa,
          aa,
          p.y - (RING_Y + RING_H)
        );

      const band =
        smoothstep(
          -aa,
          aa,
          p.y - BAND_BOT
        ) -
        smoothstep(
          -aa,
          aa,
          p.y - BAND_TOP
        );

      const viewDirection =
        normalize(t * rd - p);

      const viewRight =
        normalize(
          cross(
            viewDirection,
            vec3(0.0, 1.0, 0.0)
          )
        );

      const sheen =
        details.hatchedSheen(
          n,
          viewRight,
          cross(viewRight, viewDirection),
          aa
        );

      const blackPaint =
        mix(
          BLACK,
          BLACK_HI,
          sheen
        ) *
        mix(
          0.7,
          1.0,
          lightAmount
        );

      const dark =
        max(cap, band);

      col =
        mix(
          HULL * lit,
          blackPaint,
          dark
        );

      col =
        mix(
          col,
          INK,
          max(
            lettering.render(p, aa),
            (1.0 - dark) *
            details.scuffInk(
              p,
              t,
              lineA,
              aa
            )
          )
        );
    } else if (id < 1.5) {
      const dy = abs(p.y - RING_Y);

      col = HULL * lit;

      let ink =
        1.0 -
        smoothstep(
          0.6 * lw - aa,
          0.6 * lw + aa,
          dy
        );

      ink =
        max(
          ink,
          smoothstep(
            RING_H - 1.3 * lw - aa,
            RING_H - 1.3 * lw + aa,
            dy
          )
        );

      col =
        mix(
          col,
          INK,
          ink
        );
    } else if (id < 2.5) {
      const windowFrame =
        SDF.polarY(
          atan(p.x, p.z),
          length(p.xz),
          p.y,
          WIN_N,
          0.0
        );

      const q = windowFrame.point;

      const center = vec3(
        0.0,
        WIN_Y,
        sqrt(1.0 - WIN_Y * WIN_Y)
      );

      const w = vec2(
        q.x,
        dot(
          q - center,
          normalize(
            vec3(0.0, 1.0, 0.0) -
            center * WIN_Y
          )
        )
      );

      const radius = length(w);

      col =
        mix(
          GLASS_HI,
          GLASS_LO,
          smoothstep(
            0.1 - aa,
            0.1 + aa,
            length(
              w -
              vec2(-0.035, 0.04)
            )
          )
        );

      let streak =
        abs(radius - 0.062) -
        0.011;

      streak =
        max(
          streak,
          abs(
            atan(w.y, w.x) - 2.25
          ) *
          radius -
          0.035
        );

      col =
        mix(
          col,
          vec3(0.93, 0.98, 1.0),
          1.0 -
          smoothstep(
            -aa,
            aa,
            streak
          )
        );

      col *=
        mix(
          0.8,
          1.0,
          lightAmount
        );
    } else if (id < 3.5) {
      col = METAL * lit;
    } else if (id < 4.5) {
      const doorDistance =
        SDF.arch(
          vec2(
            atan(p.x, p.z) * length(p.xz),
            p.y
          ),
          DOOR_HW,
          DOOR_Y0,
          DOOR_Y1
        );

      const top =
        length(p) -
        1.0 -
        DOOR_T;

      col = HULL * lit;

      let ink =
        1.0 -
        smoothstep(
          lw - aa,
          lw + aa,
          length(
            vec2(              doorDistance,
              top
            )
          )
        );

      ink =
        max(
          ink,
          1.0 -
          smoothstep(
            0.7 * lw - aa,
            0.7 * lw + aa,
            length(
              vec2(
                doorDistance,
                top + DOOR_T
              )
            )
          )
        );

      col =
        mix(
          col,
          INK,
          ink
        );
    } else if (id < 7.5) {
      col =
        METAL *
        mix(
          vec3(0.50, 0.60, 0.78),
          vec3(1.0),
          lightAmount
        );
    } else if (id < 8.5) {
      col = TRUNK * lit;
    } else if (id < 9.5) {
      const tree =
        trees.nearest(p);

      const normal =
        normalize(
          p -
          vec3(
            tree.position.x,
            GROUND + tree.height,
            tree.position.y
          )
        );

      const k =
        dot(
          normalize(normal + 0.5 * n),
          LIG
        ) +
        0.15 *
        (
          Noise.value(
            normal.xy * 9.0 +
            normal.z * 5.0
          ) -
          0.5
        );

      col =
        mix(
          LEAF * vec3(0.72, 0.78, 0.9),
          LEAF,
          smoothstep(0.0, 0.04, k) *
          ShipMaterial.celShadow(
            p + n * 0.01,
            LIG
          )
        );

      col =
        mix(
          col,
          LEAF_HI,
          smoothstep(
            0.55,
            0.59,
            k
          )
        );
    } else if (id < 10.5) {
      const legFrame =
        SDF.polarY(
          atan(p.x, p.z),
          length(p.xz),
          p.y,
          4.0,
          LEG_LON
        );

      const local =
        ship.flapHome(
          legFrame.point
        );

      const rotated =
        SDF.rotate(
          local.xz,
          -LEG_LON -
          0.5 * PI *
          legFrame.index
        );

      col =
        mix(
          HULL * lit,
          INK,
          details.scuffInk(
            vec3(
              rotated.x,
              local.y,
              rotated.y
            ),
            t,
            lineA,
            aa
          )
        );
    } else if (id < 11.5) {
      col =
        mix(
          vec3(0.0),
          HULL * lit,
          smoothstep(
            -aa,
            aa,
            length(p) -
            1.0 +
            FLAP_T
          )
        );
    } else {
      col =
        mix(
          vec3(0.0),
          HULL * lit,
          smoothstep(
            -aa,
            aa,
            length(p.xz) -
            BELLY_R +
            FLAP_T
          )
        );
    }

    return col;
  }

  static sphereExit(
    ro: vec3,
    rd: vec3,
    center: vec3,
    radius: f32
  ): f32 {
    const oc = ro - center;
    const b = dot(oc, rd);
    const h =
      b * b -
      dot(oc, oc) +
      radius * radius;

    return h > 0.0
      ? -b + sqrt(h)
      : 0.0;
  }

  static mapCel(p: vec3, ship: Ship, trees: NamekTrees): vec2 {
    let result = ship.map(p);
    result = SDF.union(result, this.trees.map(p));
    return result;
  }
}

// ---------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------

class Terrain {
  static coast(x: vec2): f32 {
    return (
      length(x) -
      COAST_R -
      7.0 *
      (
        Noise.fbm(
          x * 0.09 + 7.0
        ) -
        0.5
      )
    );
  }

  static mesaField(x: vec2): f32 {
    let field =
      Noise.fbm(
        x * 0.05 +
        vec2(4.3, -2.1)
      ) +
      0.04 *
      Noise.value(
        x * 0.8
      );

    field -=
      0.4 *
      (
        1.0 -
        smoothstep(
          MESA_R,
          30.0,
          length(x)
        )
      );

    field +=
      0.25 *
      (
        1.0 -
        smoothstep(
          3.0,
          9.0,
          length(
            x -
            vec2(-21.0, -22.0)
          )
        )
      );

    return field;
  }

  static heightAt(x: vec2): f32 {
    const field = this.mesaField(x);

    return (
      GROUND +
      1.3 *
      smoothstep(
        0.63,
        0.64,
        field
      ) +
      0.55 *
      smoothstep(
        0.71,
        0.72,
        field
      )
    );
  }

  static normal(x: vec2, t: f32): vec3 {
    const stepSize =
      0.02 +
      0.002 * t;

    let gradient = vec2(0.0);

    for (let i = 0; i < 4; i++) {
      gradient -=
        CROSS[i] *
        this.heightAt(
          x +
          stepSize *
          CROSS[i]
        );
    }

    return normalize(
      vec3(
        gradient.x,
        2.0 * stepSize,
        gradient.y
      )
    );
  }

  static march(
    ro: vec3,
    rd: vec3,
    tmax: f32
  ): f32 {
    const ceil = GROUND + 1.9;

    const planeT =
      rd.y < 0.0
        ? (GROUND - ro.y) / rd.y
        : 1e10;

    const a =
      max(
        dot(rd.xz, rd.xz),
        1e-6
      );

    const b =
      dot(ro.xz, rd.xz);

    const c =
      dot(ro.xz, ro.xz) -
      MESA_R * MESA_R;

    let t =
      (
        -b +
        sqrt(
          max(
            b * b - a * c,
            0.0
          )
        )
      ) / a;

    const end =
      min(
        planeT,
        tmax
      );

    let previousT = t;

    for (let i = 0; i < 200; i++) {
      if (t > end) {
        break;
      }

      const p =
        ro +
        rd * t;

      if (
        p.y > ceil &&
        rd.y > 0.0
      ) {
        break;
      }

      const clearance =
        p.y -
        this.heightAt(p.xz);

      if (clearance < 0.0) {
        for (let j = 0; j < 6; j++) {
          const middle =
            0.5 *
            (previousT + t);

          const q =
            ro +
            rd * middle;

          if (
            q.y <
            this.heightAt(q.xz)
          ) {
            t = middle;
          } else {
            previousT = middle;
          }
        }

        return (
          0.5 *
          (previousT + t)
        );
      }

      previousT = t;

      t +=
        max(
          0.3 * clearance,
          0.02 +
          0.015 * t
        );
    }

    return planeT < tmax
      ? planeT
      : -1.0;
  }

  static groundWarp(x: vec2): vec2 {
    const q = vec2(
      Noise.fbm(x * 0.8 + 2.0),
      Noise.fbm(x * 0.8 + 8.3)
    );

    return (
      x +
      1.2 *
      (
        vec2(
          Noise.fbm(
            x * 1.6 +
            3.0 * q +
            1.7
          ),
          Noise.fbm(
            x * 1.6 +
            3.0 * q +
            9.2
          )
        ) -
        0.5
      )
    );
  }

  static dirtField(xw: vec2): f32 {
    return (
      Noise.fbm(
        xw * 0.7 +
        vec2(-13.7, 31.9)
      ) -
      0.62
    );
  }

  static grassInk(
    x: vec2,
    ro: vec3,
    t: f32,
    pixA: f32,
    lineA: f32
  ): f32 {
    const cellSize = 0.4;
    const tickHeight = 0.015;
    const gap = 0.02;

    if (t > 12.0) {
      return 0.0;
    }

    const eye = ro.y - GROUND;
    const view = x - ro.xz;
    const distanceToPoint = length(view);

    const forward =
      view /
      distanceToPoint;

    const side =
      vec2(
        -forward.y,
        forward.x
      );

    const reach =
      distanceToPoint *
      2.2 *
      tickHeight /
      eye;

    const centerCell =
      floor(
        (x -
          0.5 *
          reach *
          forward) /
        cellSize
      );

    let ink = 0.0;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cell =
          centerCell +
          vec2(
            f32(i),
            f32(j)
          );

        if (
          Noise.hash12(
            cell * 1.31 + 5.7
          ) > 0.55
        ) {
          continue;
        }

        const center =
          (
            cell +
            0.2 +
            0.6 *
            vec2(
              Noise.hash12(cell + 7.3),
              Noise.hash12(cell + 19.1)
            )
          ) *
          cellSize;

        const alongRay =
          dot(
            center - ro.xz,
            forward
          );

        if (
          alongRay > distanceToPoint ||
          alongRay <
            distanceToPoint - reach
        ) {
          continue;
        }

        const local =
          vec2(
            dot(
              ro.xz - center,
              side
            ),
            eye *
            (
              1.0 -
              alongRay /
              distanceToPoint
            )
          );

        if (abs(local.x) > 5.0 * gap) {
          continue;
        }

        if (
          this.dirtField(
            this.groundWarp(center)
          ) > -0.04 ||
          this.coast(center) > -0.8
        ) {
          continue;
        }

        const count =
          3 +
          i32(
            5.0 *
            Noise.hash12(
              cell + 31.7
            )
          );

        const bend =
          0.7 *
          tickHeight *
          (
            2.0 *
            Noise.hash12(
              cell + 43.1
            ) -
            1.0
          );

        const rowT =
          t *
          alongRay /
          distanceToPoint;

        const lw =
          0.14 *
          lineA *
          rowT;

        const aa =
          0.7 *
          pixA *
          rowT;

        const distance =
          this.tickRow(
            local,
            cell,
            count,
            gap,
            tickHeight,
            bend,
            0.0,
            0.0,
            lw
          );

        ink =
          max(
            ink,
            1.0 -
            smoothstep(
              -aa,
              aa,
              distance
            )
          );
      }
    }

    return (
      ink *
      (
        1.0 -
        smoothstep(
          8.0,
          12.0,
          t
        )
      )
    );
  }

  static tickRow(
    q: vec2,
    seed: vec2,
    n: i32,
    gap: f32,
    len: f32,
    bend: f32,
    curl: f32,
    spread: f32,
    lw: f32
  ): f32 {
    const mid =
      0.5 *
      f32(n - 1);

    const radius =
      2.0 *
      mid *
      gap /
      PI;

    const signBend =
      bend < 0.0
        ? -1.0
        : 1.0;

    let distance = 1e9;

    for (let k = 0; k < 9; k++) {
      if (k >= n) {
        break;
      }

      const fk =
        (f32(k) - mid) /
        mid;

      const h = vec4(
        Noise.hash12(
          seed +
          f32(k) * 3.1 +
          51.0
        ),
        Noise.hash12(
          seed +
          f32(k) * 5.7 +
          63.0
        ),
        Noise.hash12(
          seed +
          f32(k) * 2.3 +
          77.0
        ),
        Noise.hash12(
          seed +
          f32(k) * 4.9 +
          89.0
        )
      );

      let base = vec2(
        gap *
        (f32(k) - mid),
        bend *
        fk *
        fk +
        max(-bend, 0.0)
      );

      base =
        mix(
          base,
          radius *
          vec2(
            sin(0.5 * PI * fk),
            signBend *
            (
              1.0 -
              cos(0.5 * PI * fk)
            )
          ),
          curl
        );

      base +=
        vec2(
          0.4 *
          gap *
          (h.x - 0.5),
          0.35 *
          len *
          h.y
        );

      const bladeLength =
        len *
        (
          1.0 -
          spread *
          Noise.hash12(
            seed +
            f32(k) * 6.1 +
            97.0
          )
        );

      const angle =
        0.5 *
        (h.z - 0.5);

      distance =
        min(
          distance,
          SDF.segment(
            q,
            base,
            base +
            bladeLength *
            vec2(
              sin(angle),
              cos(angle)
            )
          ) -
          (0.5 + h.w) *
          lw
        );
    }

    return distance;
  }

  static brush(
    a: vec2,
    m: vec2,
    b: vec2,
    width: f32,
    taper: f32
  ): f32 {
    const ma = m - a;
    const bm = b - m;

    const h1 =
      clamp(
        -dot(a, ma) /
        max(
          dot(ma, ma),
          1e-6
        ),
        0.0,
        1.0
      );

    const h2 =
      clamp(
        -dot(m, bm) /
        max(
          dot(bm, bm),
          1e-6
        ),
        0.0,
        1.0
      );

    const d1 =
      length(
        a +
        ma * h1
      );

    const d2 =
      length(
        m +
        bm * h2
      );

    const along =
      d1 < d2
        ? 0.5 * h1
        : 0.5 + 0.5 * h2;

    return (
      min(d1, d2) -
      width *
      mix(
        1.0,
        0.3 +
        0.7 *
        sqrt(
          sin(PI * along)
        ),
        taper
      )
    );
  }

  static dirtStrokes(
    x: vec2,
    eye: vec2,
    jacobian: mat2,
    lw: f32
  ): f32 {
    const cellSize = 0.5;
    const centerCell = floor(x / cellSize);

    let distance = 1e9;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cell =
          centerCell +
          vec2(
            f32(i),
            f32(j)
          );

        if (
          Noise.hash12(
            cell * 1.71 + 2.3
          ) > 0.35
        ) {
          continue;
        }

        const g = vec4(
          Noise.hash12(cell + 11.3),
          Noise.hash12(cell + 23.7),
          Noise.hash12(cell + 31.1),
          Noise.hash12(cell + 47.9)
        );

        const h = vec4(
          Noise.hash12(cell + 53.1),
          Noise.hash12(cell + 61.9),
          Noise.hash12(cell + 71.3),
          Noise.hash12(cell + 83.7)
        );

        const center =
          (
            cell +
            0.25 +
            0.5 *
            g.xy
          ) *
          cellSize;

        const view =
          normalize(
            center -
            eye
          );

        const direction =
          SDF.rotate(
            vec2(
              -view.y,
              view.x
            ),
            DIRT_TILT +
            0.35 *
            (g.z - 0.5)
          );

        const centerPixels =
          jacobian *
          (center - x);

        const directionPixels =
          jacobian *
          direction;

        const directionLength =
          length(
            directionPixels
          );

        const perpendicular =
          vec2(
            -directionPixels.y,
            directionPixels.x
          ) /
          directionLength;

        const spacing =
          0.12 +
          0.025 * h.z;

        const screenSpacing =
          max(
            spacing *
            abs(
              dot(
                jacobian *
                vec2(
                  -direction.y,
                  direction.x
                ),
                perpendicular
              )
            ),
            3.2 * lw
          );

        if (
          length(centerPixels) >
          0.35 *
          directionLength +
          2.0 *
          screenSpacing +
          2.0 *
          lw
        ) {
          continue;
        }

        if (
          this.dirtField(
            this.groundWarp(center)
          ) < 0.015 ||
          this.coast(center) > -1.5
        ) {
          continue;
        }

        const count =
          2 +
          i32(
            2.2 *
            h.y *
            h.y
          );

        const shift =
          0.06 *
          (h.w - 0.5);

        const bow =
          0.2 *
          (h.x - 0.5);

        for (let k = 0; k < 4; k++) {
          if (k >= count) {
            break;
          }

          const offset =
            f32(k) -
            0.5 *
            f32(count - 1);

          const halfLength =
            0.18 *
            (
              0.3 +
              0.7 *
              Noise.hash12(
                cell +
                f32(k) * 7.3 +
                91.0
              )
            );

          const position =
            centerPixels +
            perpendicular *
            offset *
            screenSpacing +
            directionPixels *
            (              offset *
              shift +
              0.06 *
              (
                Noise.hash12(
                  cell +
                  f32(k) * 5.1 +
                  97.0
                ) -
                0.5
              )
            );

          distance =
            min(
              distance,
              this.brush(
                position -
                  directionPixels *
                  halfLength,
                position +
                  perpendicular *
                  bow *
                  halfLength *
                  directionLength,
                position +
                  directionPixels *
                  halfLength,
                0.95 * lw,
                1.0
              )
            );
        }
      }
    }

    return distance;
  }

  static dirtDots(
    x: vec2,
    eye: vec2,
    jacobian: mat2,
    lw: f32
  ): f32 {
    const cellSize = 0.16;
    const centerCell =
      floor(x / cellSize);

    const crowd =
      min(
        1.0,
        cellSize *
        cellSize *
        abs(determinant(jacobian)) /
        (
          60.0 *
          lw *
          lw
        )
      );

    let distance = 1e9;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cell =
          centerCell +
          vec2(
            f32(i),
            f32(j)
          );

        const g = vec4(
          Noise.hash12(cell + 5.9),
          Noise.hash12(cell + 17.3),
          Noise.hash12(cell + 29.5),
          Noise.hash12(cell + 43.1)
        );

        const center =
          (
            cell +
            0.1 +
            0.8 *
            g.xy
          ) *
          cellSize;

        const probability =
          0.03 +
          0.7 *
          smoothstep(
            0.5,
            0.72,
            Noise.value(
              center * 2.2 +
              71.0
            )
          );

        if (
          Noise.hash12(
            cell * 1.37 + 9.1
          ) >
          probability *
          crowd
        ) {
          continue;
        }

        const centerPixels =
          jacobian *
          (center - x);

        if (
          dot(
            centerPixels,
            centerPixels
          ) >
          16.0 *
          lw *
          lw
        ) {
          continue;
        }

        if (
          this.dirtField(
            this.groundWarp(center)
          ) < 0.03 ||
          this.coast(center) > -1.0
        ) {
          continue;
        }

        const view =
          normalize(
            center -
            eye
          );

        const direction =
          normalize(
            jacobian *
            SDF.rotate(
              vec2(
                -view.y,
                view.x
              ),
              DIRT_TILT +
              0.6 *
              (g.z - 0.5)
            )
          );

        const halfLength =
          (
            0.3 +
            1.5 *
            g.w *
            g.w
          ) *
          lw;

        const edge =
          halfLength *
          direction;

        distance =
          min(
            distance,
            this.brush(
              centerPixels - edge,
              centerPixels,
              centerPixels + edge,
              (
                1.0 +
                0.35 *
                Noise.hash12(
                  cell + 57.7
                )
              ) *
              lw,
              0.0
            )
          );
      }
    }

    return distance;
  }

  static dirtInk(
    x: vec2,
    eye: vec2,
    t: f32,
    jacobian: mat2,
    lw: f32
  ): f32 {
    if (t > 14.0) {
      return 0.0;
    }

    const distance =
      min(
        this.dirtStrokes(
          x,
          eye,
          jacobian,
          lw
        ),
        this.dirtDots(
          x,
          eye,
          jacobian,
          lw
        )
      );

    return (
      (
        1.0 -
        smoothstep(
          -0.5,
          0.5,
          distance
        )
      ) *
      (
        1.0 -
        smoothstep(
          10.0,
          14.0,
          t
        )
      )
    );
  }

  static shade(
    p: vec3,
    ro: vec3,
    t: f32,
    pixA: f32,
    lineA: f32,
    ship: Ship,
    trees: NamekTrees
  ): vec3 {
    const normal =
      length(p.xz) > MESA_R
        ? this.normal(p.xz, t)
        : vec3(0.0, 1.0, 0.0);

    const x = p.xz;
    const radius = length(x);
    const height = p.y - GROUND;

    const warped =
      this.groundWarp(x);

    let col =
      mix(
        GRASS,
        GRASS_DK,
        0.6 *
        smoothstep(
          0.55,
          0.56,
          Noise.fbm(
            warped * 1.1 + 3.0
          )
        )
      );

    let dirt = this.dirtField(warped);

    const dirtGradient =
      vec2(
        dpdx(dirt),
        dpdy(dirt)
      );

    const recede =
      smoothstep(
        0.25,
        0.6,
        abs(dirtGradient.x) /
        max(
          length(dirtGradient),
          1e-6
        )
      );

    dirt +=
      0.03 *
      (
        abs(
          Noise.value(x * 5.0) -
          0.5
        ) +
        0.5 *
        abs(
          Noise.value(x * 11.0 + 7.0) -
          0.5
        ) -
        0.35
      );

    const fieldWidth =
      max(
        length(
          vec2(
            dpdx(dirt),
            dpdy(dirt)
          )
        ),
        1e-5
      );

    const dx = dpdx(x);
    const dy = dpdy(x);
    const jacobian = mat2(dx, dy);
    const inverseJacobian = inverseMat2(
      dx.x,
      dx.y,
      dy.x,
      dy.y
    );

    const lw =
      0.5 *
      lineA /
      pixA;

    let grain =
      vec2(
        dot(x, DIRT_GRAIN),
        dot(
          x,
          vec2(
            -DIRT_GRAIN.y,
            DIRT_GRAIN.x
          )
        )
      );

    grain.y +=
      0.8 *
      Noise.fbm(
        x * 0.25 + 5.0
      ) +
      0.12 *
      Noise.value(
        x * 1.9 + 2.0
      );

    let pattern =
      0.5 +
      (
        Noise.fbm(
          vec2(
            0.45 * grain.x,
            3.0 * grain.y
          ) +
          27.0
        ) -
        0.5
      ) *
      (
        0.5 +
        Noise.value(
          x * 0.6 + 31.0
        )
      ) +
      0.7 *
      (
        Noise.value(
          vec2(
            1.2 * grain.x,
            11.0 * grain.y
          ) +
          41.0
        ) -
        0.5
      ) *
      smoothstep(
        0.35,
        0.75,
        Noise.value(
          vec2(
            0.7 * grain.x,
            1.5 * grain.y
          ) +
          13.0
        )
      );

    const dirtColor =
      mix(
        SAND,
        DIRT_DK,
        mix(
          0.36,
          0.6,
          smoothstep(
            0.25,
            0.75,
            pattern
          )
        )
      );

    col =
      mix(
        col,
        dirtColor,
        smoothstep(
          -fieldWidth,
          fieldWidth,
          dirt
        )
      );

    if (
      dirt >
      3.0 *
      fieldWidth *
      lw &&
      abs(
        determinant(jacobian)
      ) > 1e-12
    ) {
      col =
        mix(
          col,
          INK,
          smoothstep(
            3.0,
            5.0,
            dirt /
            fieldWidth /
            lw
          ) *
          this.dirtInk(
            x,
            ro.xz,
            t,
            inverseJacobian,
            lw
          )
        );
    }

    const outline =
      1.0 -
      smoothstep(
        lw - 0.5,
        lw + 0.5,
        abs(dirt) /
        fieldWidth
      );

    const dash =
      smoothstep(
        0.45,
        0.5,
        Noise.value(
          x * 16.0 + 5.0
        )
      );

    col =
      mix(
        col,
        INK,
        outline *
        mix(
          1.0,
          dash,
          recede
        )
      );

    const shoreDistance =
      this.coast(x);

    col =
      mix(
        col,
        SAND_RIM,
        smoothstep(
          -0.75,
          -0.7,
          shoreDistance
        )
      );

    col =
      mix(
        col,
        SAND,
        smoothstep(
          -0.6,
          -0.55,
          shoreDistance
        )
      );

    const fade =
      1.0 -
      smoothstep(
        20.0,
        45.0,
        t
      );

    const lap =
      0.5 +
      0.5 *
      sin(
        1.3 *
        u.time -
        6.0 *
        Noise.value(
          x * 0.4
        )
      );

    let sea =
      mix(
        SEA_SHOAL,
        SEA,
        smoothstep(
          0.9,
          1.0,
          shoreDistance
        )
      );

    const shore =
      -0.35 *
      lap;

    let foam =
      1.0 -
      smoothstep(
        shore + 0.15,
        shore + 0.2,
        shoreDistance
      );

    const mesa =
      this.mesaField(x);

    foam =
      max(
        foam,
        smoothstep(
          0.61 - 0.02 * lap,
          0.615 - 0.02 * lap,
          mesa
        )
      );

    const wave =
      Noise.value(
        vec2(
          3.0 * radius +
          3.0 * Noise.value(
            x * 0.25
          ) +
          1.2 * u.time,
          0.5
        )
      ) *
      Noise.value(
        x * 0.6 + 2.0
      );

    foam =
      max(
        foam,
        fade *
        smoothstep(
          0.5,
          0.53,
          wave
        )
      );

    sea =
      mix(
        sea,
        SEA_HI,
        foam
      );

    col =
      mix(
        col,
        sea,
        smoothstep(
          shore - 0.05,
          shore,
          shoreDistance
        ) *
        (
          1.0 -
          step(
            0.02,
            height
          )
        )
      );

    col =
      mix(
        col,
        INK,
        this.grassInk(
          x,
          ro,
          t,
          pixA,
          lineA
        )
      );

    col =
      mix(
        col,
        MESA_TOP,
        smoothstep(
          0.5,
          1.2,
          height
        )
      );

    const strataValue =
      fract(
        height * 1.3 +
        0.35 *
        Noise.value(
          x * 0.5
        )
      );

    let strata =
      strataValue < 0.45
        ? CLIFF_A
        : strataValue < 0.75
          ? CLIFF_B
          : CLIFF_C;

    strata *=
      0.8 +
      0.2 *
      Noise.value(
        vec2(
          dot(
            x,
            vec2(2.0, 1.3)
          ) *
          3.0,
          height * 0.5
        )
      );

    col =
      mix(
        col,
        strata,
        smoothstep(
          0.35,
          0.55,
          1.0 - normal.y
        )
      );

    let lightAmount =
      smoothstep(
        -0.05,
        0.2,
        dot(normal, LIG)
      );

    if (radius < 12.0) {
      lightAmount *=
        ShipMaterial.celShadow(
          p + normal * 0.02,
          LIG
        );
    }

    col *=
      mix(
        SHADE * 0.95,
        vec3(1.0),
        lightAmount
      );

    return mix(
      col,
      HAZE,
      1.0 -
      exp(-0.012 * t)
    );
  }
}

// ---------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------

class Sky {
  static color(rd: vec3): vec3 {
    const y = max(rd.y, 0.0);

    let col =
      mix(
        SKY_HZ,
        SKY_MID,
        smoothstep(
          0.0,
          0.12,
          y
        )
      );

    col =
      mix(
        col,
        SKY_TOP,
        smoothstep(
          0.08,
          0.35,
          y
        )
      );

    const cellCount = 19.0;

    const uv =
      vec2(
        atan(rd.x, rd.z) *
          (cellCount / TAU) +
          0.004 * u.time,
        y * 26.0
      );

    const clouds =
      Noise.fbmWrapX(
        uv *
        vec2(1.0, 0.8) +
        vec2(0.0, 3.0),
        cellCount
      );

    const cloudMask =
      smoothstep(
        0.56,
        0.60,
        clouds
      ) *
      smoothstep(
        0.015,
        0.05,
        y
      ) *
      (
        1.0 -
        smoothstep(
          0.18,
          0.35,
          y
        )
      );

    col =
      mix(
        col,
        CLOUD,
        0.75 *
        cloudMask
      );

    return col;
  }
}

// ---------------------------------------------------------------------
// Full scene renderer
// ---------------------------------------------------------------------

class NamekScene {
  private ship: Ship;
  private trees: NamekTrees;
  private details: ShipDetails;
  private lettering: Lettering;

  constructor() {
    this.ship = new Ship();
    this.trees = new NamekTrees();
    this.details = new ShipDetails(
      this.ship,
      this.trees
    );
    this.lettering = new Lettering();
  }

  private mapCel(p: vec3): vec2 {
    let result =
      this.ship.map(p);

    result =
      SDF.union(
        result,
        this.trees.map(p)
      );

    return result;
  }

  private calcNormal(p: vec3): vec3 {
    let normal = vec3(0.0);

    for (let i = 0; i < 4; i++) {
      normal +=
        TET[i] *
        this.mapCel(
          p +
          0.0007 *
          TET[i]
        ).x;
    }

    return normalize(normal);
  }

  private marchCel(
    ro: vec3,
    rd: vec3,
    lineA: f32,
    pixA: f32
  ): MarchResult {
    let edge = 0.0;
    let windowEdge = 0.0;
    let edgeT = 1e10;

    let t = 0.5;
    let previous = vec2(1e10, -1.0);

    for (let i = 0; i < 180; i++) {
      const hit =
        this.mapCel(
          ro +
          rd * t
        );

      if (
        hit.x <
        0.0003 * t
      ) {
        return new MarchResult(
          vec2(t, hit.y),
          edge,
          windowEdge,
          edgeT
        );
      }

      const width =
        lineA * t;

      if (
        hit.x > previous.x &&
        previous.x < width
      ) {
        const contour =
          clamp(
            (
              width -
              previous.x
            ) /
            (pixA * t),
            0.0,
            1.0
          );

        if (
          abs(
            previous.y -
            2.5
          ) < 1.0
        ) {
          windowEdge =
            max(
              windowEdge,
              contour
            );
        } else {
          edge =
            max(
              edge,
              contour
            );
        }

        edgeT =
          min(
            edgeT,
            t
          );
      }

      previous = hit;
      t += hit.x;

      if (t > 24.0) {
        break;
      }
    }

    return new MarchResult(
      vec2(t, -1.0),
      edge,
      windowEdge,
      edgeT
    );
  }

  private render(
    ro: vec3,
    rd: vec3,
    pixA: f32,
    lineA: f32
  ): vec3 {
    const march =
      this.marchCel(
        ro,
        rd,
        lineA,
        pixA
      );

    let edge =
      march.edge;

    if (
      abs(
        march.hit.y -
        2.5
      ) > 1.0
    ) {
      edge =
        max(
          edge,
          march.winEdge
        );
    }

    const shipHit =
      march.hit.y >= 0.0;

    const terrainT =
      Terrain.march(
        ro,
        rd,
        shipHit
          ? march.hit.x
          : 400.0
      );

    let col = vec3(0.0);
    let frontT = 1e10;

    if (
      shipHit &&
      terrainT < 0.0
    ) {
      const p =
        ro +
        rd *
        march.hit.x;

      col =        ShipMaterial.shade(
          p,
          this.calcNormal(p),
          rd,
          march.hit.y,
          march.hit.x,
          pixA,
          lineA,
          this.ship,
          this.trees,
          this.details,
          this.lettering
        );

      frontT =
        march.hit.x;
    } else if (terrainT > 0.0) {
      col =
        this.terrain.shade(
          ro +
          rd *
          terrainT,
          ro,
          terrainT,
          pixA,
          lineA
        );

      frontT =
        terrainT;
    } else {
      col =
        Sky.color(rd);
    }

    if (march.tEdge < frontT) {
      col =
        mix(
          col,
          INK,
          edge
        );
    }

    return col;
  }

  colorAt(uv: vec2): vec4 {
    const resolution = u.resolution;
    const fragCoord =
      uv *
      resolution;

    // Camera: slow turn around the ship, or mouse orbit.
    let azimuth =
      0.42 +
      TAU *
      u.time /
      60.0;

    let elevation =
      0.18 +
      0.03 *
      sin(
        0.21 *
        u.time
      );

    if (
      u.mouse.x > 0.0 ||
      u.mouse.y > 0.0
    ) {
      const mouse =
        u.mouse /
        resolution;

      azimuth =
        0.42 +
        (
          mouse.x -
          0.5
        ) *
        TAU;

      elevation =
        mix(
          0.03,
          1.1,
          mouse.y
        );
    }

    const focalLength = 3.4;

    const sceneTarget =
      vec3(
        0.0,
        -0.25,
        0.0
      );

    const rayOrigin =
      sceneTarget +
      5.6 *
      vec3(
        sin(azimuth) *
          cos(elevation),
        sin(elevation),
        cos(azimuth) *
          cos(elevation)
      );

    const cameraForward =
      normalize(
        sceneTarget -
        rayOrigin
      );

    const cameraRight =
      normalize(
        cross(
          cameraForward,
          vec3(0.0, 1.0, 0.0)
        )
      );

    const cameraUp =
      cross(
        cameraRight,
        cameraForward
      );

    const pixA =
      2.0 /
      (
        resolution.y *
        focalLength
      );

    const lineA =
      (
        0.0055 +
        1.2 /
        resolution.y
      ) /
      focalLength;

    let col =
      vec3(0.0);

    for (let j = 0; j < AA; j++) {
      for (let i = 0; i < AA; i++) {
        const offset =
          (
            vec2(
              f32(i),
              f32(j)
            ) +
            0.5
          ) /
          f32(AA) -
          0.5;

        const screenUV =
          (
            2.0 *
            (
              fragCoord +
              offset
            ) -
            resolution
          ) /
          resolution.y;

        const rd =
          normalize(
            screenUV.x *
              cameraRight +
            screenUV.y *
              cameraUp +
            focalLength *
              cameraForward
          );

        col +=
          this.render(
            rayOrigin,
            rd,
            pixA,
            lineA
          );
      }
    }

    col /=
      f32(AA * AA);

    const q =
      fragCoord /
      resolution;

    // RETRO = 1
    col =
      col *
      vec3(
        0.94,
        1.0,
        0.96
      ) +
      vec3(
        0.025,
        0.035,
        0.03
      );

    col +=
      0.03 *
      (
        Noise.hash12(
          fragCoord +
          61.7 *
          fract(
            u.time *
            7.13
          )
        ) -
        0.5
      );

    col *=
      0.55 +
      0.45 *
      pow(
        16.0 *
        q.x *
        q.y *
        (1.0 - q.x) *
        (1.0 - q.y),
        0.12
      );

    return vec4(
      clamp(
        col,
        vec3(0.0),
        vec3(1.0)
      ),
      1.0
    );
  }
}


class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4.0 - 1.0;
  const y = f32(vi >> u32(1)) * 4.0 - 1.0;
  const ndc = vec2(x, y);
  return { pos: vec4(x, y, 0.0, 1.0), uv: ndc * 0.5 + vec2(0.5) };
}

// ---------------------------------------------------------------------
// Fragment entry
// ---------------------------------------------------------------------

@diagnostic("off", "derivative_uniformity")
@fragment
export function main(
  @location(0) uv: vec2
): vec4 {
  const scene =
    new NamekScene();

  return scene.colorAt(uv);
}