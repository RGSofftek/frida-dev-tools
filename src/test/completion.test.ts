import { describe, expect, it } from "vitest";
import {
  buildReaderFunctionItems,
  FridaReader,
  inferVariantSuffix,
} from "../completionHelpers";

const completionParams = {
  textDocument: { uri: "file:///tmp.txt" },
  position: { line: 0, character: 7 },
} as any;

function makeReader(): FridaReader {
  return {
    keyword: "SAP",
    name: "SAP Reader",
    functions: [
      {
        name: "WriteText",
        description: "Writes text",
        syntax: [
          {
            raw: "SAP WriteText id <id> Text <text>",
            stripped: "WriteText id <id> Text <text>",
            syntaxSource: "docs",
          },
          {
            raw: "SAP WriteText te <label> Text <text>",
            stripped: "WriteText te <label> Text <text>",
            syntaxSource: "docs",
          },
        ],
      },
      {
        name: "WriteValue",
        description: "Writes value",
        syntax: [
          {
            raw: "SAP WriteValue id <id> Value <val>",
            stripped: "WriteValue id <id> Value <val>",
            syntaxSource: "readers",
          },
        ],
      },
      {
        name: "Wildcard",
        description: "No syntax documented",
        syntax: [],
      },
    ],
  };
}

describe("buildReaderFunctionItems", () => {
  it("returns all variants after keyword", () => {
    const items = buildReaderFunctionItems(makeReader(), completionParams, "after-keyword");
    expect(items.length).toBe(4);
  });

  it("filters by partial token", () => {
    const items = buildReaderFunctionItems(
      makeReader(),
      completionParams,
      "partial-token",
      "writ",
      4,
    );
    expect(items.every((item) => item.label.toLowerCase().startsWith("write"))).toBe(true);
  });

  it("uses textEdit for partial token context", () => {
    const items = buildReaderFunctionItems(
      makeReader(),
      completionParams,
      "partial-token",
      "wri",
      4,
    );
    expect(items.some((item) => item.textEdit !== undefined)).toBe(true);
  });

  it("uses raw syntax at line start", () => {
    const items = buildReaderFunctionItems(makeReader(), completionParams, "line-start");
    const item = items.find((x) => x.detail === "SAP WriteText id <id> Text <text>");
    expect(item?.insertText).toBe("SAP WriteText id <id> Text <text>");
  });

  it("uses stripped syntax after keyword", () => {
    const items = buildReaderFunctionItems(makeReader(), completionParams, "after-keyword");
    const item = items.find((x) => x.detail === "SAP WriteText id <id> Text <text>");
    expect(item?.insertText).toBe("WriteText id <id> Text <text>");
  });

  it("sorts docs before readers before missing", () => {
    const items = buildReaderFunctionItems(makeReader(), completionParams, "after-keyword");
    const docs = items.find((item) => item.detail === "SAP WriteText id <id> Text <text>");
    const readers = items.find((item) => item.detail === "SAP WriteValue id <id> Value <val>");
    const missing = items.find((item) => item.detail === "(no documented syntax)");
    expect(docs?.sortText?.startsWith("1-")).toBe(true);
    expect(readers?.sortText?.startsWith("2-")).toBe(true);
    expect(missing?.sortText?.startsWith("3-")).toBe(true);
  });
});

describe("inferVariantSuffix", () => {
  it("returns deterministic suffix", () => {
    expect(inferVariantSuffix("SAP WriteText id <id> Text <text>", "WriteText", 0)).toBe(
      "-- id <id>",
    );
    expect(inferVariantSuffix("Unknown format", "WriteText", 1)).toBe("(2)");
  });
});
