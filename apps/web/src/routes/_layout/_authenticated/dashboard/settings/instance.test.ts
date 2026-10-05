import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
// Importing the whole route tree loads every screen (minutes in jsdom), so
// the generated wiring is checked as text instead.
import routeTreeSource from "@/routeTree.gen.ts?raw";
import { Route as InstanceRoute } from "./instance";
import { Route as InstanceIndexRoute } from "./instance/index";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PAGES = [
  ["general", "General"],
  ["authentication", "Authentication"],
  ["email", "Email"],
  ["workspaces", "Workspaces"],
  ["public-boards", "PublicBoards"],
  ["admins", "Admins"],
] as const;

const PREFIX = "LayoutAuthenticatedDashboardSettingsInstance";

/** The `.update({...})` block the generator writes for one route. */
function routeBlock(name: string) {
  const start = routeTreeSource.indexOf(`const ${name} =`);
  if (start === -1) return "";
  return routeTreeSource.slice(
    start,
    routeTreeSource.indexOf("} as any", start),
  );
}

type BeforeLoad = (options: unknown) => unknown;

function runBeforeLoad(beforeLoad: unknown, context: unknown) {
  try {
    (beforeLoad as BeforeLoad)({ context });
    return null;
  } catch (thrown) {
    return thrown;
  }
}

describe("instance settings routes", () => {
  it("nests the Instance layout under the settings layout", () => {
    const block = routeBlock(`${PREFIX}Route`);
    expect(block).toContain("path: '/instance'");
    expect(block).toContain(
      "getParentRoute: () => LayoutAuthenticatedDashboardSettingsRoute",
    );
  });

  it.each(PAGES)("nests /dashboard/settings/instance/%s", (path, name) => {
    const block = routeBlock(`${PREFIX}${name}Route`);
    expect(block).toContain(`path: '/${path}'`);
    expect(block).toContain(`getParentRoute: () => ${PREFIX}Route`);
    expect(routeTreeSource).toContain(
      `'/dashboard/settings/instance/${path}': typeof ${PREFIX}${name}Route`,
    );
  });

  it("redirects the bare path to General", () => {
    expect(routeBlock(`${PREFIX}IndexRoute`)).toContain(
      `getParentRoute: () => ${PREFIX}Route`,
    );
    const thrown = runBeforeLoad(InstanceIndexRoute.options.beforeLoad, {});
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe(
      "/dashboard/settings/instance/general",
    );
  });

  it("lets instance admins in and sends everyone else to account settings", () => {
    const beforeLoad = InstanceRoute.options.beforeLoad;
    expect(
      runBeforeLoad(beforeLoad, {
        session: { user: { role: "admin" } },
        sessionError: false,
      }),
    ).toBeNull();
    // An unknown session (fetch failed) is left to the API's 403.
    expect(
      runBeforeLoad(beforeLoad, { session: null, sessionError: true }),
    ).toBeNull();

    const thrown = runBeforeLoad(beforeLoad, {
      session: { user: { role: "user" } },
      sessionError: false,
    });
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe(
      "/dashboard/settings/account/information",
    );
  });
});
