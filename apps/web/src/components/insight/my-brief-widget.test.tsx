import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyBriefWidget from "./my-brief-widget";

const mocks = vi.hoisted(() => ({
  markdownLoaded: vi.fn(),
  start: vi.fn(),
  stream: { status: "idle", text: "", errorKey: null as string | null },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
// The real renderer: the test checks the summary still renders as Markdown.
vi.mock("@/components/ai/ai-markdown", async (importOriginal) => {
  mocks.markdownLoaded();
  return importOriginal();
});
vi.mock("@/components/editor/ai/use-ai-locale", () => ({
  useAiLocale: () => null,
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: true }),
}));
vi.mock("@/hooks/use-ai-text-stream", () => ({
  useAiTextStream: () => ({ ...mocks.stream, start: mocks.start }),
}));
const group = { total: 0, items: [] };
vi.mock("@/hooks/queries/insight/use-insight", () => ({
  useMyBrief: () => ({
    data: {
      overdue: {
        total: 1,
        items: [
          {
            id: "t1",
            key: "WEB-1",
            title: "Fix login",
            projectId: "p1",
            projectName: "Web",
          },
        ],
      },
      dueToday: group,
      blocked: group,
      mentions: group,
      following: group,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  mocks.stream = { status: "idle", text: "", errorKey: null };
  vi.clearAllMocks();
});

describe("MyBriefWidget summary", () => {
  it("loads the Markdown renderer only for a summary, then renders it", async () => {
    const { rerender } = render(
      <MyBriefWidget workspaceId="w1" onOpenTask={vi.fn()} />,
    );
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(mocks.markdownLoaded).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "insight:myBrief.summarize" }),
    );
    expect(mocks.start).toHaveBeenCalledTimes(1);

    mocks.stream = {
      status: "done",
      text: "One task is **overdue**.",
      errorKey: null,
    };
    rerender(<MyBriefWidget workspaceId="w1" onOpenTask={vi.fn()} />);
    expect(
      await screen.findByText("overdue", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(mocks.markdownLoaded).toHaveBeenCalledTimes(1);
  });
});
