import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { anthropicParams } from "../../../apps/api/src/ai/provider/anthropic";
import { openAiBody } from "../../../apps/api/src/ai/provider/openai-compatible";
import type { ChatRequest } from "../../../apps/api/src/ai/types";
import { resolveProposals } from "../../../apps/api/src/ai-capture/analyze";
import {
  MAX_CAPTURE_IMAGE_BYTES,
  MAX_CAPTURE_IMAGES,
  prepareCaptureImages,
  sniffImageType,
  stripImageMetadata,
} from "../../../apps/api/src/ai-capture/images";

// Capture to issue (C6): image checks, metadata stripping, the vision
// content blocks of both adapters, and how proposals are resolved.

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...Buffer.from(part, "latin1")] : part,
    ),
  );

const u32be = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const u32le = (n: number) => [...u32be(n)].reverse();
const u16be = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

const GPS = "GPS 52.52N 13.40E serial=CAM-1234";

/** JFIF + EXIF (APP1) + IPTC (APP13) + comment + ICC (APP2) + scan. */
function jpegWithExif() {
  const segment = (marker: number, payload: string) => [
    0xff,
    marker,
    ...u16be(payload.length + 2),
    ...Buffer.from(payload, "latin1"),
  ];
  return bytes(
    [0xff, 0xd8],
    segment(0xe0, "JFIF\0\x01\x01"),
    segment(0xe1, `Exif\0\0${GPS}`),
    segment(0xed, "Photoshop 3.0\0IPTC author"),
    segment(0xfe, "a comment"),
    segment(0xe2, "ICC_PROFILE\0colour"),
    segment(0xdb, "quant"),
    segment(0xda, "scan"),
    "PIXELDATA",
    [0xff, 0xd9],
  );
}

function pngChunk(type: string, data: string) {
  return [
    ...u32be(data.length),
    ...Buffer.from(type + data, "latin1"),
    0,
    0,
    0,
    0,
  ];
}

function pngWithText() {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", "0123456789abc"),
    pngChunk("tEXt", `Author\0${GPS}`),
    pngChunk("eXIf", GPS),
    pngChunk("IDAT", "PIXELS"),
    pngChunk("IEND", ""),
  );
}

function webpChunk(type: string, data: number[]) {
  return [
    ...Buffer.from(type, "latin1"),
    ...u32le(data.length),
    ...data,
    ...(data.length % 2 ? [0] : []),
  ];
}

function webpWithExif() {
  const vp8x = [0x08 | 0x04 | 0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0];
  const body = [
    ...Buffer.from("WEBP", "latin1"),
    ...webpChunk("VP8X", vp8x),
    ...webpChunk("VP8L", [1, 2, 3, 4, 5]),
    ...webpChunk("EXIF", [...Buffer.from(GPS, "latin1")]),
    ...webpChunk("XMP ", [...Buffer.from("<x:xmpmeta/>", "latin1")]),
  ];
  return bytes("RIFF", u32le(body.length), body);
}

const text = (data: Uint8Array) => Buffer.from(data).toString("latin1");
const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64");

function status(run: () => unknown): number | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HTTPException ? error.status : -1;
  }
}

describe("capture images", () => {
  it("knows PNG, JPEG and WebP by their bytes", () => {
    expect(sniffImageType(pngWithText())).toBe("image/png");
    expect(sniffImageType(jpegWithExif())).toBe("image/jpeg");
    expect(sniffImageType(webpWithExif())).toBe("image/webp");
    expect(sniffImageType(bytes("GIF89a......"))).toBeNull();
    expect(sniffImageType(bytes("<svg></svg>"))).toBeNull();
  });

  it("strips EXIF, IPTC and comments from JPEG and keeps the image", () => {
    const stripped = stripImageMetadata(jpegWithExif(), "image/jpeg");
    const out = text(stripped);
    expect(out).not.toContain("GPS");
    expect(out).not.toContain("Exif");
    expect(out).not.toContain("IPTC");
    expect(out).not.toContain("a comment");
    expect(out).toContain("JFIF");
    expect(out).toContain("ICC_PROFILE");
    expect(out).toContain("PIXELDATA");
    expect([...stripped.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...stripped.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it("strips text and EXIF chunks from PNG", () => {
    const out = text(stripImageMetadata(pngWithText(), "image/png"));
    expect(out).not.toContain("GPS");
    expect(out).not.toContain("tEXt");
    expect(out).not.toContain("eXIf");
    expect(out).toContain("IHDR");
    expect(out).toContain("PIXELS");
    expect(out).toContain("IEND");
  });

  it("strips EXIF and XMP from WebP, clears their flags and fixes the size", () => {
    const stripped = stripImageMetadata(webpWithExif(), "image/webp");
    const out = text(stripped);
    expect(out).not.toContain("GPS");
    expect(out).not.toContain("xmpmeta");
    expect(out).toContain("VP8L");
    const view = new DataView(stripped.buffer, stripped.byteOffset);
    expect(view.getUint32(4, true)).toBe(stripped.length - 8);
    // VP8X flags: alpha (0x10) untouched, EXIF (0x08) and XMP (0x04) cleared.
    expect((stripped[20] ?? 0) & 0x0c).toBe(0);
    expect((stripped[20] ?? 0) & 0x10).toBe(0x10);
  });

  it("prepares images: stripped base64, data URLs allowed", () => {
    const [image] = prepareCaptureImages([
      {
        mediaType: "image/jpeg",
        data: `data:image/jpeg;base64,${b64(jpegWithExif())}`,
      },
    ]);
    expect(image?.mediaType).toBe("image/jpeg");
    expect(
      Buffer.from(image?.data ?? "", "base64").toString("latin1"),
    ).not.toContain("GPS");
  });

  it("refuses wrong types, disguised files, bad base64 and broken images", () => {
    const png = b64(pngWithText());
    expect(
      status(() =>
        prepareCaptureImages([{ mediaType: "image/gif", data: png }]),
      ),
    ).toBe(400);
    // PNG bytes declared as JPEG.
    expect(
      status(() =>
        prepareCaptureImages([{ mediaType: "image/jpeg", data: png }]),
      ),
    ).toBe(400);
    // An SVG (script-capable) declared as PNG.
    expect(
      status(() =>
        prepareCaptureImages([
          { mediaType: "image/png", data: b64(bytes("<svg onload=x>")) },
        ]),
      ),
    ).toBe(400);
    expect(
      status(() =>
        prepareCaptureImages([{ mediaType: "image/png", data: "@@@" }]),
      ),
    ).toBe(400);
    const truncated = pngWithText().slice(0, 30);
    expect(
      status(() =>
        prepareCaptureImages([
          { mediaType: "image/png", data: b64(truncated) },
        ]),
      ),
    ).toBe(400);
  });

  it("refuses too many or too large images", () => {
    const one = { mediaType: "image/png", data: b64(pngWithText()) };
    expect(
      status(() =>
        prepareCaptureImages(
          Array.from({ length: MAX_CAPTURE_IMAGES + 1 }, () => one),
        ),
      ),
    ).toBe(413);
    const big = new Uint8Array(MAX_CAPTURE_IMAGE_BYTES + 1);
    big.set(pngWithText());
    expect(
      status(() =>
        prepareCaptureImages([{ mediaType: "image/png", data: b64(big) }]),
      ),
    ).toBe(413);
  });
});

describe("vision content blocks", () => {
  const request: ChatRequest = {
    model: "m",
    system: ["rules"],
    maxTokens: 100,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", mediaType: "image/png", data: "QUJD" },
          { type: "text", text: "Describe it" },
        ],
      },
    ],
  };

  it("sends Anthropic base64 image blocks", () => {
    const params = anthropicParams(request);
    expect(params.messages[0]?.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
      { type: "text", text: "Describe it" },
    ]);
  });

  it("sends OpenAI-compatible image_url data parts", () => {
    const body = openAiBody(request);
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
        { type: "text", text: "Describe it" },
      ],
    });
  });
});

describe("resolveProposals", () => {
  const labels = new Map([
    ["L1", { id: "lab-bug", name: "bug", color: "#f00" }],
    ["L2", { id: "lab-ui", name: "ui", color: "#0f0" }],
  ]);
  const people = new Map([["P1", { id: "u-mia", name: "Mia", image: null }]]);

  it("keeps one proposal for a screenshot and resolves only real labels", () => {
    const items = resolveProposals(
      {
        items: [
          {
            kind: "action",
            title: "  Checkout button\noverlaps footer ",
            summary: "On mobile the button is hidden.",
            steps: ["1. Open checkout", "2) Scroll down", ""],
            expected: "Button visible",
            actual: "",
            environment: "Safari 18, iPhone",
            priority: "high",
            priorityReason: "Blocks purchases",
            labels: ["L1", "l2", "L9", "L1"],
            owner: "P1",
            ownerReason: "x",
          },
          { title: "A second one" },
        ],
      },
      "screenshot",
      labels,
      people,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "bug",
      title: "Checkout button overlaps footer",
      steps: ["Open checkout", "Scroll down"],
      expected: "Button visible",
      actual: null,
      priority: "high",
      labels: [
        { labelId: "lab-bug", name: "bug" },
        { labelId: "lab-ui", name: "ui" },
      ],
    });
    // Owners only come from a transcript's member list.
    expect(items[0]?.owner).toBeNull();
  });

  it("returns several action items from a transcript with owners", () => {
    const items = resolveProposals(
      {
        items: [
          {
            kind: "action",
            title: "Send the pricing deck",
            owner: "P1",
            ownerReason: "Mia offered",
            priority: "medium",
          },
          {
            kind: "action",
            title: "Book the venue",
            owner: "P7",
            priority: "nonsense",
          },
          { kind: "action", title: "" },
        ],
      },
      "transcript",
      labels,
      people,
    );
    expect(items.map((item) => item.title)).toEqual([
      "Send the pricing deck",
      "Book the venue",
    ]);
    expect(items[0]?.owner).toMatchObject({
      userId: "u-mia",
      reason: "Mia offered",
    });
    expect(items[1]?.owner).toBeNull();
    expect(items[1]?.priority).toBe("no-priority");
  });

  it("caps transcript proposals at ten and ignores malformed answers", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `Item ${i}` }));
    expect(
      resolveProposals({ items: many }, "transcript", labels, people),
    ).toHaveLength(10);
    expect(resolveProposals("nope", "transcript", labels, people)).toEqual([]);
    expect(
      resolveProposals({ items: "x" }, "screenshot", labels, people),
    ).toEqual([]);
  });
});
