import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EstimateRequestError } from "@/fetchers/estimate/estimate-error";
import CreateEstimateDialog from "./create-estimate-dialog";
import { makeEstimate, testTranslate } from "./test-fixtures";

// Base UI dialogs and popovers render slowly while the whole suite runs.
vi.setConfig({ testTimeout: 15_000 });

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: testTranslate }),
}));

vi.mock("@/hooks/mutations/estimate/use-create-estimate", () => ({
  useCreateEstimate: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.mutateAsync.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
});

function renderDialog(existingNames: string[] = []) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CreateEstimateDialog
      open
      onOpenChange={onOpenChange}
      projectId="project-1"
      existingNames={existingNames}
      onCreated={onCreated}
    />,
  );
  return { onCreated, onOpenChange };
}

const createButton = () =>
  screen.getByRole("button", {
    name: "settings:projectEstimates.create.submit",
  });

describe("CreateEstimateDialog", () => {
  it("fills step 2 from the picked template", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.fibonacci"),
    );
    expect(
      screen.getByText("settings:projectEstimates.create.step"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "settings:projectEstimates.name.label",
      }),
    ).toHaveValue("settings:projectEstimates.templates.fibonacci");
    for (const value of ["1", "2", "3", "5", "8", "13"]) {
      expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    }
    expect(createButton()).toBeEnabled();
  });

  it("offers each type's templates, with time shown as durations", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "settings:projectEstimates.types.time",
      }),
    );
    expect(
      await screen.findByText("settings:projectEstimates.templates.hours"),
    ).toBeInTheDocument();
    expect(screen.getByText("1h, 2h, 3h, 4h, 6h, 8h")).toBeInTheDocument();
  });

  it("disables Create while a value is invalid", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.linear"),
    );
    fireEvent.change(screen.getByDisplayValue("6"), {
      target: { value: "abc" },
    });
    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText("settings:projectEstimates.validation.not_numeric"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("abc"), {
      target: { value: "7" },
    });
    expect(createButton()).toBeEnabled();
  });

  it("disables Create for a name the project already uses", async () => {
    renderDialog(["settings:projectEstimates.templates.fibonacci"]);
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.fibonacci"),
    );
    expect(
      screen.getByText("settings:projectEstimates.validation.name_taken"),
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("sends name, type and values, then hands over the new system", async () => {
    const created = makeEstimate("categories", ["S", "M"], {
      isActive: false,
    });
    state.mutateAsync.mockResolvedValue(created);
    const { onCreated, onOpenChange } = renderDialog();
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "settings:projectEstimates.types.categories",
      }),
    );
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.tshirt"),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "settings:projectEstimates.name.label",
      }),
      { target: { value: "  Sizes  " } },
    );
    fireEvent.click(createButton());

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "Sizes",
        type: "categories",
        values: ["XS", "S", "M", "L", "XL", "XXL"],
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the API's value errors on their rows", async () => {
    state.mutateAsync.mockRejectedValue(
      new EstimateRequestError(400, "Invalid estimate values", {
        errors: [{ index: 1, code: "duplicate" }],
      }),
    );
    renderDialog();
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.squares"),
    );
    fireEvent.click(createButton());
    expect(
      await screen.findByText("settings:projectEstimates.validation.duplicate"),
    ).toBeInTheDocument();
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("goes back to step 1 without the edits", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByText("settings:projectEstimates.templates.fibonacci"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectEstimates.create.back",
      }),
    );
    expect(
      await screen.findByText("settings:projectEstimates.create.custom"),
    ).toBeInTheDocument();
  });
});
