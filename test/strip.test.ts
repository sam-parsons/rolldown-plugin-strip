import { describe, expect, it, vi } from "vitest";
import { strip } from "../src/index.js";

describe("strip", () => {
  it("returns a plugin with stable shape", () => {
    const plugin = strip();

    expect(plugin.name).toBe("rolldown-plugin-strip");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
  });

  it("is currently a no-op transform", () => {
    const plugin = strip();
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

  it("removes configured call expression statements", () => {
    const plugin = strip({ functions: ["console.log", "logger.debug"], chainedCalls: "skip" });
    const source = [
      "const keep = true;",
      "console.log('remove me');",
      "logger.debug('also remove');",
      "logger.info('keep me');",
      "const x = console.log('keep inline');"
    ].join("\n");
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: [
        "const keep = true;",
        "logger.info('keep me');",
        "const x = console.log('keep inline');"
      ].join("\n"),
      map: null
    });
  });

  it("skips chained calls by default so stripping does not break runtime", () => {
    const plugin = strip({ functions: ["console.log"] });
    const source = ["console.log('ok');", "console.log('x').then(() => {});", "console.log('tail');"].join("\n");
    const transformed = plugin.transform(source, "chain.ts");

    expect(transformed).toEqual({
      code: "console.log('x').then(() => {});",
      map: null
    });
  });

  it("throws on chained calls when chainedCalls is error", () => {
    const plugin = strip({ functions: ["console.log"], chainedCalls: "error" });
    const source = "console.log('x').then(() => {});";

    expect(() => plugin.transform(source, "bad.ts")).toThrow(/refusing to strip chained/);
  });

  it("warns on chained calls when chainedCalls is warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const plugin = strip({ functions: ["console.log"], chainedCalls: "warn" });
      const source = "console.log('x').then(() => {});";
      const transformed = plugin.transform(source, "warn.ts");

      expect(transformed?.code).toBe(source);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("removes configured labeled blocks (MDN-style)", () => {
    const plugin = strip({ labels: ["foo"] });
    const source = [
      "console.log('before');",
      "foo: {",
      "  console.log('face');",
      "  break foo;",
      "  console.log('this will not run');",
      "}",
      "console.log('after');"
    ].join("\n");
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: ["console.log('before');", "console.log('after');"].join("\n"),
      map: null
    });
  });

  it("removes configured non-block labeled statements (MDN-style)", () => {
    const plugin = strip({ labels: ["labelCancelLoops"] });
    const source = [
      "let x = 0;",
      "let z = 0;",
      "labelCancelLoops: while (x < 2) {",
      "  x += 1;",
      "  z += 1;",
      "}",
      "console.log('kept');"
    ].join("\n");
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: ["let x = 0;", "let z = 0;", "console.log('kept');"].join("\n"),
      map: null
    });
  });
});
