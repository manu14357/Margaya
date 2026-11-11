import { readFile } from "node:fs/promises";
import messages from "../../../i18n/en-US.json";

// The download page is English-only; its copy is the canonical locale's
// `download` namespace.
export const download = messages.download;

const REPOSITORY = "manu14357/Margaya";

export const desktopLinks = {
  releases: `https://github.com/${REPOSITORY}/releases`,
  guide: "/docs/core/functional/desktop-app",
  admin: "/docs/core/installation/desktop-app",
};

export type DesktopFileKey =
  | "macArm"
  | "macIntel"
  | "windowsExe"
  | "windowsMsi"
  | "linuxAppImage"
  | "linuxDeb"
  | "linuxRpm"
  | "linuxArmAppImage"
  | "linuxArmDeb"
  | "linuxArmRpm";

/** Display order on the page. */
export const desktopFileKeys: DesktopFileKey[] = [
  "macArm",
  "macIntel",
  "windowsExe",
  "windowsMsi",
  "linuxAppImage",
  "linuxDeb",
  "linuxRpm",
  "linuxArmAppImage",
  "linuxArmDeb",
  "linuxArmRpm",
];

// The names tauri-action gives the bundles: Margaya_<version>_<arch>... for
// most, Margaya-<version>-<release>.<arch>.rpm for the RPMs. Each Linux
// format names the architectures its own way (amd64/x86_64, arm64/aarch64).
const FILE_PATTERNS: Record<DesktopFileKey, RegExp> = {
  macArm: /^Margaya_[^_]+_aarch64\.dmg$/,
  macIntel: /^Margaya_[^_]+_x64\.dmg$/,
  windowsExe: /^Margaya_[^_]+_x64-setup\.exe$/,
  windowsMsi: /^Margaya_[^_]+_x64_[A-Za-z-]+\.msi$/,
  linuxAppImage: /^Margaya_[^_]+_amd64\.AppImage$/,
  linuxDeb: /^Margaya_[^_]+_amd64\.deb$/,
  linuxRpm: /^Margaya-[^-]+-[^-]+\.x86_64\.rpm$/,
  linuxArmAppImage: /^Margaya_[^_]+_aarch64\.AppImage$/,
  linuxArmDeb: /^Margaya_[^_]+_arm64\.deb$/,
  linuxArmRpm: /^Margaya-[^-]+-[^-]+\.aarch64\.rpm$/,
};

const CHECKSUMS_FILE = "SHA256SUMS.txt";

export type DesktopFile = {
  key: DesktopFileKey;
  name: string;
  url: string;
  size: number;
  /** Lowercase hex, or null when the release publishes none. */
  sha256: string | null;
};

export type DesktopRelease = {
  version: string;
  tag: string;
  notesUrl: string;
  publishedAt: string | null;
  files: DesktopFile[];
};

/** The fields this page reads from the GitHub Releases API. */
export type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: {
    name: string;
    browser_download_url: string;
    size: number;
    digest?: string | null;
  }[];
};

const SHA256 = /^[a-f0-9]{64}$/;

/** Reads `sha256sum` output: `<hex>  <name>` or `<hex> *<name>` per line. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

function digestOf(digest: string | null | undefined) {
  const hex = digest?.startsWith("sha256:")
    ? digest.slice(7).toLowerCase()
    : "";
  return SHA256.test(hex) ? hex : null;
}

/**
 * The desktop files of one release, or null when it has none. Server releases
 * are tagged `v<semver>`; other tags (such as `mcp-v...`) never carry them.
 */
export function toDesktopRelease(
  release: GitHubRelease,
  checksums: Map<string, string> = new Map(),
): DesktopRelease | null {
  if (release.draft || release.prerelease) return null;
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null;

  const files: DesktopFile[] = [];
  for (const key of desktopFileKeys) {
    const asset = release.assets.find((item) =>
      FILE_PATTERNS[key].test(item.name),
    );
    if (!asset) continue;
    files.push({
      key,
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: digestOf(asset.digest) ?? checksums.get(asset.name) ?? null,
    });
  }
  if (files.length === 0) return null;

  return {
    version: release.tag_name.slice(1),
    tag: release.tag_name,
    notesUrl: release.html_url,
    publishedAt: release.published_at,
    files,
  };
}

/** The newest release that carries desktop files. */
export function pickDesktopRelease(releases: GitHubRelease[]) {
  for (const release of releases) {
    const desktop = toDesktopRelease(release);
    if (desktop) return { release, desktop };
  }
  return null;
}

function githubHeaders(): HeadersInit {
  // CI passes a token so shared runners don't hit the anonymous rate limit.
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "margaya-site-build",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchReleases(): Promise<GitHubRelease[]> {
  // A saved Releases API response, for previewing the page with a release
  // before one exists, and offline.
  const file = process.env.DESKTOP_RELEASES_FILE;
  if (file) return JSON.parse(await readFile(file, "utf8")) as GitHubRelease[];

  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`,
    { headers: githubHeaders(), signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return (await response.json()) as GitHubRelease[];
}

/**
 * The latest desktop release, read from GitHub at build time. Returns null
 * (the page then says "Coming soon") when there is none yet or GitHub can't
 * be reached, so an offline build still succeeds.
 */
export async function loadDesktopRelease(): Promise<DesktopRelease | null> {
  try {
    const picked = pickDesktopRelease(await fetchReleases());
    if (!picked) return null;
    if (picked.desktop.files.every((file) => file.sha256)) {
      return picked.desktop;
    }

    // Older assets have no `digest`; fall back to the release's checksum file.
    const sumsAsset = picked.release.assets.find(
      (asset) => asset.name === CHECKSUMS_FILE,
    );
    if (!sumsAsset) return picked.desktop;
    try {
      const sums = await fetch(sumsAsset.browser_download_url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!sums.ok) return picked.desktop;
      return (
        toDesktopRelease(picked.release, parseChecksums(await sums.text())) ??
        picked.desktop
      );
    } catch {
      return picked.desktop;
    }
  } catch (error) {
    console.warn(
      `[download] No desktop release data, showing "Coming soon": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export { fill, formatSize } from "./desktop-system";
