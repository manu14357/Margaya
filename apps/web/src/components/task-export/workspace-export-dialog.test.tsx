import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceExportDialog } from "./workspace-export-dialog";

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/task-export/use-create-workspace-export", () => ({
  useCreateWorkspaceExport: () => ({ mutate: m.mutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <WorkspaceExportDialog
      open
      onOpenChange={onOpenChange}
      workspaceId="ws-1"
    />,
  );
  return onOpenChange;
}

const submit = () =>
  fireEvent.click(
    screen.getByRole("button", {
      name: "settings:workspaceExports.form.submit",
    }),
  );

describe("WorkspaceExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("starts an export with files by default and closes when queued", () => {
    m.mutate.mockImplementation((_input, options) => options.onSuccess());
    const onOpenChange = renderDialog();

    submit();

    expect(m.mutate.mock.calls[0]?.[0]).toEqual({
      workspaceId: "ws-1",
      includeFiles: true,
    });
    expect(m.success).toHaveBeenCalledWith(
      "settings:workspaceExports.toast.started",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can leave the files out", () => {
    renderDialog();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:workspaceExports.whole.includeFiles",
      }),
    );
    submit();

    expect(m.mutate.mock.calls[0]?.[0]).toEqual({
      workspaceId: "ws-1",
      includeFiles: false,
    });
  });

  it("says what is left out", () => {
    renderDialog();
    expect(
      screen.getByText("settings:workspaceExports.whole.leftOut"),
    ).toBeInTheDocument();
  });

  it("stays open and shows the server's reason when it can't start", () => {
    m.mutate.mockImplementation((_input, options) =>
      options.onError(new Error("Already in progress")),
    );
    const onOpenChange = renderDialog();

    submit();

    expect(m.error).toHaveBeenCalledWith("Already in progress");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
