import { describe, expect, it } from "vitest";
import { isDesktopAppUserAgent, summarizeUserAgent } from "./user-agent";

describe("summarizeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "Windows", mobile: false },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      { browser: "Edge", os: "Windows", mobile: false },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      { browser: "Safari", os: "macOS", mobile: false },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
      { browser: "Firefox", os: "Linux", mobile: false },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
      { browser: "Chrome", os: "iOS", mobile: true },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
      { browser: "Chrome", os: "Android", mobile: true },
    ],
  ])("reads %s", (ua, expected) => {
    expect(summarizeUserAgent(ua)).toEqual(expected);
  });

  it("knows nothing about a missing or unusual agent", () => {
    expect(summarizeUserAgent(null)).toEqual({
      browser: null,
      os: null,
      mobile: false,
    });
    expect(summarizeUserAgent("curl/8.6.0")).toEqual({
      browser: null,
      os: null,
      mobile: false,
    });
  });
});

describe("isDesktopAppUserAgent", () => {
  it("knows the desktop app's own requests", () => {
    expect(isDesktopAppUserAgent("MargayaDesktop/0.1.0")).toBe(true);
    expect(
      isDesktopAppUserAgent(
        "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0",
      ),
    ).toBe(false);
    expect(isDesktopAppUserAgent(null)).toBe(false);
  });
});
