import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import QuickLinkDialog from "./quick-link-dialog";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/quick-link/use-quick-link-mutations", () => ({
  useCreateQuickLink: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateQuickLink: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const onOpenChange = vi.fn();

function renderDialog(link: Parameters<typeof QuickLinkDialog>[0]["link"]) {
  return render(
    <QuickLinkDialog
      workspaceId="ws-1"
      link={link}
      open
      onOpenChange={onOpenChange}
    />,
  );
}

function submit(url: string, title = "") {
  fireEvent.change(screen.getByLabelText("home:quickLinks.dialog.urlLabel"), {
    target: { value: url },
  });
  if (title) {
    fireEvent.change(
      screen.getByPlaceholderText("home:quickLinks.dialog.titlePlaceholder"),
      { target: { value: title } },
    );
  }
  fireEvent.click(screen.getByRole("button", { name: /dialog\.add|save/ }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuickLinkDialog", () => {
  it("shows the inline error for an invalid URL and sends nothing", () => {
    renderDialog(null);
    submit("javascript:alert(1)");

    expect(
      screen.getByText("home:quickLinks.dialog.invalidUrl"),
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts a scheme-less URL, sending it normalized with https", async () => {
    mocks.create.mockResolvedValue({});
    renderDialog(null);
    submit("Example.com/docs", "  Docs  ");

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        url: "https://example.com/docs",
        title: "Docs",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "home:quickLinks.toast.added",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open with an inline error on a duplicate", async () => {
    mocks.create.mockRejectedValue(
      new HttpError(409, "This link is already in your quick links"),
    );
    renderDialog(null);
    submit("https://example.com");

    expect(
      await screen.findByText("home:quickLinks.toast.duplicate"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("toasts the cap on a 422, whatever its text", async () => {
    mocks.create.mockRejectedValue(new HttpError(422, "Localized cap text"));
    renderDialog(null);
    submit("https://example.com");

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "home:quickLinks.toast.limit",
      ),
    );
    expect(screen.queryByText("home:quickLinks.toast.duplicate")).toBeNull();
  });

  it("sends only the changed fields when editing", async () => {
    mocks.update.mockResolvedValue({});
    renderDialog({
      id: "ql-1",
      workspaceId: "ws-1",
      url: "https://example.com/",
      title: "Old",
      createdAt: "",
      updatedAt: "",
    });
    const title = screen.getByPlaceholderText(
      "home:quickLinks.dialog.titlePlaceholder",
    );
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: "home:quickLinks.dialog.save" }),
    );

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        quickLinkId: "ql-1",
        changes: { title: null },
      }),
    );
  });
});
