import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomFieldEditDialog from "./custom-field-edit-dialog";
import type { CustomFieldDefinition } from "./custom-field-editor";

const { mutateAsync, toastError, toastSuccess } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/custom-field/use-update-custom-field", () => ({
  default: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const dropdown: CustomFieldDefinition = {
  id: "f1",
  projectId: "p1",
  name: "Stage",
  type: "dropdown",
  required: false,
  defaultValue: "Beta",
  options: ["Alpha", "Beta"],
  position: 0,
  createdAt: "",
  updatedAt: "",
};

const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "settings:customFields.saveButton" }),
  );
const optionInputs = () =>
  screen.getAllByRole("textbox", {
    name: "settings:customFields.optionPlaceholder",
  });

afterEach(cleanup);
beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("CustomFieldEditDialog", () => {
  it("sends a changed option as a rename, with the default following it", async () => {
    const onClose = vi.fn();
    render(<CustomFieldEditDialog field={dropdown} onClose={onClose} />);

    const [, beta] = optionInputs();
    fireEvent.change(beta as HTMLElement, { target: { value: "Bravo" } });
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "f1",
      name: "Stage",
      defaultValue: "Bravo",
      options: ["Alpha", "Bravo"],
      renamedOptions: [{ from: "Beta", to: "Bravo" }],
    });
  });

  it("removes an option and clears it as the default", async () => {
    const onClose = vi.fn();
    render(<CustomFieldEditDialog field={dropdown} onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:customFields.removeOption: Beta",
      }),
    );
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "f1",
      name: "Stage",
      defaultValue: null,
      options: ["Alpha"],
    });
  });

  it("blocks repeated or blank options and explains repeats", () => {
    render(<CustomFieldEditDialog field={dropdown} onClose={vi.fn()} />);
    const saveButton = screen.getByRole("button", {
      name: "settings:customFields.saveButton",
    });

    const [, beta] = optionInputs();
    fireEvent.change(beta as HTMLElement, { target: { value: "Alpha" } });
    expect(screen.getByRole("alert").textContent).toBe(
      "settings:customFields.duplicateOption",
    );
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(beta as HTMLElement, { target: { value: " " } });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("won't remove the last option or save a required field without default", () => {
    render(
      <CustomFieldEditDialog
        field={{
          ...dropdown,
          required: true,
          options: ["Beta"],
          defaultValue: "Beta",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "settings:customFields.removeOption: Beta",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("renames a text field and leaves options out", async () => {
    const onClose = vi.fn();
    render(
      <CustomFieldEditDialog
        field={{
          ...dropdown,
          type: "text",
          options: null,
          defaultValue: null,
        }}
        onClose={onClose}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "settings:customFields.nameLabel" }),
      { target: { value: "  Note " } },
    );
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "f1",
      name: "Note",
      defaultValue: null,
    });
  });

  it("stays open and explains when the save fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Nope"));
    const onClose = vi.fn();
    render(<CustomFieldEditDialog field={dropdown} onClose={onClose} />);
    save();

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Nope"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
