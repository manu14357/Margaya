import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InstanceSettingEntry,
  InstanceSettings,
} from "@/types/instance-admin";
import { InstanceAiSettingsPage } from "./instance-ai-settings";

// Settings → Instance → AI: the "Keep prompts and answers" switch
// (ai.retention.storePrompts), off by default.

const m = vi.hoisted(() => ({
  save: vi.fn(async (_values: Record<string, unknown>) => true),
  settings: null as unknown,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/components/instance-admin/use-save-instance-settings", () => ({
  useSaveInstanceSettings: () => ({ save: m.save, isPending: false }),
}));
vi.mock("@/hooks/queries/instance-admin/use-instance-admin", () => ({
  useInstanceSettings: () => ({
    data: m.settings,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useInstanceAiStatus: () => ({ data: undefined }),
  useInstanceAiUsage: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("./ai-usage-dashboard", () => ({
  AiUsageDashboard: () => null,
  UsageRangeSelect: () => null,
}));
vi.mock("./ai-test-button", () => ({ AiTestButton: () => null }));
vi.mock("@/fetchers/ai/ai", () => ({ testInstanceAiConnection: vi.fn() }));

const KEY = "ai.retention.storePrompts";

function settingsWith(entry: Partial<InstanceSettingEntry> = {}) {
  const row = (key: string, value: unknown) =>
    ({
      key,
      group: "ai",
      value,
      source: "default",
      locked: false,
      envVar: null,
      secret: false,
      configured: false,
      unreadable: false,
      updatedAt: null,
      updatedBy: null,
    }) as InstanceSettingEntry;
  return {
    locked: false,
    settings: [
      row("ai.enabled", false),
      row("ai.zeroRetention", false),
      { ...row(KEY, false), ...entry },
    ],
    derived: {},
  } as unknown as InstanceSettings;
}

function renderPage(settings: InstanceSettings) {
  m.settings = settings;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstanceAiSettingsPage />
    </QueryClientProvider>,
  );
  return screen.getByRole("switch", { name: "ai:instance.storePrompts" });
}

describe("keep prompts and answers", () => {
  afterEach(() => {
    cleanup();
    m.save.mockClear();
  });

  it("is off by default and explains what it keeps", () => {
    const toggle = renderPage(settingsWith());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("ai:instance.storePromptsHint"),
    ).toBeInTheDocument();
  });

  it("saves the instance setting when turned on", async () => {
    const toggle = renderPage(settingsWith());
    fireEvent.click(toggle);
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({ [KEY]: true }));
  });

  it("is read-only when MARGAYA_AI_STORE_PROMPTS sets it", () => {
    const toggle = renderPage(
      settingsWith({
        value: true,
        source: "environment",
        locked: true,
        envVar: "MARGAYA_AI_STORE_PROMPTS",
      }),
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(toggle);
    expect(m.save).not.toHaveBeenCalled();
  });
});
