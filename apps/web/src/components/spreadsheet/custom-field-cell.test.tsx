import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import CustomFieldCell from "./custom-field-cell";

const { setValue, toastError } = vi.hoisted(() => ({
  setValue: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/custom-field/use-set-custom-field-value", () => ({
  default: () => ({ mutate: setValue }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: toastError } }));

function metaWith(
  field: Partial<TaskQueryMeta["customFields"][number]>,
): TaskQueryMeta {
  return {
    customFields: [
      {
        id: "f1",
        projectId: "p1",
        name: "Score",
        type: "number",
        required: false,
        options: null,
        ...field,
      },
    ],
  } as TaskQueryMeta;
}

const row = (value?: string) =>
  ({
    id: "t1",
    projectId: "p1",
    customFieldValues: value === undefined ? [] : [{ fieldId: "f1", value }],
  }) as unknown as TaskQueryRow;

afterEach(cleanup);
beforeEach(() => {
  setValue.mockReset();
  toastError.mockReset();
});

describe("CustomFieldCell", () => {
  it("is read-only without permission", () => {
    render(
      <CustomFieldCell
        row={row("7")}
        fieldId="f1"
        meta={metaWith({})}
        canEdit={false}
      />,
    );
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("saves a typed value on Enter and shows it at once", () => {
    render(
      <CustomFieldCell
        row={row("7")}
        fieldId="f1"
        meta={metaWith({})}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue.mock.calls[0]?.[0]).toEqual({
      taskId: "t1",
      fieldId: "f1",
      value: "12",
      projectId: "p1",
    });
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("cancels on Escape and skips an unchanged save", () => {
    render(
      <CustomFieldCell
        row={row("7")}
        fieldId="f1"
        meta={metaWith({})}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "9" },
    });
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Escape" });
    expect(setValue).not.toHaveBeenCalled();
    expect(screen.getByText("7")).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.blur(screen.getByRole("spinbutton"));
    expect(setValue).not.toHaveBeenCalled();
  });

  it("goes back to the stored value and explains when a save fails", () => {
    setValue.mockImplementation((_variables, options) => {
      options.onError(new Error("Value must be a valid number"));
    });
    render(
      <CustomFieldCell
        row={row("7")}
        fieldId="f1"
        meta={metaWith({})}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "12" },
    });
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" });

    expect(toastError).toHaveBeenCalledWith("Value must be a valid number");
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("offers a dropdown's options and keeps showing a removed one", async () => {
    render(
      <CustomFieldCell
        row={row("Retired")}
        fieldId="f1"
        meta={metaWith({ type: "dropdown", options: ["Alpha", "Beta"] })}
        canEdit
      />,
    );
    expect(screen.getByText("Retired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));

    fireEvent.click(await screen.findByRole("button", { name: "Beta" }));
    expect(setValue.mock.calls[0]?.[0]).toMatchObject({ value: "Beta" });
  });

  it("doesn't offer clearing a required field", async () => {
    render(
      <CustomFieldCell
        row={row("Alpha")}
        fieldId="f1"
        meta={metaWith({
          type: "dropdown",
          options: ["Alpha", "Beta"],
          required: true,
        })}
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    await screen.findByRole("button", { name: "Beta" });
    expect(
      screen.queryByRole("button", { name: "tasks:customFieldValue.clear" }),
    ).toBeNull();
  });
});
