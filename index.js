'use strict';

const fs = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function walkDir(dir, exts, ignore) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (ignore.some(re => re.test(full))) continue;
    if (entry.isDirectory()) {
      results.push(...walkDir(full, exts, ignore));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

// ── Export extraction ────────────────────────────────────

const RE_NAMED_EXPORT = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
const RE_DEFAULT_EXPORT = /export\s+default\s+/;
const RE_EXPORT_LIST = /export\s*\{([^}]+)\}/g;
const RE_EXPORT_STAR_FROM = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
const RE_REEXPORT = /export\s*\{[^}]*\}\s*from\s+['"]([^'"]+)['"]/g;

function extractExports(code, filePath) {
  const exports = new Map(); // name -> { line, type }

  // Named exports
  let m;
  RE_NAMED_EXPORT.lastIndex = 0;
  while ((m = RE_NAMED_EXPORT.exec(code))) {
    const line = code.substring(0, m.index).split('\n').length;
    exports.set(m[1], { line, type: 'named' });
  }

  // Export lists: export { foo, bar }
  RE_EXPORT_LIST.lastIndex = 0;
  while ((m = RE_EXPORT_LIST.exec(code))) {
    const line = code.substring(0, m.index).split('\n').length;
    const names = m[1].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return (parts[parts.length - 1] || '').trim();
    }).filter(Boolean);
    for (const name of names) {
      exports.set(name, { line, type: 'named' });
    }
  }

  // Default export
  if (RE_DEFAULT_EXPORT.test(code)) {
    const line = code.substring(0, code.search(RE_DEFAULT_EXPORT)).split('\n').length;
    exports.set('default', { line, type: 'default' });
  }

  // Re-exports (export * from '...')
  RE_EXPORT_STAR_FROM.lastIndex = 0;
  while ((m = RE_EXPORT_STAR_FROM.exec(code))) {
    const line = code.substring(0, m.index).split('\n').length;
    exports.set(`*:${m[1]}`, { line, type: 'reexport' });
  }

  RE_REEXPORT.lastIndex = 0;
  while ((m = RE_REEXPORT.exec(code))) {
    const line = code.substring(0, m.index).split('\n').length;
    exports.set(`reexport:${m[1]}`, { line, type: 'reexport' });
  }

  return exports;
}

// ── Import / usage extraction ────────────────────────────

const RE_IMPORT = /import\s+(?:([^,{]*?)\s*,?\s*)?\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g;
const RE_IMPORT_DEFAULT = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
const RE_IMPORT_STAR = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
const RE_IMPORT_SIDE = /import\s+['"]([^'"]+)['"]/g;
const RE_REQUIRE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_REQUIRE_DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_DYNAMIC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(code) {
  const imported = new Set(); // symbols used
  const sources = new Set(); // file paths imported from
  let m;

  // Named imports: import { a, b } from '...'
  RE_IMPORT.lastIndex = 0;
  while ((m = RE_IMPORT.exec(code))) {
    const names = m[2].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return (parts[0] || '').trim();
    }).filter(Boolean);
    names.forEach(n => imported.add(n));
    sources.add(m[3]);
  }

  // Default import: import foo from '...'
  RE_IMPORT_DEFAULT.lastIndex = 0;
  while ((m = RE_IMPORT_DEFAULT.exec(code))) {
    if (m[1] !== '{') { // avoid matching named imports
      imported.add('default');
      sources.add(m[2]);
    }
  }

  // Star import: import * as foo from '...'
  RE_IMPORT_STAR.lastIndex = 0;
  while ((m = RE_IMPORT_STAR.exec(code))) {
    imported.add('*');
    sources.add(m[2]);
  }

  // Side-effect imports
  RE_IMPORT_SIDE.lastIndex = 0;
  while ((m = RE_IMPORT_SIDE.exec(code))) {
    sources.add(m[1]);
  }

  // CommonJS require
  RE_REQUIRE.lastIndex = 0;
  while ((m = RE_REQUIRE.exec(code))) {
    sources.add(m[1]);
  }

  // Destructured require: const { a, b } = require('...')
  RE_REQUIRE_DESTRUCTURE.lastIndex = 0;
  while ((m = RE_REQUIRE_DESTRUCTURE.exec(code))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    names.forEach(n => imported.add(n));
    sources.add(m[2]);
  }

  // Dynamic import
  RE_DYNAMIC_IMPORT.lastIndex = 0;
  while ((m = RE_DYNAMIC_IMPORT.exec(code))) {
    sources.add(m[1]);
  }

  return { imported, sources };
}

// ── Module resolution (simplified) ──────────────────────

function resolveModule(importPath, fromFile, srcDir) {
  // Relative imports
  if (importPath.startsWith('.')) {
    const dir = path.dirname(fromFile);
    let resolved = path.resolve(dir, importPath);

    // Try extensions
    for (const ext of ['', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']) {
      const tryPath = resolved + ext;
      if (fs.existsSync(tryPath)) return tryPath;
    }
    // Try index
    for (const ext of ['index.js', 'index.ts', 'index.mjs']) {
      const tryPath = path.join(resolved, ext);
      if (fs.existsSync(tryPath)) return tryPath;
    }
    return null;
  }

  // Absolute/package imports — try from srcDir
  const parts = importPath.split('/');
  let base;
  if (importPath.startsWith('@')) {
    base = path.join(srcDir, 'node_modules', parts[0], parts[1]);
  } else {
    base = path.join(srcDir, 'node_modules', parts[0]);
  }
  if (fs.existsSync(base) || fs.existsSync(base + '.js')) return base;
  return null;
}

// ── Main analyzer ───────────────────────────────────────

function analyze(srcDir, options = {}) {
  const {
    extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'],
    ignore = [/node_modules/, /\.git/, /dist/, /build/, /coverage/],
    entryPoints = [],
  } = options;

  const files = walkDir(srcDir, extensions, ignore);
  if (files.length === 0) {
    return { files: [], modules: [], unusedExports: [], stats: { totalExports: 0, unusedExports: 0, filesScanned: 0 } };
  }

  // Phase 1: Extract all exports
  const modules = new Map(); // filePath -> { exports, code }
  const allExports = new Map(); // symbolName -> [{ filePath, line, type }]

  for (const file of files) {
    const code = readFile(file);
    const exports = extractExports(code, file);
    modules.set(file, { exports, code, relativePath: path.relative(srcDir, file) });

    for (const [name, info] of exports) {
      if (name.startsWith('*:') || name.startsWith('reexport:')) continue;
      if (!allExports.has(name)) allExports.set(name, []);
      allExports.get(name).push({ filePath: file, line: info.line, type: info.type });
    }
  }

  // Phase 2: Collect all imported symbols
  const usedSymbols = new Set();
  const usedFiles = new Set();

  for (const [file, mod] of modules) {
    const { imported, sources } = extractImports(mod.code);
    imported.forEach(s => usedSymbols.add(s));
    for (const src of sources) {
      const resolved = resolveModule(src, file, srcDir);
      if (resolved) usedFiles.add(resolved);
    }
  }

  // Entry points are considered "used"
  for (const ep of entryPoints) {
    const full = path.resolve(srcDir, ep);
    usedFiles.add(full);
  }

  // Phase 3: Find unused exports
  const unusedExports = [];
  let totalExports = 0;

  for (const [file, mod] of modules) {
    for (const [name, info] of mod.exports) {
      if (name.startsWith('*:') || name.startsWith('reexport:')) continue;
      totalExports++;

      // An export is unused if its specific symbol is never imported.
      // Special case: 'default' is considered used if the file is imported at all
      // (star imports or side-effect imports make the whole module 
      const symbolUsed = usedSymbols.has(name);

      // star import (*) from this file means all named exports are used
      // but we can't easily track which file the star came from, so just check symbol
      const actuallyUsed = symbolUsed;

      if (!actuallyUsed) {
        unusedExports.push({
          file: mod.relativePath,
          export: name,
          line: info.line,
          type: info.type,
        });
      }
    }
  }

  // Phase 4: Stats
  const stats = {
    totalExports,
    unusedExports: unusedExports.length,
    filesScanned: files.length,
    usedExports: totalExports - unusedExports.length,
    usagePercent: totalExports > 0 ? Math.round(((totalExports - unusedExports.length) / totalExports) * 100) : 100,
  };

  return { files, modules: [...modules.values()], unusedExports, stats };
}

// ── Formatting ──────────────────────────────────────────

function formatResults(results, options = {}) {
  const { json = false, verbose = false } = options;

  if (json) return JSON.stringify(results, null, 2);

  const lines = [];
  const { unusedExports, stats } = results;

  if (unusedExports.length === 0) {
    lines.push('✅ No unused exports found. All clean!');
  } else {
    lines.push(`Found ${unusedExports.length} unused export(s):\n`);

    // Group by file
    const byFile = new Map();
    for (const exp of unusedExports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file).push(exp);
    }

    for (const [file, exps] of byFile) {
      lines.push(`  ${file}`);
      for (const exp of exps) {
        lines.push(`    → ${exp.export} (line ${exp.line}, ${exp.type})`);
      }
      lines.push('');
    }
  }

  lines.push(`Stats: ${stats.totalExports} exports, ${stats.usedExports} used, ${stats.unusedExports} unused (${stats.usagePercent}% usage)`);
  lines.push(`Files scanned: ${stats.filesScanned}`);

  return lines.join('\n');
}

module.exports = { analyze, formatResults, extractExports, extractImports, walkDir, resolveModule };
