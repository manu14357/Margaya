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
import { SettingSwitchRow } from "./setting-row";

const save = vi.fn(async (_values: Record<string, unknown>) => true);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("./use-save-instance-settings", () => ({
  useSaveInstanceSettings: () => ({ save, isPending: false }),
}));

const KEY = "general.publicLanding";

function settingsWith(
  overrides: Partial<InstanceSettingEntry> = {},
  locked = false,
): InstanceSettings {
  const entry = {
    key: KEY,
    group: "general",
    value: true,
    source: "default",
    locked: false,
    envVar: null,
    secret: false,
    configured: false,
    unreadable: false,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  } as InstanceSettingEntry;
  return {
    locked,
    settings: [entry],
    derived: {
      smtpConfigured: false,
      guestAccessActive: true,
      emailCodeActive: false,
      signInMethodsActive: 1,
      providers: {},
    },
  } as unknown as InstanceSettings;
}

function renderToggle(settings: InstanceSettings) {
  render(
    <SettingSwitchRow
      settings={settings}
      settingKey={KEY}
      label="instanceAdmin:general.publicLanding"
      hint="instanceAdmin:general.publicLandingHint"
    />,
  );
  return screen.getByRole("switch", {
    name: "instanceAdmin:general.publicLanding",
  });
}

describe("public landing toggle", () => {
  afterEach(() => {
    cleanup();
    save.mockClear();
  });

  it("shows the landing as on by default", () => {
    const toggle = renderToggle(settingsWith());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("instanceAdmin:general.publicLandingHint"),
    ).toBeInTheDocument();
  });

  it("saves the new value when switched", async () => {
    const toggle = renderToggle(settingsWith());
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ [KEY]: false }));
  });

  it("switches a saved off value back on", async () => {
    const toggle = renderToggle(
      settingsWith({ value: false, source: "database" }),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ [KEY]: true }));
  });

  it("is read-only when MARGAYA_PUBLIC_LANDING sets it", () => {
    const toggle = renderToggle(
      settingsWith({
        value: false,
        source: "environment",
        locked: true,
        envVar: "MARGAYA_PUBLIC_LANDING",
      }),
    );
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("instanceAdmin:source.environment"),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(save).not.toHaveBeenCalled();
  });
});
