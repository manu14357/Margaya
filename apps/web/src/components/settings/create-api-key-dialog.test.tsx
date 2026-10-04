import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApiKeyDialog } from "./create-api-key-dialog";

const m = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/hooks/mutations/api-key/use-create-api-key", () => ({
  default: () => ({ mutateAsync: m.mutateAsync }),
}));

const DAY = 24 * 60 * 60;

function renderDialog() {
  render(<CreateApiKeyDialog open onClose={vi.fn()} onSuccess={vi.fn()} />);
  fireEvent.change(
    screen.getByPlaceholderText("settings:apiKey.createDialog.namePlaceholder"),
    { target: { value: "Deploy bot" } },
  );
}

async function chooseCustomDate() {
  // The expiration select is the dialog's only combobox.
  fireEvent.click(screen.getByRole("combobox"));
  const option = await screen.findByRole("option", {
    name: "settings:apiKey.createDialog.expirationCustom",
  });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
  return screen.findByRole("button", {
    name: "settings:apiKey.createDialog.customDateLabel",
  });
}

describe("CreateApiKeyDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.mutateAsync.mockResolvedValue({ key: "mg_secret", name: "Deploy bot" });
  });
  afterEach(cleanup);

  it("requires a date for a custom expiry", async () => {
    renderDialog();
    await chooseCustomDate();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:apiKey.createDialog.create",
      }),
    );

    expect(
      await screen.findByText("settings:apiKey.createDialog.customDateRange", {
        selector: "[data-slot='form-message']",
      }),
    ).toBeInTheDocument();
    expect(m.mutateAsync).not.toHaveBeenCalled();
  });

  it("sends the seconds until the end of the first allowed day", async () => {
    renderDialog();
    fireEvent.click(await chooseCustomDate());

    const grid = await screen.findByRole("grid");
    const firstEnabled = within(grid)
      .getAllByRole("button")
      .find((day) => !day.hasAttribute("disabled"));
    if (!firstEnabled) throw new Error("No selectable day");
    fireEvent.click(firstEnabled);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:apiKey.createDialog.create",
      }),
    );

    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(1));
    const { expiresIn } = m.mutateAsync.mock.calls[0]?.[0] ?? {};
    // Tomorrow ends between one and two days from now.
    expect(expiresIn).toBeGreaterThanOrEqual(DAY);
    expect(expiresIn).toBeLessThan(2 * DAY);
  });
});
