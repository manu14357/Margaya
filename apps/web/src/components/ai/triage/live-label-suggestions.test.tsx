import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveLabelSuggestions, {
  LABEL_SUGGEST_DELAY_MS,
} from "./live-label-suggestions";

const m = vi.hoisted(() => ({
  available: true,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${options.name}` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/fetchers/ai/triage", () => ({
  suggestDraftLabels: async (body: Record<string, unknown>) => {
    m.calls.push(body);
    return {
      labels: [
        { labelId: "bug", name: "Bug", color: "#f00", reason: "A crash" },
        { labelId: "ui", name: "UI", color: "#0f0", reason: null },
      ],
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  m.available = true;
  m.calls = [];
  vi.useFakeTimers();
});

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(LABEL_SUGGEST_DELAY_MS);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("live label suggestions", () => {
  it("asks after a pause in typing and adds a label with one click", async () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <LiveLabelSuggestions
        projectId="p-1"
        title="Login cr"
        description=""
        selectedLabelIds={["ui"]}
        onAdd={onAdd}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(LABEL_SUGGEST_DELAY_MS - 100);
    });
    // Still typing: the earlier title never goes out.
    rerender(
      <LiveLabelSuggestions
        projectId="p-1"
        title="Login crashes"
        description="On Safari"
        selectedLabelIds={["ui"]}
        onAdd={onAdd}
      />,
    );
    await settle();
    expect(m.calls).toEqual([
      {
        projectId: "p-1",
        title: "Login crashes",
        description: "On Safari",
        labelIds: ["ui"],
        locale: "en-US",
      },
    ]);
    // UI is already picked, so only Bug shows.
    expect(screen.queryByRole("button", { name: /UI/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "ai:triage.liveLabels.add Bug" }),
    );
    expect(onAdd).toHaveBeenCalledWith({
      id: "bug",
      name: "Bug",
      color: "#f00",
    });
  });

  it("stays quiet for short titles, without AI or without the right", async () => {
    const { rerender } = render(
      <LiveLabelSuggestions
        projectId="p-1"
        title="ab"
        description=""
        selectedLabelIds={[]}
        onAdd={vi.fn()}
      />,
    );
    await settle();
    rerender(
      <LiveLabelSuggestions
        projectId="p-1"
        title="Login crashes"
        description=""
        selectedLabelIds={[]}
        enabled={false}
        onAdd={vi.fn()}
      />,
    );
    await settle();
    expect(m.calls).toHaveLength(0);
  });
});
