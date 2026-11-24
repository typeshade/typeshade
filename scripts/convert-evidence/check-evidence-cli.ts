import { COVERAGE_ROWS } from '../../src/core/coverage/index.js';
import { checkEvidence, loadContext } from '../bake-capability-coverage.js';

const root = process.argv[2] ?? process.cwd();
console.log(JSON.stringify(checkEvidence(COVERAGE_ROWS, loadContext(root))));
