import { afterEach, describe, expect, it, vi } from "vitest";
import { appVersion } from "../../../apps/api/src/utils/app-version";
import { desktopConfig } from "../../../apps/api/src/utils/desktop-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("desktop config", () => {
  it("defaults to enabled, the release version and minimum 0.1.0", () => {
    vi.stubEnv("DESKTOP_SIGN_IN_ENABLED", "");
    vi.stubEnv("DESKTOP_MIN_VERSION", "");
    vi.stubEnv("MARGAYA_VERSION", "");
    vi.stubEnv("MARGAYA_API_URL", "https://api.example.test/api/");
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://app.example.test/");
    expect(desktopConfig()).toEqual({
      enabled: true,
      serverVersion: appVersion(),
      minDesktopVersion: "0.1.0",
      webUrl: "https://app.example.test",
      apiUrl: "https://api.example.test",
    });
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("follows the environment", () => {
    vi.stubEnv("DESKTOP_SIGN_IN_ENABLED", "FALSE");
    vi.stubEnv("DESKTOP_MIN_VERSION", "1.2.3");
    vi.stubEnv("MARGAYA_VERSION", "2.0.0-rc.1");
    expect(desktopConfig()).toMatchObject({
      enabled: false,
      serverVersion: "2.0.0-rc.1",
      minDesktopVersion: "1.2.3",
    });
  });

  it("ignores a minimum that isn't a version", () => {
    vi.stubEnv("DESKTOP_MIN_VERSION", "latest");
    expect(desktopConfig().minDesktopVersion).toBe("0.1.0");
  });
});
