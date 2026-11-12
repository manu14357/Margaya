import { getInstanceSettings } from "../instance-settings/snapshot";
import { appVersion } from "../utils/app-version";

// The opt-in update notice (instance setting general.updateCheck, env
// MARGAYA_UPDATE_CHECK). Off by default. When on, the server asks the public
// release feed for the latest release at most once a day. The request carries
// no instance name, URL, version, id or counts: only a fixed User-Agent, as
// the feed requires one. The answer stays in memory and is shown to instance
// admins only.

export const RELEASE_FEED_URL =
  "https://api.github.com/repos/manu14357/Margaya/releases/latest";
const RELEASE_PAGE_PREFIX = "https://github.com/manu14357/Margaya/releases/";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// A failed check retries sooner than a day, but not on every page view.
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const TICK_MS = 60 * 60 * 1000;

export type UpdateCheckError = "unreachable" | "invalid_response";

export type LatestRelease = {
  version: string;
  url: string;
  publishedAt: Date | null;
};

type CheckState = {
  checkedAt: Date;
  release: LatestRelease | null;
  error: UpdateCheckError | null;
};

let state: CheckState | null = null;
let inFlight: Promise<CheckState> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function updateCheckEnabled(): boolean {
  return getInstanceSettings().effective.updateCheck;
}

/** "v1.2.3" or "1.2.3-beta.1" → [1, 2, 3]; null when it isn't a version. */
export function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `latest` is a newer release than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const running = parseVersion(current);
  if (!next || !running) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = next[index] ?? 0;
    const b = running[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** The fields the notice needs; anything unexpected reads as no answer. */
export function parseRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== "object") return null;
  const release = body as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const parsed = parseVersion(tag);
  if (!parsed) return null;
  const htmlUrl = typeof release.html_url === "string" ? release.html_url : "";
  const published =
    typeof release.published_at === "string"
      ? new Date(release.published_at)
      : null;
  return {
    version: parsed.join("."),
    // Only ever link to the official release pages.
    url: htmlUrl.startsWith(RELEASE_PAGE_PREFIX)
      ? htmlUrl
      : `${RELEASE_PAGE_PREFIX}latest`,
    publishedAt:
      published && !Number.isNaN(published.getTime()) ? published : null,
  };
}

type Fetch = typeof fetch;

export async function fetchLatestRelease(
  fetchImpl: Fetch = fetch,
): Promise<CheckState> {
  const checkedAt = new Date();
  let response: Response;
  try {
    response = await fetchImpl(RELEASE_FEED_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Margaya-update-check",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { checkedAt, release: null, error: "unreachable" };
  }
  if (!response.ok) {
    return {
      checkedAt,
      release: null,
      error: response.status === 404 ? "invalid_response" : "unreachable",
    };
  }
  try {
    const release = parseRelease(await response.json());
    return release
      ? { checkedAt, release, error: null }
      : { checkedAt, release: null, error: "invalid_response" };
  } catch {
    return { checkedAt, release: null, error: "invalid_response" };
  }
}

function isStale(current: CheckState | null, now: number): boolean {
  if (!current) return true;
  const age = now - current.checkedAt.getTime();
  return age >= (current.error ? RETRY_AFTER_FAILURE_MS : CHECK_INTERVAL_MS);
}

/** Checks now when the last answer is old; one request at a time. */
export async function refreshIfStale(fetchImpl: Fetch = fetch): Promise<void> {
  if (!updateCheckEnabled() || !isStale(state, Date.now())) return;
  if (!inFlight) {
    inFlight = fetchLatestRelease(fetchImpl)
      .then((next) => {
        state = next;
        return next;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  await inFlight;
}

export type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: Date | null;
  checkedAt: Date | null;
  error: UpdateCheckError | null;
};

export async function getUpdateStatus(
  fetchImpl: Fetch = fetch,
): Promise<UpdateStatus> {
  const currentVersion = appVersion();
  const enabled = updateCheckEnabled();
  if (enabled) await refreshIfStale(fetchImpl);
  const current = enabled ? state : null;
  const release = current?.release ?? null;
  return {
    enabled,
    currentVersion,
    latestVersion: release?.version ?? null,
    updateAvailable: release
      ? isNewerVersion(release.version, currentVersion)
      : false,
    releaseUrl: release?.url ?? null,
    publishedAt: release?.publishedAt ?? null,
    checkedAt: current?.checkedAt ?? null,
    error: current?.error ?? null,
  };
}

/** Checks in the background while the setting is on (an hourly look). */
export function startUpdateChecks(): void {
  if (timer) return;
  const tick = () => {
    void refreshIfStale().catch(() => {});
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  // Not at the very first moment of startup; the first tick is soon enough
  // unless an admin opens the page earlier.
  setTimeout(tick, 60_000).unref?.();
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test hook. */
export function resetUpdateCheck(): void {
  state = null;
  inFlight = null;
  stopUpdateChecks();
}
