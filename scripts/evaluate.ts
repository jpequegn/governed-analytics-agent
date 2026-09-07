import { resolve } from 'node:path';
import { evaluate } from '../src/evaluation.js';
const output = resolve(process.argv[2] ?? 'reports/evaluation');
const report = await evaluate(resolve('fixtures'), output);
console.log(JSON.stringify({ output, cases: report.results.length, passed: report.results.filter(r => r.passed).length }));
if (report.results.some(r => !r.passed)) process.exitCode = 1;

