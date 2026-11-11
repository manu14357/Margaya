import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type GitHubRelease,
  loadDesktopRelease,
  parseChecksums,
  pickDesktopRelease,
  toDesktopRelease,
} from "./desktop-release";
import { detectSystem, isArmLinux } from "./desktop-system";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function asset(name: string, digest?: string) {
  return {
    name,
    browser_download_url: `https://example.com/download/${name}`,
    size: 12_345_678,
    digest,
  };
}

function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: "v1.4.0",
    html_url: "https://example.com/releases/v1.4.0",
    draft: false,
    prerelease: false,
    published_at: "2026-11-10T12:00:00Z",
    assets: [
      asset("Margaya_1.4.0_aarch64.dmg", `sha256:${HASH}`),
      asset("Margaya_1.4.0_x64.dmg"),
      asset("Margaya_1.4.0_x64-setup.exe"),
      asset("Margaya_1.4.0_x64_en-US.msi"),
      asset("Margaya_1.4.0_amd64.AppImage"),
      asset("Margaya_1.4.0_amd64.deb"),
      asset("Margaya-1.4.0-1.x86_64.rpm"),
      asset("Margaya_1.4.0_aarch64.AppImage"),
      asset("Margaya_1.4.0_arm64.deb"),
      asset("Margaya-1.4.0-1.aarch64.rpm"),
      asset("Margaya_1.4.0_x64-setup.exe.sig"),
      asset("Margaya_1.4.0_amd64.AppImage.sig"),
      asset("Margaya_1.4.0_amd64.deb.sig"),
      asset("Margaya-1.4.0-1.x86_64.rpm.sig"),
      asset("Margaya_aarch64.app.tar.gz"),
      asset("latest.json"),
      asset("SHA256SUMS.txt"),
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("desktop release", () => {
  it("maps every installer and ignores updater files", () => {
    const desktop = toDesktopRelease(release());
    expect(desktop?.version).toBe("1.4.0");
    expect(desktop?.files.map((file) => [file.key, file.name])).toEqual([
      ["macArm", "Margaya_1.4.0_aarch64.dmg"],
      ["macIntel", "Margaya_1.4.0_x64.dmg"],
      ["windowsExe", "Margaya_1.4.0_x64-setup.exe"],
      ["windowsMsi", "Margaya_1.4.0_x64_en-US.msi"],
      ["linuxAppImage", "Margaya_1.4.0_amd64.AppImage"],
      ["linuxDeb", "Margaya_1.4.0_amd64.deb"],
      ["linuxRpm", "Margaya-1.4.0-1.x86_64.rpm"],
      ["linuxArmAppImage", "Margaya_1.4.0_aarch64.AppImage"],
      ["linuxArmDeb", "Margaya_1.4.0_arm64.deb"],
      ["linuxArmRpm", "Margaya-1.4.0-1.aarch64.rpm"],
    ]);
  });

  it("lists a release with only some Linux files", () => {
    const desktop = toDesktopRelease(
      release({
        assets: [
          asset("Margaya_1.4.0_amd64.AppImage"),
          asset("Margaya_1.4.0_amd64.AppImage.sig"),
          asset("Margaya-1.4.0-1.x86_64.rpm"),
        ],
      }),
    );
    expect(desktop?.files.map((file) => file.key)).toEqual([
      "linuxAppImage",
      "linuxRpm",
    ]);
  });

  it("takes checksums from the asset digest, then from SHA256SUMS.txt", () => {
    const sums = parseChecksums(
      `${OTHER_HASH}  Margaya_1.4.0_x64.dmg\r\n${HASH} *Margaya_1.4.0_aarch64.dmg\n`,
    );
    const files = toDesktopRelease(release(), sums)?.files ?? [];
    expect(files.find((f) => f.key === "macArm")?.sha256).toBe(HASH);
    expect(files.find((f) => f.key === "macIntel")?.sha256).toBe(OTHER_HASH);
    expect(files.find((f) => f.key === "windowsExe")?.sha256).toBeNull();
  });

  it("skips drafts, prereleases, MCP releases and releases without installers", () => {
    const releases = [
      release({ tag_name: "v1.6.0", draft: true }),
      release({ tag_name: "v1.5.1", prerelease: true }),
      release({ tag_name: "mcp-v0.9.0" }),
      release({ tag_name: "v1.5.0", assets: [asset("CHANGELOG.md")] }),
      release(),
    ];
    expect(pickDesktopRelease(releases)?.desktop.tag).toBe("v1.4.0");
    expect(pickDesktopRelease(releases.slice(0, 4))).toBeNull();
  });

  it("returns null instead of failing when GitHub can't be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(loadDesktopRelease()).resolves.toBeNull();
  });

  it("returns null when there is no release yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    await expect(loadDesktopRelease()).resolves.toBeNull();
  });
  it("reads a saved Releases API response instead of GitHub when asked", async () => {
    const file = join(
      mkdtempSync(join(tmpdir(), "desktop-release-")),
      "r.json",
    );
    writeFileSync(file, JSON.stringify([release()]));
    vi.stubEnv("DESKTOP_RELEASES_FILE", file);
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const desktop = await loadDesktopRelease();
    expect(desktop?.version).toBe("1.4.0");
    expect(desktop?.files).toHaveLength(10);
    // Only the files without a digest send it looking for SHA256SUMS.txt.
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0]?.[0])).toContain("SHA256SUMS.txt");
  });
});

describe("detectSystem", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      0,
      "macos",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      0,
      "windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      5,
      "other",
    ],
    // iPadOS asks for the desktop site with a Mac user agent.
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      5,
      "other",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", 0, "linux"],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101",
      0,
      "linux",
    ],
    ["Mozilla/5.0 (X11; Linux aarch64; rv:133.0) Gecko/20100101", 0, "linux"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36", 5, "other"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36", 0, "other"],
  ])("%s → %s", (userAgent, touch, expected) => {
    expect(detectSystem(userAgent, touch)).toBe(expected);
  });

  it("tells ARM Linux computers apart", () => {
    expect(isArmLinux("Mozilla/5.0 (X11; Linux aarch64; rv:133.0)")).toBe(true);
    expect(isArmLinux("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
