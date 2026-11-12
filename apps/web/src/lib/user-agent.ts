export type DeviceSummary = {
  browser: string | null;
  os: string | null;
  mobile: boolean;
};

// Order matters: Edge and Opera also say "Chrome", and Chrome says "Safari".
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/** A browser and operating system read from a user agent, for display only. */
export function summarizeUserAgent(
  userAgent: string | null | undefined,
): DeviceSummary {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  return { browser, os, mobile: /Mobi|iPhone|iPad|Android/.test(ua) };
}

/** The Margaya Desktop app's own requests (its sign-in and live updates). */
export function isDesktopAppUserAgent(
  userAgent: string | null | undefined,
): boolean {
  return /\bMargayaDesktop\//.test(userAgent ?? "");
}
