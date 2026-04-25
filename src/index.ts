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

      return { code: stripped, map: null };
    }
  };
}
