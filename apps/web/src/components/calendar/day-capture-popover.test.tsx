import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DayCapturePopover from "./day-capture-popover";

const bar = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/components/task-draft/capture-bar", () => ({
  default: (props: Record<string, unknown>) => {
    bar(props);
    return <input aria-label={String(props.inputLabel)} />;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DAY = new Date(2026, 9, 21);

function renderPopover(open: boolean) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const onClose = vi.fn();
  const onOpenComposer = vi.fn();
  render(
    <DayCapturePopover
      projectId="p1"
      workspaceId="w1"
      target={open ? { day: DAY, anchor } : null}
      column={{ slug: "to-do", name: "To do" }}
      onClose={onClose}
      onOpenComposer={onOpenComposer}
    />,
  );
  return { onClose, onOpenComposer };
}

describe("DayCapturePopover", () => {
  it("opens a capture field for tasks due that day", () => {
    renderPopover(true);
    expect(
      screen.getByRole("textbox", { name: /tasks:capture.dueOn/ }),
    ).toBeTruthy();
    expect(bar.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: "p1",
      workspaceId: "w1",
      prefill: {
        status: "to-do",
        targetName: "To do",
        dueDate: "2026-10-21",
      },
      autoFocus: true,
    });
  });

  it("closes before handing Ctrl Enter to the full composer", () => {
    const { onClose, onOpenComposer } = renderPopover(true);
    const props = bar.mock.calls.at(-1)?.[0] as {
      onOpenComposer: (handoff: unknown) => void;
    };
    const handoff = { status: "to-do", prefill: { title: "Plan" } };
    props.onOpenComposer(handoff);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenComposer).toHaveBeenCalledWith(handoff);
  });

  it("renders nothing while closed", () => {
    renderPopover(false);
    expect(screen.queryByRole("textbox")).toBe(null);
    expect(bar).not.toHaveBeenCalled();
  });
});
