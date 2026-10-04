import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretField } from "./secret-field";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Harness({
  configured,
  unreadable = false,
  onClear = vi.fn(),
}: {
  configured: boolean;
  unreadable?: boolean;
  onClear?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <SecretField
        id="secret"
        entry={{ configured, unreadable }}
        value={value}
        onChange={setValue}
        onClear={onClear}
      />
      <output data-testid="draft">{value}</output>
    </>
  );
}

const placeholder = "instanceAdmin:secret.placeholder";

describe("SecretField", () => {
  afterEach(cleanup);

  it("shows an empty write-only input when nothing is saved", () => {
    render(<Harness configured={false} />);
    const input = screen.getByPlaceholderText(placeholder);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input).toHaveValue("");
  });

  it("shows Saved without any value, with Replace and Clear", () => {
    const onClear = vi.fn();
    render(<Harness configured onClear={onClear} />);
    expect(screen.getByText("instanceAdmin:secret.saved")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:secret.clear" }),
    );
    expect(onClear).toHaveBeenCalled();
  });

  it("Replace reveals an empty input, Cancel goes back", () => {
    render(<Harness configured />);
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:secret.replace" }),
    );
    const input = screen.getByPlaceholderText(placeholder);
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "new-secret" } });
    expect(screen.getByTestId("draft")).toHaveTextContent("new-secret");
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:secret.cancel" }),
    );
    expect(screen.getByTestId("draft")).toHaveTextContent("");
    expect(screen.getByText("instanceAdmin:secret.saved")).toBeInTheDocument();
  });

  it("warns when the saved secret can't be read", () => {
    render(<Harness configured={false} unreadable />);
    expect(
      screen.getByText("instanceAdmin:secret.unreadable"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue("");
  });
});
