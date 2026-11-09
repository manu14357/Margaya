import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LazyCreateIntakeDialog from "./lazy-create-intake-dialog";

const mocks = vi.hoisted(() => ({ loaded: vi.fn() }));

// The real dialog brings the description editor with it.
vi.mock("./create-intake-dialog", () => {
  mocks.loaded();
  return {
    default: ({ open, projectId }: { open: boolean; projectId: string }) => (
      <div data-testid="intake-dialog" data-open={String(open)}>
        {projectId}
      </div>
    ),
  };
});

afterEach(cleanup);

describe("LazyCreateIntakeDialog", () => {
  it("loads the dialog the first time it opens, then keeps it mounted", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <LazyCreateIntakeDialog
        open={false}
        onOpenChange={onOpenChange}
        projectId="p1"
      />,
    );
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId("intake-dialog")).toBeNull();

    rerender(
      <LazyCreateIntakeDialog
        open
        onOpenChange={onOpenChange}
        projectId="p1"
      />,
    );
    const dialog = await screen.findByTestId("intake-dialog");
    expect(mocks.loaded).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("data-open", "true");

    rerender(
      <LazyCreateIntakeDialog
        open={false}
        onOpenChange={onOpenChange}
        projectId="p1"
      />,
    );
    expect(screen.getByTestId("intake-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );
  });
});
