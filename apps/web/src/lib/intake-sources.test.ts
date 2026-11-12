import { describe, expect, it } from "vitest";
import {
  formatDomains,
  megabytes,
  parseDomainInput,
  parsePort,
  requestFormUrl,
} from "./intake-sources";

describe("intake source helpers", () => {
  it("reads domain lists in any separator", () => {
    expect(
      parseDomainInput("Acme.com, beta.org\n acme.com  x.io;y.io"),
    ).toEqual(["acme.com", "beta.org", "x.io", "y.io"]);
    expect(parseDomainInput("  ")).toEqual([]);
    expect(formatDomains(["a.com", "b.org"])).toBe("a.com\nb.org");
  });

  it("builds form links", () => {
    expect(requestFormUrl("/request-form/abc", "https://pm.example/")).toBe(
      "https://pm.example/request-form/abc",
    );
    expect(requestFormUrl(null, "https://pm.example")).toBe("");
  });

  it("formats limits and reads ports", () => {
    expect(megabytes(25 * 1024 * 1024)).toBe(25);
    expect(megabytes(10)).toBe(1);
    expect(parsePort("")).toBeNull();
    expect(parsePort("993")).toBe(993);
    expect(parsePort("0")).toBe("invalid");
    expect(parsePort("70000")).toBe("invalid");
    expect(parsePort("ab")).toBe("invalid");
  });
});
