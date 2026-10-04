import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKey } from "@/types/api-key";
import { ApiKeyTable } from "./api-key-table";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/api-key/use-delete-api-key", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function apiKey(id: string, lastRequest: Date | null) {
  return {
    id,
    name: `Key ${id}`,
    start: "mg_abc",
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    expiresAt: null,
    lastRequest,
  } as unknown as ApiKey;
}

describe("ApiKeyTable", () => {
  afterEach(cleanup);

  it("shows Last used as Never for a key without requests", () => {
    render(<ApiKeyTable apiKeys={[apiKey("a", null)]} isLoading={false} />);

    expect(
      screen.getByRole("columnheader", {
        name: "settings:apiKey.table.columnLastUsed",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings:apiKey.table.neverUsed"),
    ).toBeInTheDocument();
  });

  it("shows the relative last-used time with the exact time attached", () => {
    const lastRequest = new Date(Date.now() - 5 * 60 * 1000);
    render(
      <ApiKeyTable apiKeys={[apiKey("a", lastRequest)]} isLoading={false} />,
    );

    const time = screen.getByText("5 minutes ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", lastRequest.toISOString());
    expect(
      screen.queryByText("settings:apiKey.table.neverUsed"),
    ).not.toBeInTheDocument();
  });
});
