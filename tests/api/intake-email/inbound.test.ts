import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { selectAttachments } = await import(
  "../../../apps/api/src/intake-email/attachments"
);
const { imapQuote, parseFetchSize, parseSearchResponse } = await import(
  "../../../apps/api/src/intake-email/imap"
);
const { inboundFromParsed, messageKey, titleFromSubject } = await import(
  "../../../apps/api/src/intake-email/inbound"
);
const { parseMail } = await import("../../../apps/api/src/intake-email/mime");
const { inboundFromJson, webhookAuthorized } = await import(
  "../../../apps/api/src/intake-email/webhook"
);
const { generateAddressToken } = await import(
  "../../../apps/api/src/intake-email/settings"
);
const { projectForwardingAddress, inboundWebhookSecret, ownAddresses } =
  await import("../../../apps/api/src/intake-email/config");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instance config", () => {
  it("builds plus addresses from the base address", () => {
    vi.stubEnv("INTAKE_EMAIL_ADDRESS", "Requests@Example.com");
    expect(projectForwardingAddress("abc123abc123")).toBe(
      "requests+abc123abc123@example.com",
    );
    vi.stubEnv("INTAKE_EMAIL_ADDRESS", "not-an-address");
    expect(projectForwardingAddress("abc123abc123")).toBeNull();
  });

  it("needs a webhook secret of 16 characters or more", () => {
    vi.stubEnv("INTAKE_EMAIL_WEBHOOK_SECRET", "short");
    expect(inboundWebhookSecret()).toBeNull();
    vi.stubEnv("INTAKE_EMAIL_WEBHOOK_SECRET", "0123456789abcdef");
    expect(inboundWebhookSecret()).toBe("0123456789abcdef");
  });

  it("knows its own addresses", () => {
    vi.stubEnv("INTAKE_EMAIL_ADDRESS", "requests@example.com");
    vi.stubEnv("SMTP_FROM", "Margaya <noreply@example.com>");
    expect(ownAddresses()).toEqual([
      "requests@example.com",
      "noreply@example.com",
    ]);
  });
});

describe("address tokens", () => {
  it("are 20 lower-case letters and digits", () => {
    const token = generateAddressToken();
    expect(token).toMatch(/^[a-z0-9]{20}$/);
    expect(generateAddressToken()).not.toBe(token);
  });
});

describe("webhook authentication", () => {
  const secret = "0123456789abcdef-secret";
  const body = new TextEncoder().encode('{"subject":"x"}');

  it("accepts a body signature", () => {
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(webhookAuthorized(secret, body, undefined, signature)).toBe(true);
    expect(webhookAuthorized(secret, body, undefined, "sha256=00")).toBe(false);
  });

  it("accepts the secret as a bearer token or basic password", () => {
    expect(webhookAuthorized(secret, body, `Bearer ${secret}`, undefined)).toBe(
      true,
    );
    const basic = Buffer.from(`mail:${secret}`).toString("base64");
    expect(webhookAuthorized(secret, body, `Basic ${basic}`, undefined)).toBe(
      true,
    );
    expect(webhookAuthorized(secret, body, "Bearer nope", undefined)).toBe(
      false,
    );
    expect(webhookAuthorized(secret, body, undefined, undefined)).toBe(false);
  });
});

describe("inbound mail", () => {
  it("collects every recipient, delivery headers included", () => {
    const parsed = parseMail(
      Buffer.from(
        [
          "From: Ana <ana@x.org>",
          "To: help@x.org",
          "Cc: requests+abcdefghijkl1234@example.com",
          "Delivered-To: requests+zzzzzzzzzzzz9999@example.com",
          "Subject: Re: Fwd: Broken link",
          "",
          "Body",
        ].join("\r\n"),
      ),
    );
    const mail = inboundFromParsed(parsed, 100, ["Envelope@Example.com"]);
    expect(mail.recipients).toEqual([
      "help@x.org",
      "requests+abcdefghijkl1234@example.com",
      "requests+zzzzzzzzzzzz9999@example.com",
      "envelope@example.com",
    ]);
    expect(mail.text).toBe("Body");
    expect(titleFromSubject(mail.subject, "ana@x.org")).toBe("Broken link");
  });

  it("titles a message without a subject after its sender", () => {
    expect(titleFromSubject("  ", "ana@x.org")).toBe("Email from ana@x.org");
    expect(titleFromSubject("<b>Bold</b>   title", "a@x.org")).toBe(
      "Bold title",
    );
  });

  it("remembers messages by Message-ID, else by a content hash", () => {
    const base = inboundFromParsed(
      parseMail(Buffer.from("From: a@x.org\r\nSubject: Hi\r\n\r\nBody")),
      10,
    );
    expect(messageKey({ ...base, messageId: "ABC@X" })).toBe("abc@x");
    expect(messageKey(base)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(messageKey(base)).toBe(messageKey({ ...base }));
  });

  it("reads the webhook's parsed JSON", () => {
    const mail = inboundFromJson(
      {
        from: "José <jose@x.org>",
        to: ["requests+abcdefghijkl1234@example.com"],
        subject: "Help",
        html: "<p>Hi</p>",
        messageId: "<m1@x.org>",
        references: "<m0@x.org>",
        headers: { "Auto-Submitted": "auto-replied" },
        spamScore: 1,
        attachments: [
          {
            filename: "a.txt",
            content: Buffer.from("hello").toString("base64"),
          },
        ],
      },
      500,
    );
    expect(mail.from).toEqual({ address: "jose@x.org", name: "José" });
    expect(mail.text).toBe("Hi");
    expect(mail.messageId).toBe("m1@x.org");
    expect(mail.threadIds).toEqual(["m0@x.org"]);
    expect(mail.headers.get("auto-submitted")).toEqual(["auto-replied"]);
    expect(mail.attachments[0]?.content.toString()).toBe("hello");
    expect(mail.spamScore).toBe(1);
  });

  it("reads a raw message sent in the JSON", () => {
    const raw = Buffer.from(
      "From: a@x.org\r\nTo: b@y.org\r\nSubject: Raw\r\n\r\nText",
    ).toString("base64");
    const mail = inboundFromJson({ raw, recipients: ["c@z.org"] }, 50);
    expect(mail.subject).toBe("Raw");
    expect(mail.recipients).toEqual(["b@y.org", "c@z.org"]);
  });
});

describe("attachment limits", () => {
  const limits = {
    maxMessageBytes: 1_000,
    maxAttachmentBytes: 10,
    maxAttachments: 2,
  };
  const file = (filename: string, size: number) => ({
    filename,
    contentType: "text/plain",
    content: Buffer.alloc(size, 1),
  });

  it("keeps files within the size and count limits", () => {
    const { keep, skipped } = selectAttachments(
      [
        file("a.txt", 5),
        file("big.bin", 50),
        file("b.txt", 5),
        file("c.txt", 5),
        file("empty", 0),
      ],
      limits,
      0,
    );
    expect(keep.map((f) => f.filename)).toEqual(["a.txt", "b.txt"]);
    expect(skipped).toEqual([
      { filename: "big.bin", reason: "too_large" },
      { filename: "c.txt", reason: "too_many" },
    ]);
  });

  it("respects the task's attachment cap", () => {
    const { keep } = selectAttachments([file("a.txt", 5)], limits, 100);
    expect(keep).toEqual([]);
  });
});

describe("IMAP helpers", () => {
  it("quotes strings and refuses line breaks", () => {
    expect(imapQuote('pa"ss\\word')).toBe('"pa\\"ss\\\\word"');
    expect(() => imapQuote("a\r\nb")).toThrow();
  });

  it("reads SEARCH and FETCH responses", () => {
    expect(parseSearchResponse(["* SEARCH 3 7 12", "* OK"])).toEqual([
      3, 7, 12,
    ]);
    expect(parseSearchResponse(["* SEARCH"])).toEqual([]);
    expect(parseFetchSize(["* 4 FETCH (UID 12 RFC822.SIZE 3456)"])).toBe(3456);
    expect(parseFetchSize([])).toBeNull();
  });
});
