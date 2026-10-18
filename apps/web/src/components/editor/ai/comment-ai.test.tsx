import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentAiButton, CommentAiPreview, useCommentAi } from "./comment-ai";

const m = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: "Could you check the cookie expiry?",
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));
vi.mock("@/hooks/use-guest-locale", () => ({
  GUEST_LOCALES: [{ code: "de-DE", nativeName: "Deutsch" }],
}));
vi.mock("./ai-feedback-buttons", () => ({ default: () => null }));
vi.mock("@/fetchers/ai/writing", () => ({
  streamEditorAssist: async (
    body: Record<string, unknown>,
    handlers: { onDelta?: (text: string) => void },
  ) => {
    m.calls.push(body);
    handlers.onDelta?.(m.reply);
    return m.reply;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  m.calls = [];
  window.localStorage.clear();
});

function Composer() {
  const [draft, setDraft] = useState("cookie expires too early i think??");
  const ai = useCommentAi({
    workspaceId: "ws-1",
    taskId: "task-1",
    getDraft: () => draft,
    onApply: setDraft,
  });
  return (
    <div>
      <output aria-label="draft">{draft}</output>
      <CommentAiButton ai={ai} />
      <CommentAiPreview ai={ai} />
    </div>
  );
}

async function pick(label: string) {
  fireEvent.click(
    screen.getByRole("button", { name: "ai:writing.comment.menuLabel" }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
}

describe("comment AI", () => {
  it("rewrites the draft as a comment draft and replaces it on request", async () => {
    render(<Composer />);
    await pick("ai:writing.actions.improve");
    expect(m.calls).toEqual([
      {
        workspaceId: "ws-1",
        target: { kind: "comment_draft", id: "task-1" },
        action: "improve",
        text: "cookie expires too early i think??",
        locale: "en-US",
      },
    ]);
    const suggestion = await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    expect(suggestion).toHaveValue(m.reply);
    // Nothing changes before Replace.
    expect(screen.getByLabelText("draft")).toHaveTextContent("i think??");
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.comment.replace/ }),
    );
    expect(screen.getByLabelText("draft")).toHaveTextContent(m.reply);
    expect(
      screen.queryByRole("region", { name: "ai:writing.comment.previewLabel" }),
    ).toBeNull();
  });

  it("switches the tone of a rewrite", async () => {
    render(<Composer />);
    await pick("ai:writing.actions.shorter");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.tone.casual" }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect(m.calls[1]).toMatchObject({ action: "shorter", tone: "casual" });
  });

  it("discards without touching the draft", async () => {
    render(<Composer />);
    await pick("ai:writing.actions.fix");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.preview.discard" }),
    );
    expect(screen.getByLabelText("draft")).toHaveTextContent("i think??");
  });
});
