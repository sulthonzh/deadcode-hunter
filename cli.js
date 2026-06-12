#!/usr/bin/env node
'use strict';

const { analyze, formatResults } = require('./index');
const path = require('path');

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
deadcode-hunter — Find unused exports in JS/TS projects

Usage:
  deadcode-hunter <dir> [options]

Options:
  --json          Output as JSON
  --verbose       Show more details
  --entry <file>  Entry point(s), comma-separated (these files are always "used")
  --ext <exts>    File extensions to scan (comma-separated, default: .js,.ts,.jsx,.tsx,.mjs,.cjs)
  --ignore <dirs> Directory patterns to ignore (comma-separated)
  -h, --help      Show this help

Examples:
  deadcode-hunter ./src
  deadcode-hunter ./src --json
  deadcode-hunter ./src --entry index.ts,cli.ts
  deadcode-hunter ./src --ext .js,.ts --ignore dist,coverage
`);
  process.exit(0);
}

const srcDir = path.resolve(args[0]);
const json = args.includes('--json');
const verbose = args.includes('--verbose');

let entryPoints = [];
const entryIdx = args.indexOf('--entry');
if (entryIdx !== -1 && args[entryIdx + 1]) {
  entryPoints = args[entryIdx + 1].split(',').map(s => s.trim());
}

let extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
const extIdx = args.indexOf('--ext');
if (extIdx !== -1 && args[extIdx + 1]) {
  extensions = args[extIdx + 1].split(',').map(s => s.startsWith('.') ? s : '.' + s);
}

let ignorePatterns = [/node_modules/, /\.git/, /dist/, /build/, /coverage/];
const ignoreIdx = args.indexOf('--ignore');
if (ignoreIdx !== -1 && args[ignoreIdx + 1]) {
  const extra = args[ignoreIdx + 1].split(',').map(s => new RegExp(s.trim()));
  ignorePatterns.push(...extra);
}

const results = analyze(srcDir, { extensions, entryPoints, ignore: ignorePatterns });
console.log(formatResults(results, { json, verbose }));

// Exit code: 1 if unused exports found (useful for CI)
process.exit(results.unusedExports.length > 0 ? 1 : 0);
