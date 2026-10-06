import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (options: unknown) => ({ redirect: options }),
}));
vi.mock("@/fetchers/config/get-config", () => ({ getConfig: m.getConfig }));
vi.mock("@/components/landing/public-landing", () => ({
  default: () => <main>landing page</main>,
}));

type BeforeLoad = (args: {
  context: { user: unknown; queryClient: QueryClient };
}) => Promise<void>;

const { Route } = await import("./index");
const { beforeLoad, component: RootLanding } = (
  Route as unknown as {
    options: { beforeLoad: BeforeLoad; component: ComponentType };
  }
).options;

function run(user: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return beforeLoad({ context: { user, queryClient } });
}

const toDashboard = { redirect: { to: "/dashboard" } };

describe("root route", () => {
  beforeEach(() => {
    m.getConfig.mockReset();
    m.getConfig.mockResolvedValue({ publicLandingEnabled: true });
  });

  it("sends signed-in visitors to the dashboard without reading the config", async () => {
    await expect(run({ id: "u1" })).rejects.toEqual(toDashboard);
    expect(m.getConfig).not.toHaveBeenCalled();
  });

  it("shows the landing to signed-out visitors when it is enabled", async () => {
    await expect(run(null)).resolves.toBeUndefined();
    expect(m.getConfig).toHaveBeenCalledTimes(1);
  });

  it("renders the lazily loaded landing", async () => {
    render(<RootLanding />);
    expect(await screen.findByText("landing page")).toBeInTheDocument();
    cleanup();
  });

  it("redirects signed-out visitors as before when it is disabled", async () => {
    m.getConfig.mockResolvedValue({ publicLandingEnabled: false });
    await expect(run(null)).rejects.toEqual(toDashboard);
  });

  it("redirects as before when the config can't be read", async () => {
    m.getConfig.mockRejectedValue(new Error("offline"));
    await expect(run(null)).rejects.toEqual(toDashboard);
  });
});
