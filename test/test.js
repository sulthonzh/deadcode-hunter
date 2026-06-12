'use strict';

const path = require('path');
const { analyze, formatResults, extractExports, extractImports, walkDir } = require('../index');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; console.log(`  ✗ ${msg}: expected ${expected}, got ${actual}`); }
}

// ── extractExports tests ──
console.log('extractExports:');
{
  const code = `export const foo = 1;
export let bar = 2;
export function baz() {}
export class Qux {}
export { alpha, beta as b };
export default function() {}`;
  const exps = extractExports(code, 'test.js');
  assert(exps.has('foo'), 'named const export');
  assert(exps.has('bar'), 'named let export');
  assert(exps.has('baz'), 'named function export');
  assert(exps.has('Qux'), 'named class export');
  assert(exps.has('alpha'), 'export list member');
  assert(exps.has('b'), 'export list with alias');
  assert(exps.has('default'), 'default export');
  assertEqual(exps.size, 7, 'total exports count');
}

// Named exports only (no default)
{
  const code = `export const x = 1;\nexport const y = 2;`;
  const exps = extractExports(code, 'test.js');
  assertEqual(exps.size, 2, 'two named exports, no default');
  assert(!exps.has('default'), 'no default export');
}

// ── extractImports tests ──
console.log('extractImports:');
{
  const code = `import { a, b } from './mod';
import foo from './bar';
import * as ns from './baz';
import './side';
const { x, y } = require('./cjs');`;
  const { imported, sources } = extractImports(code);
  assert(imported.has('a'), 'named import a');
  assert(imported.has('b'), 'named import b');
  assert(imported.has('default'), 'default import');
  assert(imported.has('*'), 'star import');
  assert(imported.has('x'), 'require destructure x');
  assert(imported.has('y'), 'require destructure y');
  assert(sources.has('./mod'), 'source ./mod');
  assert(sources.has('./bar'), 'source ./bar');
  assert(sources.has('./baz'), 'source ./baz');
  assert(sources.has('./side'), 'source ./side');
  assert(sources.has('./cjs'), 'source ./cjs');
}

// ── walkDir tests ──
console.log('walkDir:');
{
  const files = walkDir(path.join(__dirname, 'fixtures', 'used'), ['.js'], [/node_modules/]);
  assert(files.length >= 2, 'finds JS files in fixture');
}

// ── analyze: used exports ──
console.log('analyze (all used):');
{
  const results = analyze(path.join(__dirname, 'fixtures', 'used'), { extensions: ['.js'] });
  // add, multiply, SECRET are used; subtract is not imported
  assert(results.unusedExports.length >= 1, 'subtract should be unused');
  assert(results.stats.filesScanned >= 2, 'scanned files');
}

// ── analyze: unused exports ──
console.log('analyze (unused):');
{
  const results = analyze(path.join(__dirname, 'fixtures', 'unused'), { extensions: ['.js'] });
  const names = results.unusedExports.map(e => e.export);
  assert(names.includes('unused1'), 'unused1 is flagged');
  assert(names.includes('unused2'), 'unused2 is flagged');
  assert(names.includes('default'), 'default is flagged');
  assert(!names.includes('used'), 'used is NOT flagged');
}

// ── analyze: mixed ──
console.log('analyze (mixed):');
{
  const results = analyze(path.join(__dirname, 'fixtures', 'mixed'), { extensions: ['.js'] });
  const names = results.unusedExports.map(e => e.export);
  assert(names.includes('deleteUser'), 'deleteUser unused');
  assert(names.includes('updateUser'), 'updateUser unused');
  assert(!names.includes('getUsers'), 'getUsers is used');
  assert(!names.includes('createUser'), 'createUser is used');
}

// ── analyze: empty dir ──
console.log('analyze (empty):');
{
  const results = analyze('/tmp/nonexistent_dir_xyz_12345');
  assertEqual(results.unusedExports.length, 0, 'no exports in empty dir');
  assertEqual(results.stats.filesScanned, 0, 'no files scanned');
}

// ── formatResults tests ──
console.log('formatResults:');
{
  const results = {
    unusedExports: [],
    stats: { totalExports: 10, usedExports: 10, unusedExports: 0, filesScanned: 5, usagePercent: 100 },
  };
  const text = formatResults(results);
  assert(text.includes('No unused exports'), 'clean output message');
  
  const jsonOut = formatResults(results, { json: true });
  assert(jsonOut.startsWith('{'), 'JSON output starts with brace');
}

// ── Stats accuracy ──
console.log('stats:');
{
  const results = analyze(path.join(__dirname, 'fixtures', 'unused'), { extensions: ['.js'] });
  assertEqual(results.stats.totalExports >= 4, true, 'total exports >= 4');
  assertEqual(results.stats.unusedExports >= 2, true, 'unused >= 2');
  assertEqual(typeof results.stats.usagePercent, 'number', 'usagePercent is number');
}

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
