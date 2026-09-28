// The engine journey's host (change 0025, Rule 11.11): a small engine, written the way a host
// application writes one on `typeshade/runtime`, and nothing else. It imports only the
// runtime's public exports, and it calls nothing on a WebGPU object: the device it is handed goes
// straight to `createRuntime`, and the runtime makes every buffer, texture, pipeline and bind
// group. The harness fails the journey on any other import or any WebGPU call in this file.
//
// The scene, seen from straight above: a grey ground and, over its middle, the top of a brick
// wall, which casts a shadow on the ground from a key light low in the west. Each frame is three
// passes:
//
//   1. the shadow pass: the wall's depth as the key light sees it, into a depth texture;
//   2. the scene pass: the ground and the wall, two materials that share the camera and the
//      lights, into a half-float texture, the ground reading the shadow map by comparison;
//   3. the tonemap pass: that texture, sampled and mapped into [0, 1), into the output.
//
// The camera is one `Resident` both materials bind; its clock moves every frame, and the fill
// light pulses with it.

import { createRuntime, resident } from 'typeshade/runtime';

/** Two triangles over [x0, x1] by [y0, y1] at height z: six positions, three floats each. */
const quad = (x0, y0, x1, y1, z) =>
  new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z]);

export const GROUND = quad(-1, -1, 1, 1, 0);
export const WALL = quad(-0.25, -0.25, 0.25, 0.25, 0.5);

// Matrices are column-major, as WGSL reads them. The camera looks straight down: clip x and y
// are the world's, and depth is 0.5 at the ground and nearer as a point rises.
export const CAMERA = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -0.25, 0, 0, 0, 0.5, 1];
// The key light shines down and east, half a unit east for each unit it falls: its view shears x
// by height, and its depth is 0.5 at the ground and nearer as a point rises.
export const LIGHT = [1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, -0.5, 0, 0, 0, 0.5, 1];

const len = Math.hypot(0.5, 1);
export const LIGHTS = {
  key: { dir: [-0.5 / len, 0, 1 / len, 0], color: [1.5, 1.4, 1.2, 0] },
  fill: { dir: [0, 0, 1, 0], color: [0.3, 0.45, 0.9, 0] },
};

/** Make the scene on `device` for a square target of `size` pixels, and return what draws a
 *  frame at a time and what reads the last one back. */
export async function setup({ device, programs, size }) {
  const rt = await createRuntime({ device });
  const target = { format: 'rgba16float' };
  const depthState = { format: 'depth24plus', compare: 'less' };
  const [shadow, ground, wall, tonemap] = await Promise.all([
    rt.load(programs.shadow).render({
      fragment: null,
      depth: { format: 'depth32float', compare: 'less' },
    }),
    rt.load(programs.ground).render({ targets: [target], depth: depthState }),
    rt.load(programs.brick).render({ targets: [target], depth: depthState }),
    rt.load(programs.tonemap).render({ targets: ['rgba8unorm'] }),
  ]);

  const camera = resident({ viewProj: CAMERA, time: 0 });
  const light = resident({ viewProj: LIGHT });
  const lights = resident(LIGHTS);
  const shadowMap = rt.texture({ size: [size, size], format: 'depth32float' });
  const hdr = rt.texture({ size: [size, size], format: 'rgba16float' });
  const depth = rt.texture({ size: [size, size], format: 'depth24plus' });
  const out = rt.texture({ size: [size, size], format: 'rgba8unorm' });
  const cmp = rt.sampler({ filter: 'nearest', compare: 'less' });
  const smp = rt.sampler({ filter: 'nearest' });
  const groundMesh = { vertices: GROUND, count: 6 };
  const wallMesh = { vertices: WALL, count: 6 };

  return {
    /** Draw one frame at `time` seconds, and resolve once the GPU has run it. */
    async frame(time) {
      camera.write({ viewProj: CAMERA, time });
      const f = rt.frame();
      f.pass({ depth: { target: shadowMap, clear: 1 } }, (p) =>
        p.draw(shadow, { light }, wallMesh),
      );
      f.pass(
        { color: [{ target: hdr, clear: [0, 0, 0, 1] }], depth: { target: depth, clear: 1 } },
        (p) => {
          p.draw(ground, { camera, light, lights, shadowMap, cmp }, groundMesh);
          p.draw(wall, { camera, lights }, wallMesh);
        },
      );
      f.pass({ color: [out] }, (p) => p.draw(tonemap, { hdr, smp }, { count: 3 }));
      await f.submit();
    },
    /** The last frame's pixels, RGBA, top row first. */
    read: () => out.read(),
  };
}
