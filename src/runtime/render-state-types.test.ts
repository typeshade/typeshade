// The type half of the render-state fields of proposal 0064 (PR-1, Required validation, "Type
// half"). Each probe is a `@ts-expect-error` line or a call that must compile. `bun run build`
// fails on a stale directive, so a probe that stops failing is caught there. The function
// `probes` is never called: the test only reads its types.
//
// Verifies: Rule 11.11.

import { describe, expectTypeOf, it } from 'vitest';
import type { CompareFunction, Program, RenderPipeline, RenderState } from './program.js';
import type { SamplerOptions } from './resources.js';
import type { Frame, RenderPass, Runtime } from './runtime.js';

declare const program: Program;
declare const pass: RenderPass;
declare const frame: Frame;
declare const rt: Runtime;
declare const colour: import('./resources.js').Texture;
declare const format: string;
declare const width: number;
declare const height: number;
declare const scene: RenderPipeline;
declare const sceneBindings: Record<string, unknown>;
declare const geometry: { readonly count: number };
declare const panel: {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
};
declare const uiPipeline: RenderPipeline;
declare const uiBindings: Record<string, unknown>;
declare const quad: { readonly count: number };

const probes = (): void => {
  // The compare is a CompareFunction: a misspelling is refused.
  // @ts-expect-error 'lesss' is not a CompareFunction
  program.render({ depth: { format: 'depth24plus', compare: 'lesss' } });
  const c: CompareFunction = 'less';
  program.render({ depth: { format: 'x', compare: c } });

  // A state held in a variable with no annotation widens its compare to string, and is refused.
  const hoisted = { depth: { format: 'depth32float', compare: 'greater' } };
  // @ts-expect-error the hoisted compare is a string, not a CompareFunction
  program.render(hoisted);
  program.render({ depth: { format: 'depth32float', compare: 'greater' } } satisfies RenderState);
  program.render({ depth: { format: 'depth32float', compare: 'greater' } } as const);
  const annotated: RenderState = { depth: { format: 'depth32float', compare: 'greater' } };
  program.render(annotated);

  // The runtime refuses a key the type does not name, and the render call infers its state type,
  // so this one compiles (a limit the runtime's refusal covers; see the runtime tests).
  program.render({ depth: { format: 'depth24plus', writ: false } });

  // The blend constant is four numbers: a tuple, a number array or a Float32Array.
  program.render({ blendConstant: [0, 0, 0, 1] });
  const nums: number[] = [0, 0, 0, 1];
  program.render({ blendConstant: nums });
  program.render({ blendConstant: new Float32Array([0, 0, 0, 1]) });
  // @ts-expect-error a string is not an ArrayLike of numbers
  program.render({ blendConstant: 'x' });

  // The compare of a sampler is the same type.
  const so: SamplerOptions = { compare: c };
  // @ts-expect-error 'lesss' is not a comparison
  const bad: SamplerOptions = { compare: 'lesss' };
  void so;
  void bad;

  // The pass methods take each depth argument on its own.
  pass.setBlendConstant([0, 0, 0, 1]);
  pass.setBlendConstant(new Float32Array(4));
  pass.setViewport(0, 0, 16, 12);
  pass.setViewport(0, 0, 16, 12, 0.25);
  pass.setViewport(0, 0, 16, 12, 0.25, 0.75);
  // @ts-expect-error a viewport takes four arguments at least
  pass.setViewport(0, 0, 1);
  pass.setScissorRect(0, 0, 16, 12);

  // Each section-69 fragment of PR-1 compiles as written (Rule 13.8), with its free names declared.
  const scissorUi = (): void => {
    // A scissored UI pass. The rectangle comes from a layout box, so each side is rounded.
    const box = panel.getBoundingClientRect();
    frame.pass({ color: [{ target: colour, load: 'load' }] }, (pass) => {
      pass.setScissorRect(
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
      );
      pass.draw(uiPipeline, uiBindings, quad);
      pass.setScissorRect(0, 0, width, height);
      pass.draw(scene, sceneBindings, geometry);
    });
  };
  const twoViews = (): void => {
    // Two views side by side. Each view sets its viewport before its draws.
    const half = width >> 1;
    frame.pass({ color: [{ target: colour }] }, (pass) => {
      pass.setViewport(0, 0, half, height);
      pass.draw(scene, sceneBindings, geometry);
      pass.setViewport(half, 0, half, height);
      pass.draw(scene, sceneBindings, geometry);
    });
  };
  const blendConstantPass = async (): Promise<void> => {
    // A pipeline constant and a pass constant: the pipeline's draws read its own constant.
    const glow = await program.render({
      vertex: 'vs',
      fragment: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'constant', dstFactor: 'one-minus-constant', operation: 'add' },
            alpha: { srcFactor: 'constant', dstFactor: 'one-minus-constant', operation: 'add' },
          },
        },
      ],
      blendConstant: [0.25, 0.5, 0.75, 1],
    });
    frame.pass({ color: [{ target: colour, load: 'load' }] }, (pass) => {
      pass.setBlendConstant([0.25, 0.5, 0.75, 1]);
      pass.draw(glow, sceneBindings, geometry);
    });
  };
  void rt;
  void scissorUi;
  void twoViews;
  void blendConstantPass;
};

describe('the render-state types of proposal 0064 (PR-1)', () => {
  it('types the probes the proposal lists, and the pass methods', () => {
    expectTypeOf(probes).toBeFunction();
    expectTypeOf<CompareFunction>().toEqualTypeOf<
      | 'never'
      | 'less'
      | 'equal'
      | 'less-equal'
      | 'greater'
      | 'not-equal'
      | 'greater-equal'
      | 'always'
    >();
    expectTypeOf<RenderPass['setViewport']>().toBeFunction();
  });
});
