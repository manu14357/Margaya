import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signUploadToken,
  verifyUploadToken,
} from "../../../apps/api/src/storage/upload-token";

const grant = {
  key: "workspace/w/project/p/task/t/attachments/a.pdf",
  contentType: "application/pdf",
  size: 5,
  expiresAt: 2_000_000,
};

describe("local upload tokens", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "a-test-secret-that-is-at-least-32-chars");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a grant until it expires", () => {
    const token = signUploadToken(grant);
    expect(verifyUploadToken(token, 1_000_000)).toEqual(grant);
    expect(verifyUploadToken(token, 2_000_000)).toBeNull();
  });

  it("refuses altered payloads, signatures and other secrets", () => {
    const token = signUploadToken(grant);
    const [payload, signature] = token.split(".");
    const altered = Buffer.from(
      JSON.stringify({ k: "../../etc/passwd", t: "text/html", s: 5, e: 2e6 }),
    ).toString("base64url");
    expect(verifyUploadToken(`${altered}.${signature}`, 0)).toBeNull();
    expect(verifyUploadToken(`${payload}.x${signature}`, 0)).toBeNull();
    expect(verifyUploadToken(`${payload}`, 0)).toBeNull();
    expect(verifyUploadToken(`${token}.extra`, 0)).toBeNull();

    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-at-least-32-chars");
    expect(verifyUploadToken(token, 0)).toBeNull();
  });
});
