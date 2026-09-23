// A loop over data (Rule 7.5, #203).
//
// The loop rule used to refuse every loop a program over data needs (a count from a uniform, an
// array's length, a mesh's triangles) and to accept loops it had no business accepting: a
// `while` with no bound at all, and one of 100,000 trips. Both targets accept a runtime bound
// (measured in #203), and nothing downstream read the 256-trip ceiling but the check itself.
// A `for` is now counted by a start and a bound of any value, with a constant step whose
// direction the compiler still checks; a `while` is an open loop, refused only when it
// certainly never ends.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

const errorsOf = (src: string): { code?: string; message: string }[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code, message: d.message }))

/** One `for` in a function of `n: i32` that counts its trips. */
function header(head: string): string {
  return `"use typeshade";
    export function f(n: i32): f32 {
      let a = 0.;
      for (${head}) {
        a += 1.;
      }
      return a;
    }
  `
}

describe('a for loop takes a runtime bound', () => {
  it('counts to a parameter on both CPU engines', () => {
    const r = compile(header('let i: i32 = 0; i < n; i++'))
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    for (const make of [compileModule, compileModuleJs]) {
      const f = make(r.module).fns['f']!
      expect([f(0), f(1), f(1000), f(-3)], make.name).toEqual([0, 1, 1000, 0])
    }
    expect(r.wgsl).toContain('for (var i: i32 = 0; (i < n); i = (i + 1)) {')
  })

  it('loops over a mesh from its vertex buffer, the #203 program', () => {
    const src = `"use typeshade";
declare const verts: storage<array<vec3f>>;
declare let hits: storage<array<u32>>;
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  let count: u32 = 0;
  for (let t: u32 = 0; t < verts.length / 3; t++) {
    if (verts[t * 3].y > f32(gid.x)) {
      count += 1;
    }
  }
  hits[gid.x] = count;
}
`
    const r = compile(src)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&verts) / 3u')
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module)
      // Four triangles whose first vertices sit at y = 0, 1, 2 and 3.
      const verts = [0, 1, 2, 3].flatMap((y) => [
        [0, y, 0],
        [0, 0, 0],
        [0, 0, 0],
      ])
      const hits = [0, 0]
      // An array of vec3 is an array of arrays on the CPU, which `CpuValue` does not spell.
      cm.setBinding('verts', verts as unknown as CpuValue)
      cm.setBinding('hits', hits)
      cm.fns['main']!([0, 0, 0])
      cm.fns['main']!([1, 0, 0])
      expect(hits, make.name).toEqual([3, 2])
    }
  })

  it('takes its bound from a uniform and its start from the invocation', () => {
    // The strided loop every compute kernel writes: each invocation starts at its own index and
    // steps by the workgroup's width, up to a count the host sets.
    const src = `"use typeshade";
interface Params { count: u32 }
declare const params: uniform<Params>;
declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
@compute([64])
export function main(@builtin("local_invocation_index") lid: u32): void {
  let s = 0.;
  for (let i: u32 = lid; i < params.count; i += 64) {
    s += src[i];
  }
  dst[lid] = s;
}
`
    const r = compile(src)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // licm reads the count once, ahead of the loop, since nothing in the body writes it.
    expect(r.wgsl).toContain('let _licm0 = params.count;')
    expect(r.wgsl).toContain('for (var i: u32 = lid; (i < _licm0); i += 64u) {')
  })

  it('emits a uniform-bounded loop in GLSL ES 3.00 as written', () => {
    const src = `"use typeshade";
interface Frame { steps: i32 }
declare const frame: uniform<Frame>;
@fragment
export function fs(@builtin("position") p: vec4f): vec4f {
  let a = 0.;
  for (let i: i32 = 0; i < frame.steps; i++) {
    a += 0.01;
  }
  return vec4f(a, 0., 0., 1.);
}
`
    const r = compile(src)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.glsl?.fragment).toMatch(/_licm0 = \w+\.steps;/)
    expect(r.glsl?.fragment).toContain('for (int i = 0; (i < _licm0); i = (i + 1)) {')
  })

  it('holds a barrier in a runtime-bounded loop to the uniformity rule', () => {
    // A bound every invocation shares keeps the loop uniform, so a barrier in it is legal. A
    // bound from the invocation's own index makes the trip count differ between invocations,
    // which is how a workgroup waits forever, and is TS8052 as a branch on it would be.
    const kernel = (bound: string): string => `"use typeshade";
interface Params { rounds: u32 }
declare const params: uniform<Params>;
declare let out: storage<array<f32>>;
let tile: workgroup<array<f32, 64>>;
@compute([64])
export function main(@builtin("local_invocation_index") lid: u32): void {
  for (let r: u32 = 0; r < ${bound}; r++) {
    tile[lid] = f32(r);
    workgroupBarrier();
  }
  out[lid] = tile[u32(63) - lid];
}
`
    expect(errorsOf(kernel('params.rounds'))).toEqual([])
    expect(errorsOf(kernel('lid')).map((d) => d.code)).toEqual(['TS8052'])
  })

  it('refuses the runtime headers whose exit it can prove is never reached', () => {
    expect(errorsOf(header('let i: i32 = 0; i < n; i -= 1'))).toEqual([
      {
        code: 'TS8007',
        message:
          'for step "i -= 1" moves "i" away from a bound it compares with <, so the loop does ' +
          'not exit once it starts.',
      },
    ])
    expect(errorsOf(header('let i: i32 = n; i > 0; i /= 2'))).toEqual([])
    expect(errorsOf(header('let i: i32 = n; i < 64; i /= 2'))[0]?.code).toBe('TS8007')
    expect(errorsOf(header('let i: i32 = 0; i < n; i *= 2'))).toEqual([
      {
        code: 'TS8007',
        message: 'for step "i *= 2" never advances "i": multiplying pins it at 0.',
      },
    ])
    expect(errorsOf(header('let i: i32 = 1; i < n; i *= 2'))).toEqual([])
    expect(errorsOf(header('let i: i32 = 1; i < n; i *= -2'))).toEqual([
      {
        code: 'TS8006',
        message:
          'for step "i *= -2" with a runtime start or bound needs a whole factor of 2 or more, ' +
          'so its direction is known.',
      },
    ])
    expect(errorsOf(header('let i: i32 = 0; i !== n; i += 2'))).toEqual([
      {
        code: 'TS8006',
        message:
          'for exit "i != <bound>" with a runtime bound exits only if "i += 2" lands on it ' +
          'exactly. Compare with <, <=, > or >=.',
      },
    ])
  })

  it('refuses a bound that is not one: the counter itself, or a name the body writes', () => {
    expect(errorsOf(header('let i: i32 = 1; i < i * 2; i++'))[0]?.message).toBe(
      'for exit must compare "i" to a bound (e.g. i < 16, or i < n). A loop that ends some ' +
        'other way is a while loop.',
    )
    const moved = `"use typeshade";
      export function f(n0: i32): i32 {
        let s: i32 = 0;
        let n = n0;
        for (let i: i32 = 0; i < n; i++) {
          if (s > 8) { n = 0; }
          s += i;
        }
        return s;
      }
    `
    expect(errorsOf(moved)).toEqual([
      {
        code: 'TS8006',
        message:
          'for bound reads "n", which the loop body writes, so it does not bound the loop. ' +
          'Read it into a const before the loop, or write the loop as a while.',
      },
    ])
    // The same loop as a while is an open loop, and says what it does.
    expect(
      errorsOf(
        moved
          .replace('for (let i: i32 = 0; i < n; i++)', 'let i: i32 = 0;\n while (i < n)')
          .replace('s += i;', 's += i; i++;'),
      ),
    ).toEqual([])
  })

  it('counts a long loop, and a nest whose product passes 256, as ordinary loops', () => {
    const r = compile(`"use typeshade";
      export function f(): f32 {
        let a = 0.;
        for (let i: i32 = 0; i < 100000; i++) { a += 1.; }
        for (let y: i32 = 0; y < 64; y++) {
          for (let x: i32 = 0; x < 64; x++) { a += 1.; }
        }
        return a;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.eval('f', [])).toBe(100000 + 4096)
  })
})

describe('a while loop is an open loop', () => {
  it('walks a stack until it is empty, the BVH traversal shape', () => {
    const r = compile(`"use typeshade";
      export function f(depth: i32): i32 {
        let stack: array<i32, 16> = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let sp: i32 = 1;
        stack[0] = depth;
        let visited: i32 = 0;
        while (sp > 0) {
          sp -= 1;
          let d = stack[sp];
          visited += 1;
          if (d > 0 && sp < 14) {
            stack[sp] = d - 1;
            stack[sp + 1] = d - 1;
            sp += 2;
          }
        }
        return visited;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    for (const make of [compileModule, compileModuleJs]) {
      const f = make(r.module).fns['f']!
      // A full binary tree of depth 3 has 15 nodes.
      expect([f(0), f(1), f(3)], make.name).toEqual([1, 3, 15])
    }
    expect(r.wgsl).toContain('for (var _w: i32 = 0; (sp > 0); _w = (_w + 1)) {')
  })

  it('leaves while (true) by a break or a return', () => {
    const r = compile(`"use typeshade";
      export function solve(x0: f32): f32 {
        let x = x0;
        while (true) {
          let next = 0.5 * (x + 2. / x);
          if (abs(next - x) < 0.000001) { break; }
          x = next;
        }
        return x;
      }
      export function first(limit: i32): i32 {
        let i: i32 = 0;
        while (true) {
          if (i * i > limit) { return i; }
          i += 1;
        }
        return -1;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.eval('solve', [1])).toBeCloseTo(Math.SQRT2, 5)
    expect(r.eval('first', [50])).toBe(8)
    // The counter the IR's one loop form carries is an i32, never the condition's bool.
    expect(r.wgsl).toContain('for (var _w: i32 = 0; true; _w = (_w + 1)) {')
  })

  it('refuses while (true) with nothing that leaves it', () => {
    expect(
      errorsOf(`"use typeshade";
        export function f(): f32 {
          let a = 0.;
          while (true) { a += 1.; }
          return a;
        }
      `),
    ).toEqual([
      {
        code: 'TS8007',
        message:
          'while (true) has no break or return in its body, so it never ends. Leave it with a ' +
          'break, or write the exit into the condition.',
      },
    ])
  })

  it('gives the counter an i32 under a float condition', () => {
    const r = compile(`"use typeshade";
      export function f(): f32 { let a = 0.; while (a < 4.) { a += 1.; } return a; }
    `)
    expect(r.wgsl).toContain('for (var _w: i32 = 0; (a < 4.0); _w = (_w + 1)) {')
    expect(r.eval('f', [])).toBe(4)
  })

  it('points a for with no condition at the while form', () => {
    expect(
      errorsOf(`"use typeshade";
        export function f(): void { for (;;) { break; } }
      `),
    ).toEqual([
      {
        code: 'TS8007',
        message:
          'for is missing an exit condition. A for loop is counted; a loop that ends at a ' +
          'break is "while (true) { … }".',
      },
    ])
  })
})
