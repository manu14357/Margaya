import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeScheduleFields,
  useScheduleViewPreferences,
} from "@/store/schedule-view-preferences";
import { ScheduleFieldPicker, useScheduleField } from "./schedule-field";
import { scheduleFieldText } from "./schedule-field-display";

const m = vi.hoisted(() => ({
  fields: [] as Record<string, unknown>[],
  values: [] as Record<string, unknown>[],
  valuesProjectIds: [] as string[],
}));

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: m.fields }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({
    default: (projectId: string) => {
      m.valuesProjectIds.push(projectId);
      return { data: projectId ? m.values : undefined };
    },
  }),
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${options.name}: ${options.value}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const CUSTOMER = { id: "f1", name: "Customer", type: "dropdown", options: [] };
const SIGNED = { id: "f2", name: "Signed", type: "boolean", options: [] };

beforeEach(() => {
  m.fields = [CUSTOMER, SIGNED];
  m.values = [
    { taskId: "t1", fieldId: "f1", value: "Acme" },
    { taskId: "t2", fieldId: "f1", value: "" },
    { taskId: "t1", fieldId: "f2", value: "true" },
  ];
  m.valuesProjectIds = [];
  useScheduleViewPreferences.setState({ scheduleFieldByProject: {} });
});
afterEach(cleanup);

describe("schedule field preference", () => {
  it("keeps only string field ids per project from storage", () => {
    expect(
      normalizeScheduleFields({ p1: "f1", p2: 5, p3: "", "": "f9" }),
    ).toEqual({ p1: "f1" });
    expect(normalizeScheduleFields(["f1"])).toEqual({});
    expect(normalizeScheduleFields("f1")).toEqual({});
    expect(normalizeScheduleFields(null)).toEqual({});
  });

  it("reads a stored choice back on load and drops a malformed one", async () => {
    window.localStorage.setItem(
      "schedule-view-preferences",
      JSON.stringify({
        state: { scheduleFieldByProject: { p1: "f1", p2: { id: "f2" } } },
        version: 0,
      }),
    );
    await useScheduleViewPreferences.persist.rehydrate();
    expect(
      useScheduleViewPreferences.getState().scheduleFieldByProject,
    ).toEqual({ p1: "f1" });
  });

  it("sets and clears one project's choice without touching others", () => {
    const { setScheduleField } = useScheduleViewPreferences.getState();
    setScheduleField("p1", "f1");
    setScheduleField("p2", "f2");
    setScheduleField("p1", null);
    expect(
      useScheduleViewPreferences.getState().scheduleFieldByProject,
    ).toEqual({ p2: "f2" });
  });
});

describe("useScheduleField", () => {
  it("loads no values while no field is chosen", () => {
    const { result } = renderHook(() => useScheduleField("p1"));
    expect(result.current.fieldId).toBeNull();
    expect(result.current.display).toBeNull();
    expect(result.current.fields.map((field) => field.name)).toEqual([
      "Customer",
      "Signed",
    ]);
    expect(m.valuesProjectIds.every((id) => id === "")).toBe(true);
  });

  it("reads a deleted field as no field", () => {
    useScheduleViewPreferences.getState().setScheduleField("p1", "gone");
    const { result } = renderHook(() => useScheduleField("p1"));
    expect(result.current.fieldId).toBeNull();
    expect(result.current.display).toBeNull();
    expect(m.valuesProjectIds.every((id) => id === "")).toBe(true);
  });

  it("maps each task to the chosen field's value, skipping empty ones", () => {
    useScheduleViewPreferences.getState().setScheduleField("p1", "f1");
    const { result } = renderHook(() => useScheduleField("p1"));
    expect(result.current.fieldId).toBe("f1");
    expect(m.valuesProjectIds).toContain("p1");
    expect(result.current.display?.name).toBe("Customer");
    expect([...(result.current.display?.values ?? [])]).toEqual([
      ["t1", "Acme"],
    ]);
  });

  it("reads booleans through their translated labels", () => {
    useScheduleViewPreferences.getState().setScheduleField("p1", "f2");
    const { result } = renderHook(() => useScheduleField("p1"));
    expect(result.current.display?.values.get("t1")).toBe(
      "tasks:customFieldValue.true",
    );
  });

  it("changes the choice for its own project", () => {
    const { result } = renderHook(() => useScheduleField("p1"));
    act(() => result.current.setFieldId("f2"));
    expect(result.current.fieldId).toBe("f2");
    expect(
      useScheduleViewPreferences.getState().scheduleFieldByProject,
    ).toEqual({ p1: "f2" });
  });
});

describe("scheduleFieldText", () => {
  it("names the field with the task's value, or nothing", () => {
    const display = { name: "Customer", values: new Map([["t1", "Acme"]]) };
    const t = (_key: string, options?: Record<string, unknown>) =>
      `${options?.name}: ${options?.value}`;
    expect(scheduleFieldText(display, "t1", t)).toBe("Customer: Acme");
    expect(scheduleFieldText(display, "t2", t)).toBeNull();
    expect(scheduleFieldText(null, "t1", t)).toBeNull();
  });
});

describe("ScheduleFieldPicker", () => {
  const fields = [
    { id: "f1", name: "Customer", type: "dropdown" },
    { id: "f2", name: "Signed", type: "boolean" },
  ];

  it("is absent when the project has no custom fields", () => {
    const { container } = render(
      <ScheduleFieldPicker fields={[]} value={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers No field and each field, and reports the choice", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ScheduleFieldPicker fields={fields} value={null} onChange={onChange} />,
    );
    const trigger = screen.getByRole("combobox", {
      name: "tasks:scheduleField.label",
    });
    expect(trigger).toHaveTextContent("tasks:scheduleField.none");

    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "tasks:scheduleField.none",
      "Customer",
      "Signed",
    ]);
    const signed = screen.getByRole("option", { name: "Signed" });
    fireEvent.pointerDown(signed, { pointerType: "mouse" });
    fireEvent.click(signed);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("f2"));

    rerender(
      <ScheduleFieldPicker fields={fields} value="f2" onChange={onChange} />,
    );
    expect(
      screen.getByRole("combobox", { name: "tasks:scheduleField.label" }),
    ).toHaveTextContent("Signed");
  });
});
