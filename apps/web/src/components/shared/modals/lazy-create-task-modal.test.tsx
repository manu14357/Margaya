import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LazyCreateTaskModal from "./lazy-create-task-modal";

const modal = vi.hoisted(() => ({ loads: 0 }));

vi.mock("./create-task-modal", () => {
  modal.loads += 1;
  return {
    default: ({ open }: { open: boolean }) => (
      <div data-testid="create-task">{open ? "open" : "closed"}</div>
    ),
  };
});

afterEach(() => {
  cleanup();
});

describe("LazyCreateTaskModal", () => {
  it("loads nothing until it first opens, then stays mounted", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <LazyCreateTaskModal open={false} onClose={onClose} />,
    );
    await vi.dynamicImportSettled();
    expect(modal.loads).toBe(0);
    expect(screen.queryByTestId("create-task")).toBeNull();

    rerender(<LazyCreateTaskModal open onClose={onClose} />);
    expect(await screen.findByTestId("create-task")).toHaveTextContent("open");
    expect(modal.loads).toBe(1);

    // Closing goes through the modal itself, so its close behaviour is kept.
    rerender(<LazyCreateTaskModal open={false} onClose={onClose} />);
    expect(screen.getByTestId("create-task")).toHaveTextContent("closed");
  });
});
