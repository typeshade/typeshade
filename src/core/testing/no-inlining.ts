import { afterAll, beforeAll } from 'vitest';
import { setSmallInlining } from '../passes/specialize-and-inline.js';

setSmallInlining(false);
beforeAll(() => setSmallInlining(false));
afterAll(() => setSmallInlining(true));
