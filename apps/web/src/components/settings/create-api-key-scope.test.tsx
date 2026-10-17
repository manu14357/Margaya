import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKeyOf } from "../account/two-factor-section";
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

function renderDialog() {
  render(<CreateApiKeyDialog open onClose={vi.fn()} onSuccess={vi.fn()} />);
  fireEvent.change(
    screen.getByPlaceholderText("settings:apiKey.createDialog.namePlaceholder"),
    { target: { value: "CI bot" } },
  );
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: "settings:apiKey.createDialog.create" }),
  );
}

describe("API key scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.mutateAsync.mockResolvedValue({ key: "mg_secret", name: "CI bot" });
  });
  afterEach(cleanup);

  it("creates a full-access key without a scope by default", async () => {
    renderDialog();
    submit();
    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(1));
    const body = m.mutateAsync.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty("access");
    expect(body).not.toHaveProperty("projectIds");
  });

  it("sends a read-only scope", async () => {
    renderDialog();
    // Access radios in order: full, read, custom.
    fireEvent.click(screen.getAllByRole("radio")[1] as HTMLElement);
    submit();
    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(1));
    expect(m.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      name: "CI bot",
      access: "read",
    });
  });

  it("asks for an area before creating a custom key", async () => {
    renderDialog();
    fireEvent.click(screen.getAllByRole("radio")[2] as HTMLElement);
    expect(
      await screen.findByText("accountSecurity:platform.apiKeys.areasLabel"),
    ).toBeInTheDocument();
    submit();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create/ })).toBeEnabled(),
    );
    expect(m.mutateAsync).not.toHaveBeenCalled();
  });
});

describe("setupKeyOf", () => {
  it("groups the base32 secret of an otpauth URI", () => {
    expect(
      setupKeyOf(
        "otpauth://totp/Margaya:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Margaya",
      ),
    ).toBe("JBSW Y3DP EHPK 3PXP");
    expect(setupKeyOf("not a uri")).toBe("");
  });
});
