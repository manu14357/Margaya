import { describe, expect, it } from "vitest";
import {
  assertFetchableUrl,
  extractPageTitle,
  fetchPageTitle,
  PageTitleError,
  publicOnlyLookup,
} from "../../../apps/api/src/utils/fetch-page-title";

describe("extractPageTitle", () => {
  it("reads the title, decoded and on one line", () => {
    expect(
      extractPageTitle(
        "<html><head><title>\n  Tom &amp; Jerry &#8211; &quot;Home&quot;\n</title></head>",
      ),
    ).toBe('Tom & Jerry – "Home"');
  });

  it("falls back to og:title and answers null without one", () => {
    expect(
      extractPageTitle('<meta property="og:title" content="Release notes">'),
    ).toBe("Release notes");
    expect(extractPageTitle("<html><body>No head</body></html>")).toBeNull();
    expect(extractPageTitle("<title>   </title>")).toBeNull();
  });
});

describe("assertFetchableUrl", () => {
  const refused = (url: string) => {
    try {
      assertFetchableUrl(new URL(url));
      return null;
    } catch (error) {
      return error instanceof PageTitleError ? error.reason : "other";
    }
  };

  it("allows public http(s) URLs on standard ports", () => {
    expect(refused("https://example.com/page")).toBeNull();
    expect(refused("http://example.com:80/")).toBeNull();
  });

  it("refuses other schemes, logins, ports and private literals", () => {
    expect(refused("ftp://example.com/")).toBe("protocol");
    expect(refused("file:///etc/passwd")).toBe("protocol");
    expect(refused("https://user:secret@example.com/")).toBe("credentials");
    expect(refused("https://example.com:8443/")).toBe("port");
    expect(refused("http://127.0.0.1/")).toBe("destination");
    expect(refused("http://169.254.169.254/latest/meta-data")).toBe(
      "destination",
    );
    expect(refused("http://[::1]/")).toBe("destination");
    expect(refused("http://[::ffff:7f00:1]/")).toBe("destination");
    expect(refused("http://10.1.2.3/")).toBe("destination");
  });
});

describe("publicOnlyLookup", () => {
  it("refuses a name that resolves to a loopback address", async () => {
    const error = await new Promise<unknown>((resolve) =>
      publicOnlyLookup("localhost", {}, (lookupError) => resolve(lookupError)),
    );
    expect(error).toBeInstanceOf(PageTitleError);
  });
});

describe("fetchPageTitle", () => {
  it("never connects to a private destination", async () => {
    await expect(fetchPageTitle("http://localhost/")).rejects.toBeInstanceOf(
      PageTitleError,
    );
    await expect(
      fetchPageTitle("http://127.0.0.1/admin"),
    ).rejects.toMatchObject({ reason: "destination" });
  });
});
