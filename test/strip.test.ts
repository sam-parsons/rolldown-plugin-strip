import { describe, expect, it, vi } from "vitest";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { strip } from "../src/index.js";

function parseSourceMapJson(map: { toString(): string } | null): Record<string, unknown> {
  expect(map).not.toBeNull();
  return JSON.parse(map!.toString()) as Record<string, unknown>;
}

describe("strip", () => {
  it("returns a plugin with stable shape", () => {
    const plugin = strip();

    expect(plugin.name).toBe("rolldown-plugin-strip");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
  });

  it("is a no-op transform when nothing is configured to strip", () => {
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

    expect(transformed?.code).toBe("const x = 1;\nconst y = 2;\n");
    const raw = parseSourceMapJson(transformed!.map as { toString(): string });
    expect(raw.version).toBe(3);
    expect(raw.sources).toEqual(["index.ts"]);
    expect(typeof raw.mappings).toBe("string");
    expect((raw.mappings as string).length).toBeGreaterThan(0);
  });

  it("maps generated lines back to the original source after stripping debugger", () => {
    const plugin = strip({ debugger: true });
    const source = "const x = 1;\ndebugger;\nconst y = 2;\n";
    const transformed = plugin.transform(source, "app.ts")!;
    const map = new TraceMap(JSON.parse(transformed.map!.toString()));
    const pos = originalPositionFor(map, { line: 2, column: 0 });
    expect("line" in pos && pos.line).toBe(3);
    expect("source" in pos && pos.source).toBe("app.ts");
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

    expect(transformed?.code).toBe(
      ["const keep = true;", "logger.info('keep me');", "const x = console.log('keep inline');"].join("\n")
    );
    const raw = parseSourceMapJson(transformed!.map as { toString(): string });
    expect(raw.version).toBe(3);
    expect((raw.mappings as string).length).toBeGreaterThan(0);
  });

  it("skips chained calls by default so stripping does not break runtime", () => {
    const plugin = strip({ functions: ["console.log"] });
    const source = ["console.log('ok');", "console.log('x').then(() => {});", "console.log('tail');"].join("\n");
    const transformed = plugin.transform(source, "chain.ts");

    expect(transformed?.code).toBe("console.log('x').then(() => {});");
    const raw = parseSourceMapJson(transformed!.map as { toString(): string });
    expect(raw.sources).toEqual(["chain.ts"]);
    expect((raw.mappings as string).length).toBeGreaterThan(0);
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
      expect(transformed?.map).toBeNull();
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

    expect(transformed?.code).toBe(["console.log('before');", "console.log('after');"].join("\n"));
    const raw = parseSourceMapJson(transformed!.map as { toString(): string });
    expect((raw.mappings as string).length).toBeGreaterThan(0);
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

    expect(transformed?.code).toBe(["let x = 0;", "let z = 0;", "console.log('kept');"].join("\n"));
    const raw = parseSourceMapJson(transformed!.map as { toString(): string });
    expect((raw.mappings as string).length).toBeGreaterThan(0);
  });
});
