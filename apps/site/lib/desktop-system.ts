// Client-safe: no copy or Node imports, so the download picker can use it.

import type { DesktopFileKey } from "./desktop-release";

export type DetectedSystem = "macos" | "windows" | "linux" | "other";

/**
 * The visitor's system from the user agent. iPhones, iPads (which can report
 * a Mac user agent, but have touch), Android devices and Chromebooks count
 * as "other".
 */
export function detectSystem(
  userAgent: string,
  maxTouchPoints = 0,
): DetectedSystem {
  if (/iPhone|iPad|iPod|Android|CrOS/i.test(userAgent)) return "other";
  if (/Macintosh|Mac OS X/.test(userAgent)) {
    return maxTouchPoints > 1 ? "other" : "macos";
  }
  if (/Windows NT/.test(userAgent)) return "windows";
  if (/Linux|X11/.test(userAgent)) return "linux";
  return "other";
}

/**
 * Whether a Linux computer is an ARM one (aarch64), from the user agent.
 * Browsers that hide the architecture count as x86_64, the far more common
 * case; the other build is listed right below.
 */
export function isArmLinux(userAgent: string): boolean {
  return /aarch64|arm64|armv8/i.test(userAgent);
}

/** The Linux files, x86_64 and ARM, by format. */
export const linuxFileKeys = {
  x64: { appImage: "linuxAppImage", deb: "linuxDeb", rpm: "linuxRpm" },
  arm: {
    appImage: "linuxArmAppImage",
    deb: "linuxArmDeb",
    rpm: "linuxArmRpm",
  },
} as const satisfies Record<
  "x64" | "arm",
  Record<"appImage" | "deb" | "rpm", DesktopFileKey>
>;

type UserAgentData = {
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string }>;
};

/**
 * Whether a Mac is an Intel one. Only Chromium browsers can tell; Safari and
 * Firefox report "Intel" on every Mac, so anything unknown counts as Apple
 * Silicon (every Mac sold since 2023), and the picker offers the Intel file
 * right below.
 */
export async function isIntelMac(): Promise<boolean> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData })
    .userAgentData;
  if (!data?.getHighEntropyValues) return false;
  try {
    const { architecture } = await data.getHighEntropyValues(["architecture"]);
    return architecture === "x86";
  } catch {
    return false;
  }
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fills `{{name}}` placeholders in a copy string. */
export function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}
