import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyJsonToYDoc,
  jsonToMarkdown,
  jsonToPlainText,
  jsonToYDoc,
  markdownToJson,
  referencesFromJson,
  yDocToJson,
} from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "custom-nodes.md"),
  "utf8",
);

describe("headless", () => {
  it("runs every conversion without a DOM", () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();

    const json = markdownToJson(fixture);
    const doc = jsonToYDoc(json);
    applyJsonToYDoc(doc, markdownToJson("# Replaced"));
    jsonToMarkdown(yDocToJson(doc));
    jsonToPlainText(json);
    referencesFromJson(json);

    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
  });
});
