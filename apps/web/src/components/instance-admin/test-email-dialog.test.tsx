import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestEmailDialog } from "./test-email-dialog";

const m = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.address ? `${key}:${options.address}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock(
  "@/hooks/mutations/instance-admin/use-instance-admin-mutations",
  () => ({ useSendInstanceTestEmail: () => ({ mutateAsync: m.mutateAsync }) }),
);

function renderDialog() {
  render(
    <TestEmailDialog
      open
      onOpenChange={vi.fn()}
      defaultRecipient="me@example.com"
    />,
  );
}

const send = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "instanceAdmin:testEmail.send" }),
  );

describe("TestEmailDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("defaults to my address and reports success", async () => {
    m.mutateAsync.mockResolvedValue({ sent: true, code: "ok", message: "" });
    renderDialog();
    expect(
      screen.getByLabelText("instanceAdmin:testEmail.recipient"),
    ).toHaveValue("me@example.com");
    send();
    expect(
      await screen.findByText("instanceAdmin:testEmail.success:me@example.com"),
    ).toBeInTheDocument();
    expect(m.mutateAsync).toHaveBeenCalledWith("me@example.com");
  });

  it("shows the classified failure and tries again", async () => {
    m.mutateAsync.mockResolvedValueOnce({
      sent: false,
      code: "auth",
      message: "server text",
    });
    renderDialog();
    send();
    expect(
      await screen.findByText("instanceAdmin:testEmail.codes.auth"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("instanceAdmin:testEmail.failure"),
    ).toBeInTheDocument();

    m.mutateAsync.mockResolvedValueOnce({
      sent: true,
      code: "ok",
      message: "",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:testEmail.tryAgain" }),
    );
    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("instanceAdmin:testEmail.success:me@example.com"),
    ).toBeInTheDocument();
  });

  it("shows the server message when the request fails", async () => {
    m.mutateAsync.mockRejectedValue(new Error("Set up email first"));
    renderDialog();
    send();
    expect(await screen.findByText("Set up email first")).toBeInTheDocument();
  });

  it("refuses an invalid recipient", () => {
    renderDialog();
    fireEvent.change(
      screen.getByLabelText("instanceAdmin:testEmail.recipient"),
      { target: { value: "nope" } },
    );
    expect(
      screen.getByText("instanceAdmin:testEmail.recipientInvalid"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "instanceAdmin:testEmail.send" }),
    ).toBeDisabled();
  });
});
