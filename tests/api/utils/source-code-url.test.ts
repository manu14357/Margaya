import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_CODE_URL,
  sourceCodeUrl,
} from "../../../apps/api/src/utils/source-code-url";

describe("sourceCodeUrl", () => {
  it("uses the official repository when unset or blank", () => {
    expect(sourceCodeUrl(undefined)).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl("   ")).toBe(DEFAULT_SOURCE_CODE_URL);
  });

  it("uses a configured HTTP(S) repository", () => {
    expect(sourceCodeUrl(" https://git.example.com/acme/margaya ")).toBe(
      "https://git.example.com/acme/margaya",
    );
    expect(sourceCodeUrl("http://10.0.0.5/margaya")).toBe(
      "http://10.0.0.5/margaya",
    );
  });

  it("ignores invalid or non-HTTP(S) values", () => {
    expect(sourceCodeUrl("not a url")).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl("javascript:alert(1)")).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl("ftp://example.com/src")).toBe(
      DEFAULT_SOURCE_CODE_URL,
    );
  });
});
