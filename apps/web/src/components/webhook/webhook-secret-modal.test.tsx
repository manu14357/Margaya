import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookSecretModal } from "./webhook-secret-modal";

const m = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyToClipboard: m.copy }));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

const SECRET = "whsec_0123456789abcdef";

describe("WebhookSecretModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the secret and unlocks Done after copying", async () => {
    m.copy.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<WebhookSecretModal secret={SECRET} onClose={onClose} />);

    expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument();
    const done = screen.getByRole("button", {
      name: "settings:workspaceWebhooks.secret.copyToContinue",
    });
    expect(done).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceWebhooks.secret.copy",
      }),
    );
    await waitFor(() => expect(m.copy).toHaveBeenCalledWith(SECRET));
    expect(m.success).toHaveBeenCalled();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workspaceWebhooks.secret.done",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("still unlocks Done when the clipboard is unavailable", async () => {
    m.copy.mockResolvedValue(false);
    render(<WebhookSecretModal secret={SECRET} onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceWebhooks.secret.copy",
      }),
    );
    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "settings:workspaceWebhooks.secret.copyFailed",
      ),
    );
    expect(
      await screen.findByRole("button", {
        name: "settings:workspaceWebhooks.secret.done",
      }),
    ).toBeEnabled();
  });
});
