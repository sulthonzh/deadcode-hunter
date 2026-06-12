# deadcode-hunter 🧹

Find unused exports and dead code paths in your JS/TS projects. Zero dependencies.

Because shipping code nobody imports is like writing a letter nobody reads — it's there, it takes up space, and it confuses anyone who opens the file.

## What it does

Scans your source tree, extracts every `export` and every `import`, then tells you which exported symbols are never imported anywhere. Supports:

- Named exports (`export const/function/class/interface/type`)
- Default exports
- Export lists (`export { a, b }`)
- Named imports, default imports, star imports
- CommonJS `require()` with destructuring
- Dynamic `import()`
- Re-exports (`export * from '...'`)

## Install

```bash
npm install -g deadcode-hunter
# or
npx deadcode-hunter ./src
```

## Usage

```bash
# Basic scan
deadcode-hunter ./src

# JSON output (for tooling)
deadcode-hunter ./src --json

# Specify entry points (always considered "used")
deadcode-hunter ./src --entry index.ts,cli.ts

# Custom extensions and ignore patterns
deadcode-hunter ./src --ext .js,.ts --ignore dist,generated
```

## Programmatic API

```js
const { analyze, formatResults } = require('deadcode-hunter');

const results = analyze('./src', {
  extensions: ['.js', '.ts'],
  entryPoints: ['index.ts'],
  ignore: [/node_modules/, /dist/],
});

console.log(formatResults(results));
// or use results.unusedExports directly
```

## Output example

```
Found 3 unused export(s):

  src/utils.js
    → formatDate (line 12, named)
    → parseConfig (line 45, named)

  src/api.js
    → default (line 1, default)

Stats: 28 exports, 25 used, 3 unused (89% usage)
Files scanned: 14
```

## CI Integration

Exit code is `1` if any unused exports are found, `0` if clean. Perfect for CI pipelines:

```yaml
- name: Check for dead code
  run: npx deadcode-hunter ./src
```

## Why?

Tree-shaking helps at bundle time, but dead code still hurts during development:
- More code to read and understand
- More code to maintain and test
- Confusing API surface ("is anyone using this?")

Deadcode Hunter catches it at the source level, before it even gets to your bundler.

## License

MIT
