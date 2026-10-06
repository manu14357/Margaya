import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookEventsPicker } from "./webhook-events-picker";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const catalog = {
  families: [
    {
      key: "task",
      events: [{ name: "task.created" }, { name: "task.deleted" }],
    },
    {
      key: "comment",
      events: [{ name: "comment.created" }, { name: "comment.deleted" }],
    },
  ],
};

const TASKS = "settings:workspaceWebhooks.families.task.label";
const COMMENTS = "settings:workspaceWebhooks.families.comment.label";
const REQUIRED = "settings:workspaceWebhooks.form.eventsRequired";

function Harness({
  initial,
  onChange,
}: {
  initial: string[];
  onChange: (patterns: string[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WebhookEventsPicker
      catalog={catalog}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function checkbox(name: string) {
  return screen.getByRole("checkbox", { name });
}

describe("WebhookEventsPicker", () => {
  afterEach(cleanup);

  it("hides the checklist while All events is chosen", () => {
    render(<Harness initial={["*"]} onChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: TASKS })).toBeNull();
  });

  it("shows a tri-state family checkbox", () => {
    render(
      <Harness initial={["task.created", "comment.*"]} onChange={vi.fn()} />,
    );
    expect(checkbox(TASKS)).toHaveAttribute("aria-checked", "mixed");
    expect(checkbox(COMMENTS)).toHaveAttribute("aria-checked", "true");
  });

  it("stores family.* when a family is checked", () => {
    const onChange = vi.fn();
    render(<Harness initial={["comment.created"]} onChange={onChange} />);
    fireEvent.click(checkbox(TASKS));
    expect(onChange).toHaveBeenLastCalledWith(["comment.created", "task.*"]);
  });

  it("filters events by name", () => {
    render(<Harness initial={["task.created"]} onChange={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "settings:workspaceWebhooks.form.eventsSearch",
      }),
      { target: { value: "deleted" } },
    );
    expect(checkbox("task.deleted")).toBeInTheDocument();
    expect(checkbox("comment.deleted")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "task.created" })).toBeNull();
  });

  it("shows the required error once nothing is selected", () => {
    const onChange = vi.fn();
    render(<Harness initial={["task.*"]} onChange={onChange} />);
    expect(screen.queryByText(REQUIRED)).toBeNull();
    fireEvent.click(checkbox(TASKS));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("alert")).toHaveTextContent(REQUIRED);
  });

  it("restores the picked events after a detour through All events", () => {
    const onChange = vi.fn();
    render(<Harness initial={["task.created"]} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("radio", {
        name: /settings:workspaceWebhooks.form.eventsAll\b/,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith(["*"]);
    fireEvent.click(
      screen.getByRole("radio", {
        name: /settings:workspaceWebhooks.form.eventsChoose\b/,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith(["task.created"]);
  });
});
