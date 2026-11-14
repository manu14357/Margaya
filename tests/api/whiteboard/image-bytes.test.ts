import { describe, expect, it } from "vitest";
import {
  imagePixelSize,
  sniffImageType,
} from "../../../apps/api/src/whiteboard/image-bytes";

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const char of part) out.push(char.charCodeAt(0));
    } else out.push(...part);
  }
  return new Uint8Array(out);
}

const be32 = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const le16 = (n: number) => [n & 255, n >>> 8];

const PNG_HEADER = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  be32(13),
  "IHDR",
  be32(640),
  be32(480),
  [8, 6, 0, 0, 0],
);

describe("board image bytes", () => {
  it("identifies PNG and reads its size", () => {
    expect(sniffImageType(PNG_HEADER)).toBe("image/png");
    expect(imagePixelSize(PNG_HEADER, "image/png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("identifies GIF and reads its size", () => {
    const gif = bytes("GIF89a", le16(32), le16(16), [0, 0, 0]);
    expect(sniffImageType(gif)).toBe("image/gif");
    expect(imagePixelSize(gif, "image/gif")).toEqual({ width: 32, height: 16 });
  });

  it("identifies JPEG and finds the frame size past other segments", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x10],
      "JFIF",
      [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 3],
      new Array(12).fill(0),
    );
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(imagePixelSize(jpeg, "image/jpeg")).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("identifies WebP (extended header) and reads its size", () => {
    const webp = bytes(
      "RIFF",
      [0, 0, 0, 0],
      "WEBP",
      "VP8X",
      [10, 0, 0, 0],
      [0, 0, 0, 0],
      [99, 0, 0],
      [49, 0, 0],
    );
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(imagePixelSize(webp, "image/webp")).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("refuses SVG, HTML and anything else", () => {
    expect(
      sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffImageType(bytes("<!doctype html><script>"))).toBeNull();
    expect(sniffImageType(bytes([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
