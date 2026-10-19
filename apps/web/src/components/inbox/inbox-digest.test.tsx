import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InboxDigestButton,
  InboxDigestPanel,
  useInboxDigest,
} from "./inbox-digest";

const m = vi.hoisted(() => ({
  available: true,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));
vi.mock("@/components/editor/ai/ai-feedback-buttons", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/fetchers/insight/insight", () => ({
  streamInboxDigest: async (
    body: Record<string, unknown>,
    handlers: { onDelta?: (text: string) => void },
  ) => {
    m.calls.push(body);
    handlers.onDelta?.("**Ada** mentioned you on [WEB-1].");
    return "";
  },
}));

afterEach(cleanup);
beforeEach(() => {
  m.available = true;
  m.calls = [];
});

function Inbox({ unread }: { unread: number }) {
  const digest = useInboxDigest("ws-1");
  return (
    <>
      <InboxDigestButton digest={digest} unread={unread} />
      <InboxDigestPanel digest={digest} />
    </>
  );
}

describe("inbox digest", () => {
  it("summarizes unread notifications on request and closes", async () => {
    render(<Inbox unread={3} />);
    fireEvent.click(
      screen.getByRole("button", { name: "notifications:inbox.digest.button" }),
    );
    expect(m.calls).toEqual([{ workspaceId: "ws-1", locale: "en-US" }]);
    const panel = await screen.findByRole("region", {
      name: "notifications:inbox.digest.title",
    });
    expect(panel).toHaveTextContent("Ada mentioned you on [WEB-1].");
    fireEvent.click(
      screen.getByRole("button", { name: "notifications:inbox.digest.close" }),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("is disabled with nothing unread and hidden without AI", () => {
    const first = render(<Inbox unread={0} />);
    expect(
      screen.getByRole("button", { name: "notifications:inbox.digest.button" }),
    ).toBeDisabled();
    first.unmount();
    m.available = false;
    render(<Inbox unread={5} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
