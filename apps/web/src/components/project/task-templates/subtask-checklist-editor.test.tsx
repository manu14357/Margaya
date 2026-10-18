import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubtaskChecklistEditor from "./subtask-checklist-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "title" in options ? `${key}:${options.title}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

let latest: string[] = [];

function Harness({ initial }: { initial: string[] }) {
  const [items, setItems] = useState(initial);
  latest = items;
  return <SubtaskChecklistEditor items={items} onChange={setItems} />;
}

afterEach(() => {
  cleanup();
  latest = [];
});

describe("SubtaskChecklistEditor", () => {
  it("adds a row with Enter without submitting a form", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Harness initial={[]} />
      </form>,
    );
    const input = screen.getByRole("textbox", {
      name: "templates:form.subtaskPlaceholder",
    });
    fireEvent.change(input, { target: { value: "  Write tests " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(latest).toEqual(["Write tests"]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("reorders and removes rows by buttons", () => {
    render(<Harness initial={["One", "Two", "Three"]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "templates:form.moveDown:One" }),
    );
    expect(latest).toEqual(["Two", "One", "Three"]);
    fireEvent.click(
      screen.getByRole("button", { name: "templates:form.moveUp:Three" }),
    );
    expect(latest).toEqual(["Two", "Three", "One"]);
    fireEvent.click(
      screen.getByRole("button", { name: "templates:form.removeSubtask:Two" }),
    );
    expect(latest).toEqual(["Three", "One"]);
    expect(
      (
        screen.getByRole("button", {
          name: "templates:form.moveUp:Three",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
