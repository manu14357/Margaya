import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callSlack } from "../../../apps/api/src/slack-app/web-api";

// Slack reads JSON bodies only on write methods; read methods such as
// chat.getPermalink need form fields, or they answer "missing required field".

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, permalink: "https://x" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    contentType: (init.headers as Record<string, string>)["content-type"],
    body: String(init.body),
  };
};

describe("callSlack", () => {
  it("sends chat.getPermalink as form fields", async () => {
    await callSlack("xoxb-test", "chat.getPermalink", {
      channel: "C123",
      message_ts: "1700000000.000100",
    });
    const request = lastRequest();
    expect(request.url).toBe("https://slack.com/api/chat.getPermalink");
    expect(request.contentType).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(request.body);
    expect(form.get("channel")).toBe("C123");
    expect(form.get("message_ts")).toBe("1700000000.000100");
  });

  it("keeps JSON for write methods, nested blocks included", async () => {
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Hi" } }];
    await callSlack("xoxb-test", "chat.postMessage", {
      channel: "C123",
      blocks,
    });
    const request = lastRequest();
    expect(request.contentType).toBe("application/json; charset=utf-8");
    expect(JSON.parse(request.body)).toEqual({ channel: "C123", blocks });
  });

  it("throws Slack's error code when Slack says no", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "not_in_channel" })),
    );
    await expect(
      callSlack("xoxb-test", "chat.getPermalink", { channel: "C1" }),
    ).rejects.toMatchObject({ code: "not_in_channel" });
  });
});
