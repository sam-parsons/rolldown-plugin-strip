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
    const plugin = strip({ functions: ["console.log", "logger.debug"] });
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

  it("removes configured labeled blocks", () => {
    const plugin = strip({ labels: ["dev"] });
    const source = [
      "const before = 1;",
      "dev: {",
      "  console.log('remove block');",
      "}",
      "const after = 2;"
    ].join("\n");
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: ["const before = 1;", "const after = 2;"].join("\n"),
      map: null
    });
  });

  it("removes configured non-block labeled statements", () => {
    const plugin = strip({ labels: ["test"] });
    const source = [
      "const before = 1;",
      "test: doThing();",
      "prod: doNotRemove();",
      "const after = 2;"
    ].join("\n");
    const transformed = plugin.transform(source, "index.ts");

    expect(transformed).toEqual({
      code: ["const before = 1;", "prod: doNotRemove();", "const after = 2;"].join("\n"),
      map: null
    });
  });
});
