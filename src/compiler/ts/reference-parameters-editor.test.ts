// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('the editor shows an object parameter as the compiler reads it (change 0142)', () => {
  it('hovers an object parameter with the object it names', () => {
    const source = `"use typeshade";
class Cell { v: f32; }
function bump(c: Cell): void { c.v += 1.; }
export function run(): f32 { let x = new Cell(); bump(x); return x.v; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('h.ts', source);
    const at = service.positionAt('h.ts', source.indexOf('c.v += 1.'));
    const hover = service.getHover('h.ts', at)?.contents ?? '';
    expect(hover).toContain('(parameter) c: Cell');
    expect(hover).toContain("The caller's object: this function writes it");
    expect(hover).toContain('ptr<function, Cell>');
  });

  it('hovers a parameter that its function only reads as a plain parameter', () => {
    const source = `"use typeshade";
class Cell { v: f32; }
function look(c: Cell): f32 { return c.v; }
export function run(): f32 { let x = new Cell(); return look(x); }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('h.ts', source);
    const hover =
      service.getHover('h.ts', service.positionAt('h.ts', source.indexOf('c.v')))?.contents ?? '';
    expect(hover).toContain('(parameter) c: Cell');
    expect(hover).not.toContain("The caller's object");
  });

  it('hovers a function with its parameters, where it is declared and where it is called', () => {
    const source = `"use typeshade";
class Cell { v: f32; }
function lift(w: Cell, k: f32): void { w.v = mix(w.v, 1., k); }
export function run(): f32 { let x = new Cell(); lift(x, 0.5); return x.v; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('f.ts', source);
    const at = (offset: number): string =>
      service.getHover('f.ts', service.positionAt('f.ts', offset))?.contents ?? '';
    for (const offset of [source.indexOf('lift(') + 1, source.lastIndexOf('lift(') + 1]) {
      expect(at(offset)).toContain('function lift(w: Cell, k: f32): void');
    }
  });
});
