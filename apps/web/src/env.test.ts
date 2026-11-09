import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function renderBundle(
  bundle: string,
  key = "",
  publicSiteUrl = "",
  sentryDsn = "",
) {
  return execFileSync(
    "awk",
    ["-f", resolve(import.meta.dirname, "../env.awk")],
    {
      input: bundle,
      encoding: "utf8",
      env: {
        ...process.env,
        MARGAYA_TURNSTILE_SITE_KEY: key,
        MARGAYA_API_URL: "https://api.example.test",
        MARGAYA_CLIENT_URL: "https://app.example.test",
        MARGAYA_PUBLIC_SITE_URL: publicSiteUrl,
        MARGAYA_SENTRY_DSN: sentryDsn,
      },
    },
  );
}
describe("runtime environment replacement", () => {
  it("clears unset optional placeholders for every emitted literal quote", () => {
    const rendered = renderBundle(
      "globalThis.values = [\"MARGAYA_TURNSTILE_SITE_KEY\", 'MARGAYA_TURNSTILE_SITE_KEY', `MARGAYA_TURNSTILE_SITE_KEY`, 'https://example.test'];",
    );
    const context: { values?: string[] } = {};
    runInNewContext(rendered, context);
    expect(context.values).toEqual(["", "", "", "https://example.test"]);
  });
  it("encodes configured punctuation as literal data rather than JavaScript", () => {
    const key = '";globalThis.injected=true;//\\\n`';
    const context: { value?: string; injected?: boolean } = {};
    runInNewContext(
      renderBundle('globalThis.value = "MARGAYA_TURNSTILE_SITE_KEY";', key),
      context,
    );
    expect(context.value).toBe(key);
    expect(context.injected).toBeUndefined();
  });
  it("replaces the public site URL, or clears it when unset", () => {
    const bundle = 'globalThis.value = "MARGAYA_PUBLIC_SITE_URL";';
    const configured: { value?: string } = {};
    runInNewContext(
      renderBundle(bundle, "", "http://localhost:3001"),
      configured,
    );
    expect(configured.value).toBe("http://localhost:3001");
    const unset: { value?: string } = {};
    runInNewContext(renderBundle(bundle), unset);
    expect(unset.value).toBe("");
  });
  it("marks only files it filled in, for nginx's cache list", () => {
    const dir = mkdtempSync(join(tmpdir(), "margaya-env-"));
    try {
      const filled = (bundle: string) => {
        const marker = join(dir, `${Math.random()}.filled`);
        execFileSync(
          "awk",
          ["-f", resolve(import.meta.dirname, "../env.awk")],
          {
            input: bundle,
            env: { ...process.env, MARGAYA_ENV_MARKER: marker },
          },
        );
        return existsSync(marker);
      };
      expect(filled('globalThis.value = "MARGAYA_API_URL/api";')).toBe(true);
      // An unset value still makes the file deployment-specific.
      expect(filled('globalThis.value = "MARGAYA_SENTRY_DSN";')).toBe(true);
      expect(filled('globalThis.value = "MARGAYA_OTHER";')).toBe(false);
      expect(filled("globalThis.value = 1")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("replaces the Sentry DSN, or clears it when unset", () => {
    const bundle = 'globalThis.value = "MARGAYA_SENTRY_DSN";';
    const dsn = "https://public@errors.example.test/1";
    const configured: { value?: string } = {};
    runInNewContext(renderBundle(bundle, "", "", dsn), configured);
    expect(configured.value).toBe(dsn);
    const unset: { value?: string } = {};
    runInNewContext(renderBundle(bundle), unset);
    expect(unset.value).toBe("");
  });
});
