export type ChainedCallsPolicy = "skip" | "warn" | "error";

export interface StripOptions {
  functions?: string[];
  debugger?: boolean;
  labels?: string[];
  /**
   * When a configured call is not a whole statement (e.g. `fn().chain()`),
   * stripping would break runtime. Controls behavior for those lines.
   * @default "skip"
   */
  chainedCalls?: ChainedCallsPolicy;
}

export interface StripPlugin {
  name: "rolldown-plugin-strip";
  apply: "build";
  enforce: "pre";
  transform: (code: string, id: string) => null | { code: string; map: null };
}

function stripDebuggerStatements(code: string): string {
  // Remove full lines that only contain a debugger statement.
  return code.replace(/^[ \t]*debugger\s*;?[ \t]*\r?\n?/gm, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns index of the `)` that closes the `(` at `openParenIndex`, or -1.
 * Does not parse strings; sufficient for typical strip targets on one line.
 */
function findClosingParen(line: string, openParenIndex: number): number {
  let depth = 0;
  for (let i = openParenIndex; i < line.length; i += 1) {
    const c = line[i];
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function analyzeCallExpressionLine(line: string, fn: string): { matched: boolean; safeRemove: boolean } {
  const wsMatch = /^[ \t]*/.exec(line);
  const wsLen = wsMatch ? wsMatch[0].length : 0;
  if (!line.startsWith(fn, wsLen)) {
    return { matched: false, safeRemove: false };
  }
  const openParen = wsLen + fn.length;
  if (line[openParen] !== "(") {
    return { matched: false, safeRemove: false };
  }
  const closeIdx = findClosingParen(line, openParen);
  if (closeIdx === -1) {
    return { matched: true, safeRemove: false };
  }
  const after = line.slice(closeIdx + 1);
  if (/^[ \t]*(;[ \t]*)?$/.test(after)) {
    return { matched: true, safeRemove: true };
  }
  return { matched: true, safeRemove: false };
}

function stripConfiguredCallExpressions(
  code: string,
  functions: string[],
  chainedCalls: ChainedCallsPolicy,
  moduleId: string
): string {
  const lines = code.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    let replaced = false;
    for (const fn of functions) {
      const { matched, safeRemove } = analyzeCallExpressionLine(line, fn);
      if (!matched) {
        continue;
      }
      if (safeRemove) {
        replaced = true;
        break;
      }
      if (chainedCalls === "error") {
        throw new Error(
          `rolldown-plugin-strip: refusing to strip chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      if (chainedCalls === "warn") {
        console.warn(
          `[rolldown-plugin-strip] skipping strip of chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      break;
    }
    if (!replaced) {
      out.push(line);
    }
  }

  return out.join("\n");
}

/**
 * Finds the closing brace index for a `{` at `openBraceIndex`.
 * Returns -1 if no matching closing brace is found.
 */
function findMatchingBrace(code: string, openBraceIndex: number): number {
  let depth = 0;

  for (let i = openBraceIndex; i < code.length; i += 1) {
    const currentChar = code[i];
    if (currentChar === "{") {
      depth += 1;
    } else if (currentChar === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Removes statements prefixed with configured labels, including labeled blocks.
 */
function stripConfiguredLabels(code: string, labels: string[]): string {
  let output = code;

  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const blockPattern = new RegExp(`(^|\\n)([ \\t]*)${escaped}[ \\t]*:[^\\n\\r]*\\{`, "g");
    let blockMatch = blockPattern.exec(output);

    // Remove block-style labels such as `foo: { ... }` and `label: while (...) { ... }`.
    while (blockMatch) {
      const matchStart = blockMatch.index + blockMatch[1].length;
      const openBraceRelativeIndex = blockMatch[0].lastIndexOf("{");
      const openBraceIndex = blockMatch.index + openBraceRelativeIndex;
      const closeBraceIndex = findMatchingBrace(output, openBraceIndex);
      if (closeBraceIndex === -1) {
        break;
      }

      let removeEnd = closeBraceIndex + 1;
      if (output[removeEnd] === ";") {
        removeEnd += 1;
      }
      if (output[removeEnd] === "\r") {
        removeEnd += 1;
      }
      if (output[removeEnd] === "\n") {
        removeEnd += 1;
      }

      output = output.slice(0, matchStart) + output.slice(removeEnd);
      blockPattern.lastIndex = matchStart;
      blockMatch = blockPattern.exec(output);
    }

    // Remove single-line labeled statements such as `test: doThing();`.
    const statementPattern = new RegExp(`^[ \\t]*${escaped}[ \\t]*:[^\\n\\r]*\\r?\\n?`, "gm");
    output = output.replace(statementPattern, "");
  }

  return output;
}

export function strip(options: StripOptions = {}): StripPlugin {
  return {
    name: "rolldown-plugin-strip",
    apply: "build",
    enforce: "pre",
    transform(code: string, id: string) {
      let stripped = code;

      if (options.debugger) {
        stripped = stripDebuggerStatements(stripped);
      }

      if (options.functions?.length) {
        stripped = stripConfiguredCallExpressions(
          stripped,
          options.functions,
          options.chainedCalls ?? "skip",
          id
        );
      }

      if (options.labels?.length) {
        stripped = stripConfiguredLabels(stripped, options.labels);
      }

      return { code: stripped, map: null };
    }
  };
}
