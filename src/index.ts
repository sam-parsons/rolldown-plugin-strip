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

export function strip(options: StripOptions = {}): StripPlugin {
  void options;

  return {
    name: "rolldown-plugin-strip",
    apply: "build",
    enforce: "pre",
    transform(code: string, _id: string) {
      return { code, map: null };
    }
  };
}
