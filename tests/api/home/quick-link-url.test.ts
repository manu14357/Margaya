import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  quickLinkTitle,
  requireQuickLinkUrl,
} from "../../../apps/api/src/quick-link/controllers/shared";

function rejection(raw: string) {
  try {
    requireQuickLinkUrl(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    return {
      status: (error as HTTPException).status,
      message: (error as HTTPException).message,
    };
  }
  throw new Error(`${raw} was accepted`);
}

describe("quick link URL", () => {
  it("adds https:// when the scheme is missing", () => {
    expect(requireQuickLinkUrl("example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(requireQuickLinkUrl("  localhost:3000/x ")).toBe(
      "https://localhost:3000/x",
    );
  });

  it("keeps the parser's normalized form", () => {
    expect(requireQuickLinkUrl("HTTP://Docs.Example.COM:80/A")).toBe(
      "http://docs.example.com/A",
    );
    expect(requireQuickLinkUrl("https://bücher.example")).toBe(
      "https://xn--bcher-kva.example/",
    );
  });

  it("accepts only http and https with a host and no credentials", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com/file",
      "https://ada:secret@example.com",
      "https://",
      "   ",
    ]) {
      expect(rejection(raw)).toEqual({
        status: 400,
        message: "Enter a valid web address (http or https)",
      });
    }
  });

  it("refuses a normalized URL over 2,048 characters", () => {
    const path = "a".repeat(2_040);
    expect(rejection(`example.com/${path}`).status).toBe(400);
  });

  it("trims titles and turns blank ones into null", () => {
    expect(quickLinkTitle("  Docs  ")).toBe("Docs");
    expect(quickLinkTitle("   ")).toBeNull();
    expect(quickLinkTitle(null)).toBeNull();
    expect(quickLinkTitle(undefined)).toBeNull();
  });
});
