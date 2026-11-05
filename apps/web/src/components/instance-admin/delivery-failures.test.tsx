import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryFailures } from "./delivery-failures";

const query = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/hooks/queries/instance-admin/use-instance-admin", () => ({
  useInstanceDeliveryFailures: () => query.current,
}));
vi.mock("./instance-page", async () => {
  const { InstanceLoadState } =
    await vi.importActual<typeof import("./instance-page")>("./instance-page");
  return {
    InstanceLoadState,
    InstanceSection: ({
      title,
      children,
    }: {
      title: string;
      children: React.ReactNode;
    }) => (
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    ),
  };
});

afterEach(cleanup);

const failure = {
  id: "d1",
  workspaceName: "Acme",
  webhookName: "Billing hook",
  event: "task.created",
  error: null,
  responseStatus: 500,
  attemptCount: 6,
  failedAt: "2026-11-05T10:00:00.000Z",
};

describe("DeliveryFailures", () => {
  it("lists a failure with its workspace, webhook, event and response", () => {
    query.current = { data: { items: [failure] } };
    render(<DeliveryFailures />);

    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Billing hook")).toBeTruthy();
    expect(screen.getByText(/task\.created/)).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
  });

  it("names the event alone when the webhook has no name", () => {
    query.current = {
      data: { items: [{ ...failure, webhookName: null }] },
    };
    render(<DeliveryFailures />);

    expect(screen.getByText("task.created")).toBeTruthy();
  });

  it("says so when nothing failed", () => {
    query.current = { data: { items: [] } };
    render(<DeliveryFailures />);

    expect(
      screen.getByText("instanceAdmin:general.deliveryFailures.empty"),
    ).toBeTruthy();
  });

  it("offers a retry when the list can't load", () => {
    const refetch = vi.fn();
    query.current = { isLoading: false, isError: true, refetch };
    render(<DeliveryFailures />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:retry" }),
    );
    expect(refetch).toHaveBeenCalledOnce();
  });
});
