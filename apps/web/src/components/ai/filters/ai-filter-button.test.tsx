import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiFilterButton from "./ai-filter-button";

const m = vi.hoisted(() => ({
  available: true,
  calls: [] as Array<Record<string, unknown>>,
  result: {
    filters: {
      op: "and",
      children: [{ key: "assignee", operator: "in", values: ["me"] }],
    },
    dropped: [] as string[],
  } as { filters: unknown; dropped: string[] },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/fetchers/ai/filters", () => ({
  parseTaskFilter: async (body: Record<string, unknown>) => {
    m.calls.push(body);
    return m.result;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  m.available = true;
  m.calls = [];
  m.result = {
    filters: {
      op: "and",
      children: [{ key: "assignee", operator: "in", values: ["me"] }],
    },
    dropped: [],
  };
});

function renderButton(onApply = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AiFilterButton
        workspaceId="ws-1"
        scope={{ kind: "project", projectId: "p-1" }}
        onApply={onApply}
      />
    </QueryClientProvider>,
  );
  return onApply;
}

async function describeFilter(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "ai:filters.button" }));
  const input = await screen.findByLabelText("ai:filters.label");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

describe("natural-language filters", () => {
  it("is hidden while AI is off", () => {
    m.available = false;
    renderButton();
    expect(
      screen.queryByRole("button", { name: "ai:filters.button" }),
    ).toBeNull();
  });

  it("applies the understood filter for the project", async () => {
    const onApply = renderButton();
    await describeFilter("my tasks");
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(m.calls).toEqual([
      {
        workspaceId: "ws-1",
        text: "my tasks",
        projectId: "p-1",
        locale: "en-US",
      },
    ]);
    expect(onApply).toHaveBeenCalledWith(m.result.filters);
  });

  it("lists what it didn't understand and keeps the popover open", async () => {
    m.result = { ...m.result, dropped: ["Sprint 9"] };
    const onApply = renderButton();
    await describeFilter("my tasks in Sprint 9");
    expect(
      await screen.findByText(/ai:filters.dropped .*Sprint 9/),
    ).toBeInTheDocument();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("says so when nothing could be used", async () => {
    m.result = { filters: null, dropped: ["gibberish"] };
    const onApply = renderButton();
    await describeFilter("gibberish");
    expect(await screen.findByText("ai:filters.none")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
