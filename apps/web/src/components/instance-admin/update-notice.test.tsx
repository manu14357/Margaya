import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus } from "@/types/instance-admin";

const state = vi.hoisted(() => ({
  role: "admin" as string | undefined,
  status: undefined as unknown,
  enabledArg: undefined as boolean | undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: state.role } } }),
  },
}));
vi.mock("@/hooks/queries/instance-admin/use-instance-admin", () => ({
  useInstanceUpdateStatus: (enabled: boolean) => {
    state.enabledArg = enabled;
    return { data: enabled ? state.status : undefined };
  },
}));

const { UpdateBanner, UpdateStatusLine, shouldShowUpdateBanner } = await import(
  "./update-notice"
);

const available: InstanceUpdateStatus = {
  enabled: true,
  currentVersion: "1.4.0",
  latestVersion: "1.5.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/manu14357/Margaya/releases/tag/v1.5.0",
  publishedAt: null,
  checkedAt: null,
  error: null,
};

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  state.role = "admin";
  state.status = available;
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("shouldShowUpdateBanner", () => {
  it("shows only an enabled, newer, undismissed version", () => {
    expect(shouldShowUpdateBanner(available, null)).toBe(true);
    expect(shouldShowUpdateBanner(available, "1.5.0")).toBe(false);
    expect(shouldShowUpdateBanner(available, "1.4.9")).toBe(true);
    expect(
      shouldShowUpdateBanner({ ...available, updateAvailable: false }, null),
    ).toBe(false);
    expect(shouldShowUpdateBanner({ ...available, enabled: false }, null)).toBe(
      false,
    );
    expect(shouldShowUpdateBanner(undefined, null)).toBe(false);
  });
});

describe("UpdateBanner", () => {
  it("shows instance admins the new version and hides after Dismiss", () => {
    render(wrap(<UpdateBanner />));
    expect(screen.getByText("instanceAdmin:update.bannerTitle")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "instanceAdmin:update.releaseNotes" })
        .getAttribute("href"),
    ).toBe(available.releaseUrl);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:update.dismiss" }),
    );
    expect(screen.queryByText("instanceAdmin:update.bannerTitle")).toBeNull();
    expect(window.localStorage.getItem("margaya:update-notice-dismissed")).toBe(
      "1.5.0",
    );
  });

  it("never asks or shows anything for other people", () => {
    state.role = "user";
    render(wrap(<UpdateBanner />));
    expect(state.enabledArg).toBe(false);
    expect(screen.queryByText("instanceAdmin:update.bannerTitle")).toBeNull();
  });
});

describe("UpdateStatusLine", () => {
  it("says when the check is off, failing or up to date", () => {
    const { rerender } = render(
      <UpdateStatusLine status={{ ...available, enabled: false }} />,
    );
    expect(screen.getByText("instanceAdmin:update.off")).toBeTruthy();
    rerender(
      <UpdateStatusLine
        status={{ ...available, latestVersion: null, error: "unreachable" }}
      />,
    );
    expect(
      screen.getByText("instanceAdmin:update.errorUnreachable"),
    ).toBeTruthy();
    rerender(
      <UpdateStatusLine status={{ ...available, updateAvailable: false }} />,
    );
    expect(screen.getByText("instanceAdmin:update.upToDate")).toBeTruthy();
  });
});
