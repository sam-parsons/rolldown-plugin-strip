# rolldown-plugin-strip

[![npm version](https://img.shields.io/npm/v/rolldown-plugin-strip)](https://www.npmjs.com/package/rolldown-plugin-strip)
[![npm license](https://img.shields.io/npm/l/rolldown-plugin-strip)](https://github.com/sam-parsons/rolldown-plugin-strip/blob/main/LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/rolldown-plugin-strip)](https://www.npmjs.com/package/rolldown-plugin-strip)
[![CI](https://github.com/sam-parsons/rolldown-plugin-strip/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sam-parsons/rolldown-plugin-strip/actions/workflows/ci.yml?query=branch%3Amain)

`rolldown-plugin-strip` removes debug-only code from Rolldown build output.

It currently supports:

- stripping configured function-call statements (for example `console.log(...)`);
- stripping standalone `debugger` statements;
- stripping configured labeled statements and labeled blocks;
- safe handling for chained/non-statement call matches via `chainedCalls`.

## Install

```bash
npm install rolldown-plugin-strip
```

## Usage (production build)

The plugin is build-only (`apply: "build"`) and runs as a pre transform (`enforce: "pre"`).

```ts
import { defineConfig } from "rolldown";
import { strip } from "rolldown-plugin-strip";

export default defineConfig({
  plugins: [
    strip({
      debugger: true,
      functions: ["console.log", "console.debug"],
      labels: ["dev", "debug"],
      chainedCalls: "warn"
    })
  ]
});
```

## Options

```ts
type ChainedCallsPolicy = "skip" | "warn" | "error";

interface StripOptions {
  functions?: string[];
  debugger?: boolean;
  labels?: string[];
  chainedCalls?: ChainedCallsPolicy; // default: "skip"
}
```

- `functions`
  - A list of function names to strip when they appear as a full statement on a line.
  - Example removable line: `console.log("debug");`
- `debugger`
  - When `true`, removes full lines containing only `debugger` (with optional semicolon).
- `labels`
  - A list of labels to remove, including single-line labeled statements and labeled blocks.
  - Examples: `dev: doThing();`, `dev: { doThing(); }`, `dev: while (cond) { ... }`
- `chainedCalls`
  - Controls behavior when a configured function matches but cannot be safely removed as a whole statement.
  - `"skip"` (default): keep the line unchanged.
  - `"warn"`: keep the line and emit a warning to `console.warn`.
  - `"error"`: throw and fail the build.

## Chained-call behavior

Given:

```ts
strip({ functions: ["debug"], chainedCalls: "skip" });
```

Safe removable line (always stripped):

```ts
debug("trace");
```

Chained/non-statement line (not safely removable):

```ts
debug("trace").trim();
```

Outcomes for the chained/non-statement line:

- `chainedCalls: "skip"` -> line is left as-is.
- `chainedCalls: "warn"` -> line is left as-is and a warning is logged.
- `chainedCalls: "error"` -> an error is thrown and the build fails.

## Notes

- When the transform changes the module source, `transform` returns a **non-null** source map (VLQ v3) so debuggers and error stacks can map generated output back to the original file. Unchanged modules keep `map: null`.
- When `functions` is enabled, line endings are normalized the same way as the stripper (`split(/\r?\n/).join("\n")`); if that step runs, the map is composed from the removal map and the newline-normalization map.
- Call-expression matching is line-based and intentionally conservative to avoid unsafe removals.

## Local development and test

```bash
npm install
npm run check
npm run build
```

- `npm run check` runs type-check/lint (`tsc --noEmit`) and tests (`vitest run`).
- `npm run build` emits `dist/` using `tsconfig.build.json`.
