import { MAILPIT_URL } from "./env";

// A small client for the MailPit HTTP API (compose.e2e.yml). The e2e API sends
// every email to MailPit, so specs can assert on invitations, reminders and
// sign-in codes. API reference: https://mailpit.axllent.org/docs/api-v1/

export type MailpitAddress = { Name: string; Address: string };

export type MailpitSummary = {
  ID: string;
  MessageID: string;
  Read: boolean;
  From: MailpitAddress;
  To: MailpitAddress[];
  Cc: MailpitAddress[] | null;
  Subject: string;
  Created: string;
  Snippet: string;
};

export type MailpitMessage = MailpitSummary & {
  Date: string;
  Text: string;
  HTML: string;
};

type MailpitList = { total: number; messages: MailpitSummary[] };

export type WaitForMessageOptions = {
  /** Recipient address. */
  to?: string;
  /** Substring of the subject, case-insensitive. */
  subject?: string;
  /** Extra MailPit search terms, e.g. `from:noreply@margaya.test`. */
  query?: string;
  /** Only messages received at or after this time. */
  since?: Date;
  timeoutMs?: number;
};

export class MailpitClient {
  constructor(readonly baseURL: string = MAILPIT_URL) {}

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseURL), init);
    if (!response.ok) {
      throw new Error(
        `MailPit ${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`,
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.request("/api/v1/info");
      return true;
    } catch {
      return false;
    }
  }

  /** Newest first. */
  async list(limit = 50): Promise<MailpitSummary[]> {
    const body = await this.request<MailpitList>(
      `/api/v1/messages?limit=${limit}`,
    );
    return body.messages;
  }

  /** MailPit search syntax, e.g. `to:member@margaya.test subject:"invited"`. Newest first. */
  async search(query: string, limit = 50): Promise<MailpitSummary[]> {
    const body = await this.request<MailpitList>(
      `/api/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return body.messages;
  }

  async getMessage(id: string): Promise<MailpitMessage> {
    return this.request<MailpitMessage>(
      `/api/v1/message/${encodeURIComponent(id)}`,
    );
  }

  /** Poll until a matching message arrives and return it in full. */
  async waitForMessage({
    to,
    subject,
    query,
    since,
    timeoutMs = 15_000,
  }: WaitForMessageOptions): Promise<MailpitMessage> {
    const terms = [
      to ? `to:${to}` : "",
      subject ? `subject:"${subject.replaceAll('"', "")}"` : "",
      query ?? "",
    ].filter(Boolean);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = terms.length
        ? await this.search(terms.join(" "))
        : await this.list();
      const match = messages.find(
        (message) =>
          (!since || new Date(message.Created).getTime() >= since.getTime()) &&
          (!subject ||
            message.Subject.toLowerCase().includes(subject.toLowerCase())),
      );
      if (match) return this.getMessage(match.ID);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `No email matching ${JSON.stringify({ to, subject, query })} within ${timeoutMs}ms`,
    );
  }

  async deleteAll(): Promise<void> {
    await this.request("/api/v1/messages", { method: "DELETE" });
  }

  /** Delete the messages matching a search, e.g. `to:viewer@margaya.test`. */
  async deleteMatching(query: string): Promise<void> {
    await this.request(`/api/v1/search?query=${encodeURIComponent(query)}`, {
      method: "DELETE",
    });
  }
}

/** Every http(s) link in the message's HTML and text parts. */
export function extractLinks(message: MailpitMessage): string[] {
  const links = new Set<string>();
  for (const match of message.HTML.matchAll(/href="([^"]+)"/g)) {
    if (match[1]?.startsWith("http"))
      links.add(match[1].replaceAll("&amp;", "&"));
  }
  for (const match of message.Text.matchAll(/https?:\/\/[^\s<>")]+/g)) {
    links.add(match[0]);
  }
  return [...links];
}

/** The first one-time code in the message text (6 digits by default). */
export function extractCode(
  message: MailpitMessage,
  pattern: RegExp = /\b(\d{6})\b/,
): string | null {
  const match = pattern.exec(message.Text) ?? pattern.exec(message.HTML);
  return match?.[1] ?? match?.[0] ?? null;
}
