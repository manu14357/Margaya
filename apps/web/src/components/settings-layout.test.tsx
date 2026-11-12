import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSaveFooter } from "./settings-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SettingsSaveFooter", () => {
  afterEach(cleanup);

  it("keeps Save off and quiet while nothing changed", () => {
    render(<SettingsSaveFooter dirty={false} onSave={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "settings:save" }),
    ).toBeDisabled();
    expect(screen.queryByText("settings:unsavedChanges")).toBeNull();
  });

  it("says there are unsaved changes and saves them", () => {
    const onSave = vi.fn();
    render(<SettingsSaveFooter dirty onSave={onSave} saveLabel="Save types" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "settings:unsavedChanges",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("keeps Save off while the changes are invalid", () => {
    render(<SettingsSaveFooter dirty disabled onSave={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "settings:save" }),
    ).toBeDisabled();
  });
});
