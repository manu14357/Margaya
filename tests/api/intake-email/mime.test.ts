import { describe, expect, it } from "vitest";
import {
  decodeHeaderValue,
  htmlToText,
  mailBodyText,
  parseAddressList,
  parseMail,
  parseMessageIds,
  parseParams,
  stripQuotedReply,
} from "../../../apps/api/src/intake-email/mime";

function raw(lines: string[]) {
  return Buffer.from(lines.join("\r\n"), "utf8");
}

describe("headers", () => {
  it("decodes RFC 2047 words and joins adjacent ones", () => {
    expect(
      decodeHeaderValue("=?UTF-8?B?SGVsbG8=?= =?UTF-8?Q?_w=C3=B6rld?="),
    ).toBe("Hello wörld");
    expect(decodeHeaderValue("=?iso-8859-1?Q?caf=E9?= time")).toBe("café time");
  });

  it("keeps Unicode text as it is", () => {
    expect(decodeHeaderValue("José Núñez")).toBe("José Núñez");
  });

  it("parses address lists with names, quotes and groups", () => {
    expect(
      parseAddressList(
        '"Doe, Ana" <Ana@Example.org>, bo@y.org, team: c@z.org;',
      ),
    ).toEqual([
      { address: "ana@example.org", name: "Doe, Ana" },
      { address: "bo@y.org", name: null },
      { address: "c@z.org", name: null },
    ]);
    expect(parseAddressList("not an address")).toEqual([]);
  });

  it("reads message ids", () => {
    expect(parseMessageIds("<a@x> <b@y>")).toEqual(["a@x", "b@y"]);
    expect(parseMessageIds(undefined)).toEqual([]);
  });

  it("reads RFC 2231 parameters", () => {
    const parsed = parseParams(
      "attachment; filename*0*=utf-8''r%C3%A9; filename*1=sum%C3%A9.pdf",
    );
    expect(parsed.value).toBe("attachment");
    expect(parsed.params.filename).toBe("résum%C3%A9.pdf");
    expect(parseParams('text/plain; charset="UTF-8"').params.charset).toBe(
      "UTF-8",
    );
  });
});

describe("parseMail", () => {
  it("reads a plain message", () => {
    const mail = parseMail(
      raw([
        "From: Ana <ana@example.org>",
        "To: requests+abcdefghijkl123@example.com",
        "Subject: =?UTF-8?Q?Printer_=E2=80=94_broken?=",
        "Message-ID: <m1@example.org>",
        "In-Reply-To: <m0@example.org>",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "The printer on floor 2 is=",
        " jammed =E2=9C=8B",
      ]),
    );
    expect(mail.from).toEqual({ address: "ana@example.org", name: "Ana" });
    expect(mail.to[0]?.address).toBe("requests+abcdefghijkl123@example.com");
    expect(mail.subject).toBe("Printer — broken");
    expect(mail.messageId).toBe("m1@example.org");
    expect(mail.inReplyTo).toEqual(["m0@example.org"]);
    expect(mail.text).toBe("The printer on floor 2 is jammed ✋");
    expect(mail.attachments).toEqual([]);
  });

  it("reads multipart bodies and attachments", () => {
    const mail = parseMail(
      raw([
        "From: bo@y.org",
        "Subject: Logs",
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain",
        "",
        "See attached.",
        "--inner",
        "Content-Type: text/html",
        "",
        "<p>See <b>attached</b>.</p>",
        "--inner--",
        "--outer",
        'Content-Type: text/plain; name="log.txt"',
        "Content-Disposition: attachment; filename=log.txt",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("line 1\nline 2").toString("base64"),
        "--outer--",
      ]),
    );
    expect(mail.text).toBe("See attached.");
    expect(mail.html).toContain("<b>attached</b>");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]?.filename).toBe("log.txt");
    expect(mail.attachments[0]?.content.toString()).toBe("line 1\nline 2");
  });

  it("falls back to the HTML body as text", () => {
    const mail = parseMail(
      raw([
        "From: c@z.org",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<html><head><style>p{}</style></head><body><p>One &amp; two</p><br>Three</body></html>",
      ]),
    );
    expect(mailBodyText(mail)).toBe("One & two\n\nThree");
  });
});

describe("text helpers", () => {
  it("turns HTML into text", () => {
    expect(htmlToText("<ul><li>a</li><li>b</li></ul>&#x41;&#66;")).toBe(
      "- a\n- b\nAB",
    );
  });

  it("strips the quoted part of a reply", () => {
    expect(
      stripQuotedReply(
        "Thanks, that helps.\n\nOn Mon, 3 Nov 2026, Support wrote:\n> Old text",
      ),
    ).toBe("Thanks, that helps.");
    expect(stripQuotedReply("> only a quote")).toBe("> only a quote");
  });
});
