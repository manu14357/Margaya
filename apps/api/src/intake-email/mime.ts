// A small MIME parser for email intake (#8): headers (RFC 5322, folded
// lines, RFC 2047 encoded words), multipart bodies, base64 and
// quoted-printable, charsets through TextDecoder, and attachment names
// (RFC 2231). It reads only what a request needs: sender, recipients,
// subject, thread ids, the text or HTML body and the attachments. The raw
// message is already size-limited by the caller.

export type MailAddress = { address: string; name: string | null };

export type MailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type ParsedMail = {
  headers: Map<string, string[]>;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  contentType: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
};

const MAX_DEPTH = 8;
const MAX_PARTS = 200;

type Part = { headers: Map<string, string[]>; body: string };

function splitHeadersAndBody(raw: string): { head: string; body: string } {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { head: raw.slice(0, crlf), body: raw.slice(crlf + 4) };
  }
  if (lf >= 0) return { head: raw.slice(0, lf), body: raw.slice(lf + 2) };
  return { head: raw, body: "" };
}

/** Unfolded headers by lower-case name, in order. Values stay raw bytes. */
export function parseHeaderBlock(head: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const list = headers.get(name);
    if (list) list.push(value);
    else headers.set(name, [value]);
  }
  return headers;
}

function bytes(latin1: string): Buffer {
  return Buffer.from(latin1, "latin1");
}

/** Decodes bytes in a charset, falling back to UTF-8, then Latin-1. */
export function decodeCharset(data: Buffer, charset: string | undefined) {
  const label = (charset ?? "utf-8").trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(label === "us-ascii" ? "utf-8" : label).decode(data);
  } catch {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      return data.toString("latin1");
    }
  }
}

export function decodeQuotedPrintable(input: string): Buffer {
  const text = input.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);
    if (char === 0x3d) {
      const hex = text.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
    }
    out.push(char & 0xff);
  }
  return Buffer.from(out);
}

function decodeTransfer(body: string, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64":
      return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      return bytes(body);
  }
}

const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;

/** RFC 2047 encoded words; raw 8-bit header bytes are read as UTF-8. */
export function decodeHeaderValue(value: string): string {
  // Whitespace between two encoded words is not part of the text.
  const joined = value.replace(/(\?=)\s+(?==\?)/g, "$1");
  const decoded = joined.replace(
    ENCODED_WORD,
    (_word, charset: string, kind: string, text: string) => {
      const label = charset.split("*")[0] ?? charset;
      const data =
        kind.toLowerCase() === "b"
          ? Buffer.from(text, "base64")
          : decodeQuotedPrintable(text.replace(/_/g, " "));
      // Marked so the 8-bit pass below leaves it alone.
      return `\u0000${encodeURIComponent(decodeCharset(data, label))}\u0000`;
    },
  );
  return decoded
    .split("\u0000")
    .map((piece, index) =>
      index % 2 === 1 ? decodeURIComponent(piece) : rawHeaderText(piece),
    )
    .join("");
}

/**
 * Raw 8-bit header bytes (read as Latin-1) as UTF-8 when they are valid
 * UTF-8; text that is already Unicode (webhook JSON) passes unchanged.
 */
function rawHeaderText(piece: string): string {
  if (!/[\x80-\xff]/.test(piece) || /[Ā-￿]/.test(piece)) {
    return piece;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes(piece));
  } catch {
    return piece;
  }
}

export type HeaderParams = { value: string; params: Record<string, string> };

/** `type/subtype; a=b; c="d"`, with RFC 2231 continuations and charsets. */
export function parseParams(header: string | undefined): HeaderParams {
  if (!header) return { value: "", params: {} };
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index] as string;
    if (char === '"' && header[index - 1] !== "\\") quoted = !quoted;
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);

  const [first = "", ...rest] = parts;
  const raw: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    raw[key] = val;
  }

  const params: Record<string, string> = {};
  const continued = new Map<
    string,
    { index: number; value: string; encoded: boolean }[]
  >();
  for (const [key, val] of Object.entries(raw)) {
    const match = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (!match?.[1]) {
      params[key] = val;
      continue;
    }
    const name = match[1];
    const list = continued.get(name) ?? [];
    list.push({
      index: match[2] === undefined ? 0 : Number(match[2]),
      value: val,
      encoded:
        match[3] === "*" || (match[2] === undefined && key.endsWith("*")),
    });
    continued.set(name, list);
  }
  for (const [name, list] of continued) {
    list.sort((a, b) => a.index - b.index);
    let charset = "utf-8";
    const chunks: Buffer[] = [];
    for (const [position, piece] of list.entries()) {
      let value = piece.value;
      if (piece.encoded && position === 0) {
        const match = /^([^']*)'[^']*'(.*)$/.exec(value);
        if (match) {
          charset = match[1] || "utf-8";
          value = match[2] ?? "";
        }
      }
      chunks.push(
        piece.encoded
          ? Buffer.from(
              value.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                String.fromCharCode(Number.parseInt(hex, 16)),
              ),
              "latin1",
            )
          : bytes(value),
      );
    }
    params[name] = decodeCharset(Buffer.concat(chunks), charset);
  }

  return { value: first.trim().toLowerCase(), params };
}

/** Splits on commas outside quotes, comments and angle brackets. */
function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char === '"' && value[index - 1] !== "\\") quoted = !quoted;
    else if (!quoted && char === "<") angle += 1;
    else if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    if ((char === "," || char === ";") && !quoted && angle === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

const SIMPLE_ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+$/;

export function normalizeAddress(value: string): string | null {
  const trimmed = value
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  return SIMPLE_ADDRESS.test(trimmed) ? trimmed : null;
}

/** `"Ana" <ana@x.org>, bo@y.org, group: c@z.org;` as addresses. */
export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];
  // Group syntax: drop the display name before the colon.
  const flattened = decodeHeaderValue(value).replace(
    /(^|,)\s*[^,:<>"@]+:\s*/g,
    "$1",
  );
  const result: MailAddress[] = [];
  for (const part of splitAddressList(flattened)) {
    const angle = /<([^<>]*)>/.exec(part);
    const address = normalizeAddress(
      angle?.[1] ?? part.replace(/\([^)]*\)/g, ""),
    );
    if (!address) continue;
    const rawName = angle ? part.slice(0, angle.index).trim() : "";
    const name =
      rawName
        .replace(/^"(.*)"$/, "$1")
        .replace(/\\(.)/g, "$1")
        .trim() || null;
    result.push({ address, name });
  }
  return result;
}

/** Message ids (`<id@host>`) in a header, in order, without brackets. */
export function parseMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.match(/<[^<>\s]+>/g) ?? [];
  return ids.map((id) => id.slice(1, -1).slice(0, 998));
}

function header(headers: Map<string, string[]>, name: string) {
  return headers.get(name)?.[0];
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  const lines = body.split(/\r?\n/);
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(delimiter)) {
      const rest = line.slice(delimiter.length);
      if (current) parts.push(current.join("\r\n"));
      if (rest.startsWith("--")) return parts;
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current) parts.push(current.join("\r\n"));
  return parts;
}

function attachmentName(part: Part, contentType: HeaderParams): string | null {
  const disposition = parseParams(header(part.headers, "content-disposition"));
  const name = disposition.params.filename ?? contentType.params.name ?? null;
  return name ? decodeHeaderValue(name) : null;
}

const EXTENSIONS: Record<string, string> = {
  "message/rfc822": "eml",
  "text/calendar": "ics",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

function walk(
  part: Part,
  mail: ParsedMail,
  depth: number,
  counter: { parts: number },
) {
  counter.parts += 1;
  if (counter.parts > MAX_PARTS || depth > MAX_DEPTH) return;

  const contentType = parseParams(
    header(part.headers, "content-type") ?? "text/plain",
  );
  const type = contentType.value || "text/plain";
  const encoding = header(part.headers, "content-transfer-encoding");

  if (type.startsWith("multipart/") && contentType.params.boundary) {
    for (const child of splitMultipart(
      part.body,
      contentType.params.boundary,
    )) {
      const { head, body } = splitHeadersAndBody(child);
      walk({ headers: parseHeaderBlock(head), body }, mail, depth + 1, counter);
    }
    return;
  }

  const disposition = parseParams(
    header(part.headers, "content-disposition"),
  ).value;
  const name = attachmentName(part, contentType);
  const isAttachment = disposition === "attachment" || Boolean(name);

  if (!isAttachment && (type === "text/plain" || type === "text/html")) {
    const text = decodeCharset(
      decodeTransfer(part.body, encoding),
      contentType.params.charset,
    );
    if (type === "text/plain") mail.text += mail.text ? `\n\n${text}` : text;
    else mail.html += text;
    return;
  }

  // Delivery reports carry their verdict in these parts.
  if (type === "message/delivery-status") return;

  const extension = EXTENSIONS[type] ?? "bin";
  mail.attachments.push({
    filename: name ?? `attachment-${mail.attachments.length + 1}.${extension}`,
    contentType: type,
    content: decodeTransfer(part.body, encoding),
  });
}

/** Parses a raw RFC 5322 message. */
export function parseMail(raw: Buffer): ParsedMail {
  const { head, body } = splitHeadersAndBody(raw.toString("latin1"));
  const headers = parseHeaderBlock(head);
  const from = parseAddressList(header(headers, "from"))[0] ?? null;
  const mail: ParsedMail = {
    headers,
    from,
    to: parseAddressList((headers.get("to") ?? []).join(", ")),
    cc: parseAddressList((headers.get("cc") ?? []).join(", ")),
    subject: decodeHeaderValue(header(headers, "subject") ?? "").trim(),
    messageId: parseMessageIds(header(headers, "message-id"))[0] ?? null,
    inReplyTo: parseMessageIds(header(headers, "in-reply-to")),
    references: parseMessageIds(header(headers, "references")),
    contentType: parseParams(header(headers, "content-type") ?? "text/plain")
      .value,
    text: "",
    html: "",
    attachments: [],
  };
  walk({ headers, body }, mail, 0, { parts: 0 });
  return mail;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Readable text of an HTML-only message: tags out, breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith("#x")) {
        const point = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      if (lower.startsWith("#")) {
        const point = Number(lower.slice(1));
        return Number.isFinite(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return ENTITIES[lower] ?? entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_INTRO =
  /^(?:.{0,300}\b(?:wrote|schrieb|a écrit|escribió|scrisse|schreef|escreveu|napisał|написал)\s*:|-{2,}\s*(?:original message|forwarded message)\s*-{2,}|_{10,})\s*$/i;

/**
 * The new part of a reply: everything above the first quoted line or
 * quote introduction ("On … wrote:"). Falls back to the whole text when
 * nothing is left.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(">") || QUOTE_INTRO.test(line.trim())) break;
    kept.push(line);
  }
  const result = kept.join("\n").trim();
  return result || text.trim();
}

/** The plain text of a message: text/plain, else its HTML as text. */
export function mailBodyText(mail: ParsedMail): string {
  const text = mail.text.replace(/\r\n?/g, "\n").trim();
  return text || htmlToText(mail.html);
}
