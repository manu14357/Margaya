import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ updateCheck: false }));

vi.mock("../../../apps/api/src/instance-settings/snapshot", () => ({
  getInstanceSettings: () => ({
    effective: { updateCheck: settings.updateCheck },
  }),
}));
vi.mock("../../../apps/api/src/utils/app-version", () => ({
  appVersion: () => "1.4.0",
}));

const {
  fetchLatestRelease,
  getUpdateStatus,
  isNewerVersion,
  parseRelease,
  parseVersion,
  RELEASE_FEED_URL,
  resetUpdateCheck,
} = await import("../../../apps/api/src/observability/update-check");

afterEach(() => {
  settings.updateCheck = false;
  resetUpdateCheck();
});

function release(body: Record<string, unknown>, status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

describe("versions", () => {
  it("parses and compares", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("latest")).toBeNull();
    expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("v2.0.0", "1.99.99")).toBe(true);
    expect(isNewerVersion("1.4.0", "1.4.0")).toBe(false);
    expect(isNewerVersion("1.3.9", "1.4.0")).toBe(false);
    expect(isNewerVersion("1.5.0", "unknown")).toBe(false);
  });
});

describe("parseRelease", () => {
  it("keeps official release links only", () => {
    expect(
      parseRelease({
        tag_name: "v1.5.0",
        html_url: "https://evil.example/phish",
      })?.url,
    ).toBe("https://github.com/manu14357/Margaya/releases/latest");
    expect(
      parseRelease({
        tag_name: "v1.5.0",
        html_url: "https://github.com/manu14357/Margaya/releases/tag/v1.5.0",
        published_at: "2026-10-01T00:00:00Z",
      }),
    ).toEqual({
      version: "1.5.0",
      url: "https://github.com/manu14357/Margaya/releases/tag/v1.5.0",
      publishedAt: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("ignores drafts, prereleases and odd answers", () => {
    expect(parseRelease({ tag_name: "v1.5.0", prerelease: true })).toBeNull();
    expect(parseRelease({ tag_name: "v1.5.0", draft: true })).toBeNull();
    expect(parseRelease({ tag_name: "nightly" })).toBeNull();
    expect(parseRelease("nope")).toBeNull();
  });
});

describe("fetchLatestRelease", () => {
  it("sends only a fixed user agent and accept header", async () => {
    const fetchImpl = release({ tag_name: "v1.5.0" });
    const result = await fetchLatestRelease(fetchImpl as typeof fetch);
    expect(result.release?.version).toBe("1.5.0");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(RELEASE_FEED_URL);
    expect(init?.headers).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "Margaya-update-check",
    });
    expect(init?.body).toBeUndefined();
  });

  it("reports an unreachable feed or a bad answer", async () => {
    const down = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect((await fetchLatestRelease(down as typeof fetch)).error).toBe(
      "unreachable",
    );
    expect(
      (await fetchLatestRelease(release({}, 500) as typeof fetch)).error,
    ).toBe("unreachable");
    expect(
      (await fetchLatestRelease(release({ tag: "x" }) as typeof fetch)).error,
    ).toBe("invalid_response");
  });
});

describe("getUpdateStatus", () => {
  it("fetches nothing while the setting is off", async () => {
    const fetchImpl = release({ tag_name: "v9.0.0" });
    const status = await getUpdateStatus(fetchImpl as typeof fetch);
    expect(status).toMatchObject({
      enabled: false,
      currentVersion: "1.4.0",
      updateAvailable: false,
      latestVersion: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks once and reuses the answer", async () => {
    settings.updateCheck = true;
    const fetchImpl = release({ tag_name: "v1.5.0" });
    const first = await getUpdateStatus(fetchImpl as typeof fetch);
    const second = await getUpdateStatus(fetchImpl as typeof fetch);
    expect(first).toMatchObject({
      enabled: true,
      latestVersion: "1.5.0",
      updateAvailable: true,
      error: null,
    });
    expect(second.checkedAt).toEqual(first.checkedAt);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
