import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SimilarTaskHints from "./similar-task-hints";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

let available = false;
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available }),
}));

const checkDuplicatesWithAi = vi.fn();
vi.mock("@/fetchers/ai/build", () => ({
  checkDuplicatesWithAi: (body: unknown) => checkDuplicatesWithAi(body),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const tasks = [
  { id: "t1", key: "WEB-1", title: "Login page breaks on Safari" },
  { id: "t2", key: "WEB-2", title: "Safari login is slow" },
];

function renderHints(props: Partial<Parameters<typeof SimilarTaskHints>[0]>) {
  return render(
    <SimilarTaskHints
      tasks={tasks}
      taskHref={(id) => `/task/${id}`}
      onDismiss={vi.fn()}
      ai={{ projectId: "p1", title: "Safari login broken", description: "" }}
      {...props}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  available = false;
  checkDuplicatesWithAi.mockReset();
});
afterEach(cleanup);

describe("SimilarTaskHints", () => {
  it("shows the full-text hints without any AI control when AI is off", () => {
    renderHints({});
    expect(screen.getByText("Login page breaks on Safari")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ai:duplicates.check/ }),
    ).not.toBeInTheDocument();
  });

  it("re-ranks with AI on request and shows verdicts with reasons", async () => {
    available = true;
    checkDuplicatesWithAi.mockResolvedValue({
      tasks: [
        {
          ...tasks[0],
          status: "to-do",
          verdict: "duplicate",
          reason: "Same bug, other words",
        },
      ],
    });
    renderHints({});
    fireEvent.click(
      screen.getByRole("button", { name: /ai:duplicates.check/ }),
    );
    expect(
      await screen.findByText("ai:duplicates.verdict.duplicate"),
    ).toBeInTheDocument();
    expect(screen.getByText("Same bug, other words")).toBeInTheDocument();
    expect(screen.queryByText("Safari login is slow")).not.toBeInTheDocument();
    expect(checkDuplicatesWithAi).toHaveBeenCalledWith({
      projectId: "p1",
      title: "Safari login broken",
    });
  });

  it("offers marking a hint as the duplicate target", () => {
    const onMarkDuplicate = vi.fn();
    renderHints({ onMarkDuplicate, markedId: "t2" });
    const buttons = screen.getAllByRole("button", {
      name: "ai:duplicates.markLabel",
    });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onMarkDuplicate).toHaveBeenCalledWith(tasks[0]);
    expect(screen.getByText("ai:duplicates.marked")).toBeInTheDocument();
  });
});
