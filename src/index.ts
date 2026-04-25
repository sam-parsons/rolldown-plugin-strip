export interface StripOptions {
  functions?: string[];
  debugger?: boolean;
  labels?: string[];
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

function stripConfiguredCallExpressions(code: string, functions: string[]): string {
  let output = code;

  for (const fn of functions) {
    const escaped = escapeRegExp(fn);
    const pattern = new RegExp(`^[ \\t]*${escaped}\\s*\\([^\\n\\r;]*\\)\\s*;?[ \\t]*\\r?\\n?`, "gm");
    output = output.replace(pattern, "");
  }

  return output;
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
    transform(code: string, _id: string) {
      let stripped = code;

      if (options.debugger) {
        stripped = stripDebuggerStatements(stripped);
      }

      if (options.functions?.length) {
        stripped = stripConfiguredCallExpressions(stripped, options.functions);
      }

      if (options.labels?.length) {
        stripped = stripConfiguredLabels(stripped, options.labels);
      }

      return { code: stripped, map: null };
    }
  };
}
