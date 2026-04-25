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

export function strip(options: StripOptions = {}): StripPlugin {
  return {
    name: "rolldown-plugin-strip",
    apply: "build",
    enforce: "pre",
    transform(code: string, _id: string) {
      if (!options.debugger) {
        return { code, map: null };
      }

      const stripped = stripDebuggerStatements(code);
      return { code: stripped, map: null };
    }
  };
}
