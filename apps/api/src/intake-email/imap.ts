import net from "node:net";
import tls from "node:tls";
import type { ImapMailbox } from "./config";

// A deliberately small IMAP4rev1 client (RFC 3501) for email intake (#8):
// LOGIN, SELECT, UID SEARCH UNSEEN, UID FETCH (size, then the full
// message) and UID STORE +FLAGS (\Seen). Always encrypted: implicit TLS or
// STARTTLS, with certificate checks on. Nothing else of IMAP is needed to
// turn unread mail into requests, and a dependency-free client keeps the
// install lean.

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 64 * 1024;

export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImapError";
  }
}

type Response = { lines: string[]; literals: Buffer[]; tagged: string };

/** Quotes a string for IMAP; refuses what a quoted string can't carry. */
export function imapQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new ImapError("Value contains characters IMAP can't send");
  }
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** The UIDs of a `* SEARCH 1 2 3` response. */
export function parseSearchResponse(lines: readonly string[]): number[] {
  const uids: number[] = [];
  for (const line of lines) {
    const match = /^\* SEARCH\b(.*)$/i.exec(line);
    if (!match?.[1]) continue;
    for (const part of match[1].trim().split(/\s+/)) {
      const uid = Number(part);
      if (Number.isSafeInteger(uid) && uid > 0) uids.push(uid);
    }
  }
  return uids;
}

/** RFC822.SIZE from a FETCH response, or null. */
export function parseFetchSize(lines: readonly string[]): number | null {
  for (const line of lines) {
    const match = /RFC822\.SIZE (\d+)/i.exec(line);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

export class ImapClient {
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private failure: Error | null = null;
  private tag = 0;

  private constructor(private socket: net.Socket | tls.TLSSocket) {
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.setTimeout(COMMAND_TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    socket.on("timeout", () => {
      this.fail(new ImapError("The mail server stopped answering"));
      socket.destroy();
    });
    socket.on("error", (error) => {
      this.fail(new ImapError(`Connection failed: ${error.message}`));
    });
    socket.on("close", () => {
      this.fail(new ImapError("The mail server closed the connection"));
    });
  }

  private fail(error: Error) {
    if (!this.failure) this.failure = error;
    this.wake();
  }

  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  private async waitForData(): Promise<void> {
    if (this.failure) throw this.failure;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.failure && this.buffer.length === 0) throw this.failure;
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = this.buffer.subarray(0, end).toString("latin1");
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      if (this.buffer.length > MAX_LINE_BYTES) {
        throw new ImapError("The mail server sent an overlong line");
      }
      await this.waitForData();
    }
  }

  private async readBytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) await this.waitForData();
    const bytes = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return Buffer.from(bytes);
  }

  /** One response line with its literals ({n} then n bytes) folded in. */
  private async readResponse(maxLiteral: number) {
    let text = "";
    const literals: Buffer[] = [];
    for (;;) {
      const line = await this.readLine();
      const literal = /\{(\d+)\+?\}$/.exec(line);
      if (!literal?.[1]) return { text: text + line, literals };
      const size = Number(literal[1]);
      if (size > maxLiteral) {
        throw new ImapError("The message is larger than the size limit");
      }
      literals.push(await this.readBytes(size));
      text += line;
    }
  }

  private write(data: string) {
    this.socket.write(data);
  }

  async command(command: string, maxLiteral = 0): Promise<Response> {
    this.tag += 1;
    const tag = `M${this.tag}`;
    this.write(`${tag} ${command}\r\n`);
    const lines: string[] = [];
    const literals: Buffer[] = [];
    for (;;) {
      const response = await this.readResponse(maxLiteral);
      if (response.text.startsWith(`${tag} `)) {
        const status = response.text.slice(tag.length + 1);
        if (!/^OK\b/i.test(status)) {
          // The server's own words, without the command (it may hold the
          // password).
          throw new ImapError(
            `The mail server refused ${command.split(" ")[0]}: ${status.slice(0, 200)}`,
          );
        }
        return { lines, literals, tagged: status };
      }
      lines.push(response.text);
      literals.push(...response.literals);
    }
  }

  static async connect(
    mailbox: Pick<ImapMailbox, "host" | "port" | "security">,
    address?: string,
  ): Promise<ImapClient> {
    const host = address ?? mailbox.host;
    const servername = net.isIP(mailbox.host) ? undefined : mailbox.host;
    if (mailbox.security === "tls") {
      const socket = tls.connect({ host, port: mailbox.port, servername });
      const client = new ImapClient(socket);
      await client.greeting();
      return client;
    }
    const plain = net.connect({ host, port: mailbox.port });
    const client = new ImapClient(plain);
    await client.greeting();
    await client.command("STARTTLS");
    plain.removeAllListeners("data");
    plain.removeAllListeners("timeout");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    client.buffer = Buffer.alloc(0);
    const secure = tls.connect({ socket: plain, servername });
    await new Promise<void>((resolve, reject) => {
      secure.once("secureConnect", () => resolve());
      secure.once("error", (error) =>
        reject(new ImapError(`TLS failed: ${error.message}`)),
      );
    });
    client.socket = secure;
    client.attach(secure);
    return client;
  }

  private async greeting() {
    const { text } = await this.readResponse(0);
    if (!/^\* (OK|PREAUTH)\b/i.test(text)) {
      throw new ImapError("The mail server refused the connection");
    }
  }

  async login(username: string, password: string) {
    await this.command(`LOGIN ${imapQuote(username)} ${imapQuote(password)}`);
  }

  async select(folder: string) {
    await this.command(`SELECT ${imapQuote(folder)}`);
  }

  async searchUnseen(): Promise<number[]> {
    const { lines } = await this.command("UID SEARCH UNSEEN");
    return parseSearchResponse(lines);
  }

  async fetchSize(uid: number): Promise<number | null> {
    const { lines } = await this.command(`UID FETCH ${uid} (RFC822.SIZE)`);
    return parseFetchSize(lines);
  }

  /** The raw message; BODY.PEEK leaves it unread until `markSeen`. */
  async fetchMessage(uid: number, maxBytes: number): Promise<Buffer | null> {
    const { literals } = await this.command(
      `UID FETCH ${uid} (BODY.PEEK[])`,
      maxBytes,
    );
    return literals[0] ?? null;
  }

  async markSeen(uid: number) {
    await this.command(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
  }

  async logout() {
    try {
      await this.command("LOGOUT");
    } catch {
      // The server closes the connection on LOGOUT; that's the point.
    } finally {
      this.socket.destroy();
    }
  }

  close() {
    this.socket.destroy();
  }
}
