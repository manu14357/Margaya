import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  pathname: "/dashboard/settings/account/preferences",
  role: "user" as string,
  projects: [] as Array<{ id: string; name: string; icon: string }>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: ({
    select,
  }: {
    select: (location: { pathname: string }) => string;
  }) => select({ pathname: m.pathname }),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u1", role: m.role } } }),
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1", name: "Studio" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWebhooks: () => true,
    canReadAuditLog: () => true,
    isCheckingPermissions: false,
    isGuest: false,
  }),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { instanceName: "Margaya" } }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({
    data: { instanceEnabled: false },
    canManage: false,
    canUse: false,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: m.projects }),
}));

import { SettingsInlineNav } from "./settings-nav";

afterEach(cleanup);
beforeEach(() => {
  m.pathname = "/dashboard/settings/account/preferences";
  m.role = "user";
  m.projects = [{ id: "p1", name: "Website", icon: "Folder" }];
});

function pageTabs() {
  return screen.getByRole("navigation", { name: "settings:nav.pageLabel" });
}

describe("settings navigation with the side panel closed", () => {
  it("shows the area's pages as tabs instead of a menu", () => {
    render(<SettingsInlineNav />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const links = within(pageTabs()).getAllByRole("link");
    expect(links.length).toBeGreaterThan(2);
    const current = within(pageTabs()).getByRole("link", {
      current: "page",
    });
    expect(current).toHaveAttribute(
      "href",
      "/dashboard/settings/account/preferences",
    );
  });

  it("splits the instance pages into their groups", () => {
    m.role = "admin";
    m.pathname = "/dashboard/settings/instance/integrations";
    render(<SettingsInlineNav />);
    const row = pageTabs();
    expect(within(row).getByRole("link", { current: "page" })).toHaveAttribute(
      "href",
      "/dashboard/settings/instance/integrations",
    );
    // One divider between the Instance and Server groups.
    expect(row.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
  });

  it("keeps the project picker for project settings", () => {
    m.pathname = "/dashboard/settings/projects/p1/integrations";
    render(<SettingsInlineNav />);
    expect(
      screen.getByRole("combobox", {
        name: "navigation:projectSettings.projectLabel",
      }),
    ).toBeInTheDocument();
    expect(
      within(pageTabs()).getByRole("link", { current: "page" }),
    ).toHaveAttribute("href", "/dashboard/settings/projects/p1/integrations");
  });
});
