import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  clientIpFromHeaders,
  clientIpMiddleware,
  compactIpAddress,
  createClientIpResolver,
} from "../../apps/api/src/utils/client-ip";

describe("trusted client IP resolution", () => {
  it("does not trust headers from a direct public or private peer by default", () => {
    const resolve = createClientIpResolver("");
    expect(resolve("203.0.113.5", "1.2.3.4")).toBe("203.0.113.5");
    expect(resolve("10.0.0.5", "1.2.3.4")).toBe("10.0.0.5");
    expect(resolve(undefined, "1.2.3.4")).toBeNull();
  });
  it("stops at the first untrusted appended hop behind bundled nginx", () => {
    const resolve = createClientIpResolver("");
    expect(resolve("127.0.0.1", "1.2.3.4, 203.0.113.5")).toBe("203.0.113.5");
    expect(resolve("::ffff:127.0.0.1", "1.2.3.4, 203.0.113.5")).toBe(
      "203.0.113.5",
    );
  });
  it("supports explicit Docker proxy subnets and IPv6 chains", () => {
    const resolve = createClientIpResolver(
      "127.0.0.0/8, 172.25.0.0/24, fd00:1234::/64",
    );
    expect(resolve("127.0.0.1", "1.2.3.4, 203.0.113.5, 172.25.0.2")).toBe(
      "203.0.113.5",
    );
    expect(resolve("fd00:1234::1", "2001:db8::1, fd00:1234::2")).toBe(
      "2001:db8::1",
    );
  });
  it.each([
    "not-an-ip",
    "127.0.0.1/33",
    "::1/129",
    "127.0.0.1/-1",
    "127.0.0.1/8/8",
    "127.0.0.1,",
  ])("fails closed for invalid proxy config %s", (config) => {
    expect(() => createClientIpResolver(config)).toThrow(/TRUSTED_PROXIES/);
  });
  it("falls back to the socket peer for malformed or excessive chains", () => {
    const resolve = createClientIpResolver("");
    for (const header of [
      "1.2.3.4, invalid",
      "x".repeat(8193),
      "127.0.0.1,".repeat(65),
    ])
      expect(resolve("127.0.0.1", header)).toBe("127.0.0.1");
  });
  it("removes spoofed canonical and Cloudflare values when no socket is available", async () => {
    const app = new Hono()
      .use(clientIpMiddleware())
      .get("/", (c) => c.text(c.req.header("x-margaya-client-ip") ?? "none"));
    const response = await app.request("/", {
      headers: {
        "x-margaya-client-ip": "1.2.3.4",
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    expect(await response.text()).toBe("none");
  });
  it.each(["none", "127.0.0.0/8"])(
    "uses the actual Node socket with proxy policy %s",
    async (config) => {
      const app = new Hono()
        .use(clientIpMiddleware(config))
        .get("/", (c) => c.text(c.req.header("x-margaya-client-ip") ?? "none"));
      const server = serve({
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: 0,
      });
      await once(server, "listening");
      try {
        const response = await fetch(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
          {
            headers: {
              "x-margaya-client-ip": "1.2.3.4",
              "cf-connecting-ip": "5.6.7.8",
              "x-forwarded-for": "1.2.3.4, 203.0.113.5",
            },
          },
        );
        expect(await response.text()).toBe(
          config === "none" ? "127.0.0.1" : "203.0.113.5",
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});

describe("session IP display", () => {
  it.each([
    ["0000:0000:0000:0000:0000:0000:0000:0001", "::1"],
    ["2001:0db8:85a3:0000:0000:0000:0000:0000", "2001:db8:85a3::"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["0000:0000:0000:0000:0000:ffff:c000:0201", "192.0.2.1"],
    ["203.0.113.5", "203.0.113.5"],
    ["fe80::1%eth0", "fe80::1%eth0"],
  ])("shows %s as %s", (stored, shown) => {
    expect(compactIpAddress(stored)).toBe(shown);
  });

  it("drops addresses that say nothing", () => {
    expect(compactIpAddress("0000:0000:0000:0000:0000:0000:0000:0000")).toBe(
      null,
    );
    expect(compactIpAddress("")).toBeNull();
    expect(compactIpAddress(null)).toBeNull();
  });

  it("reads only a valid transport-resolved client IP", () => {
    const headers = (value: string) =>
      new Headers({ "x-margaya-client-ip": value });
    expect(clientIpFromHeaders(headers("2001:db8::7"))).toBe("2001:db8::7");
    expect(clientIpFromHeaders(headers("not-an-ip"))).toBeNull();
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(undefined)).toBeNull();
  });
});
