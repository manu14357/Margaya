import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetResponseType,
  pdfPreviewPolicy,
} from "../../../apps/api/src/utils/asset-response";

afterEach(() => vi.unstubAllEnvs());

describe("assetResponseType", () => {
  it("shows images, PDFs, audio and video inline with their own type", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "audio/mpeg",
      "audio/wav",
      "video/mp4",
      "video/webm",
    ]) {
      expect(assetResponseType(type, false), type).toEqual({
        inline: true,
        contentType: type,
      });
    }
  });

  it("shows text files inline as plain text only", () => {
    for (const type of [
      "text/plain",
      "text/csv",
      "text/markdown",
      "application/json",
    ]) {
      expect(assetResponseType(type, false), type).toEqual({
        inline: true,
        contentType: "text/plain; charset=utf-8",
      });
    }
  });

  it("never serves an uploaded page, drawing or script as itself", () => {
    for (const type of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/xml",
      "text/javascript",
      "application/javascript",
      "application/zip",
      "application/octet-stream",
      "",
    ]) {
      expect(assetResponseType(type, false), type).toEqual({
        inline: false,
        contentType: "application/octet-stream",
      });
    }
  });

  it("downloads anything on request", () => {
    for (const type of ["image/png", "application/pdf", "text/plain"]) {
      expect(assetResponseType(type, true), type).toEqual({
        inline: false,
        contentType: "application/octet-stream",
      });
    }
  });
});

describe("pdfPreviewPolicy", () => {
  it("lets only this server and its web app frame a PDF", () => {
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://app.example.com/");
    vi.stubEnv(
      "CORS_ORIGINS",
      "https://app.example.com, https://other.example.com/path, javascript:alert(1), not a url, 'none'",
    );
    const policy = pdfPreviewPolicy();
    expect(policy).toBe(
      "default-src 'none'; frame-ancestors 'self' https://app.example.com https://other.example.com; base-uri 'none'; form-action 'none'",
    );
  });

  it("allows only this server without configured web origins", () => {
    vi.stubEnv("MARGAYA_CLIENT_URL", "");
    vi.stubEnv("CORS_ORIGINS", "");
    expect(pdfPreviewPolicy()).toContain("frame-ancestors 'self';");
  });
});
