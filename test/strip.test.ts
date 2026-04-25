import { describe, expect, it } from "vitest";
import { strip } from "../src/index.js";

describe("strip", () => {
  it("returns a plugin with stable shape", () => {
    const plugin = strip();

    expect(plugin.name).toBe("rolldown-plugin-strip");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
  });

  it("is currently a no-op transform", () => {
    const plugin = strip({
      functions: ["console.log"],
      debugger: false,
      labels: ["dev"]
    });
    const source = "console.log('hello'); debugger;";
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: source,
      map: null
    });
  });

  it("removes debugger statements when enabled", () => {
    const plugin = strip({ debugger: true });
    const source = "const x = 1;\ndebugger;\nconst y = 2;\n";
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: "const x = 1;\nconst y = 2;\n",
      map: null
    });
  });
});
