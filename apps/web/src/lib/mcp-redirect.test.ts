import { describe, expect, it } from "vitest";
import { isLoopbackRedirect } from "./mcp-redirect";

describe("isLoopbackRedirect", () => {
  it("flags redirects to this computer only", () => {
    expect(isLoopbackRedirect("http://127.0.0.1:3000/cb")).toBe(true);
    expect(isLoopbackRedirect("http://localhost/cb")).toBe(true);
    expect(isLoopbackRedirect("http://[::1]:8080/cb")).toBe(true);
    expect(isLoopbackRedirect("https://app.example.com/cb")).toBe(false);
    expect(isLoopbackRedirect("myapp://callback")).toBe(false);
    expect(isLoopbackRedirect("not a url")).toBe(false);
    expect(isLoopbackRedirect(undefined)).toBe(false);
  });
});
