import { describe, expect, it } from "vitest";
import { pythonLiteral, requestSamples, responseSamples } from "./api-samples";
import { findOperation } from "./openapi";

describe("API samples", () => {
  const operation = findOperation("POST", "/task/{projectId}");

  it("generates cURL, JavaScript and Python for an operation", () => {
    expect(operation).not.toBeNull();
    if (!operation) return;
    const [curl, javascript, python] = requestSamples(operation);
    expect(curl?.code).toContain("curl --request POST");
    expect(curl?.code).toContain("/task/{projectId}");
    expect(javascript?.code).toContain('method: "POST"');
    expect(javascript?.code).toContain("body: JSON.stringify({");
    expect(python?.code).toContain("requests.post(");
    expect(python?.code).toContain("json={");
    for (const sample of [curl, javascript, python]) {
      expect(sample?.code).toContain("Bearer <api-key>");
    }
  });

  it("writes JSON as Python literals", () => {
    expect(pythonLiteral({ a: true, b: null, c: [1, "x"] })).toBe(
      '{\n    "a": True,\n    "b": None,\n    "c": [\n        1,\n        "x",\n    ],\n}',
    );
  });

  it("lists example bodies for JSON responses", () => {
    if (!operation) return;
    const responses = responseSamples(operation);
    expect(responses.length).toBeGreaterThan(0);
    expect(() => JSON.parse(responses[0]?.code ?? "")).not.toThrow();
  });
});
