import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskKeyCopyButton from "./task-key-copy-button";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { key?: string }) =>
      options?.key ? `${key}:${options.key}` : key,
  }),
}));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyToClipboard: mocks.copy }));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskKeyCopyButton", () => {
  it("copies the upper-case key and says so", async () => {
    mocks.copy.mockResolvedValue(true);
    render(<TaskKeyCopyButton slug="web" number={12} />);

    fireEvent.click(screen.getByRole("button", { name: "WEB-12" }));

    await vi.waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("tasks:taskKey.copied:WEB-12"),
    );
    expect(mocks.copy).toHaveBeenCalledWith("WEB-12");
  });

  it("reports a clipboard that refused the text", async () => {
    mocks.copy.mockResolvedValue(false);
    render(<TaskKeyCopyButton slug="WEB" number={3} />);

    fireEvent.click(screen.getByRole("button", { name: "WEB-3" }));

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("tasks:taskKey.clipboardError"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("renders no button until the key is known", () => {
    render(<TaskKeyCopyButton slug={undefined} number={3} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
