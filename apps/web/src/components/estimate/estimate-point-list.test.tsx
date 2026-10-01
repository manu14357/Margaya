import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EstimateRequestError } from "@/fetchers/estimate/estimate-error";
import RemotePointList from "./remote-point-list";
import { makeEstimate, testTranslate } from "./test-fixtures";

// Base UI dialogs and popovers render slowly while the whole suite runs.
vi.setConfig({ testTimeout: 15_000 });

const state = vi.hoisted(() => ({
  createPoint: vi.fn(),
  updatePoint: vi.fn(),
  deletePoint: vi.fn(),
  reorder: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: testTranslate }),
}));

vi.mock("@/hooks/mutations/estimate/use-create-estimate-point", () => ({
  useCreateEstimatePoint: () => ({ mutateAsync: state.createPoint }),
}));
vi.mock("@/hooks/mutations/estimate/use-update-estimate-point", () => ({
  useUpdateEstimatePoint: () => ({ mutateAsync: state.updatePoint }),
}));
vi.mock("@/hooks/mutations/estimate/use-delete-estimate-point", () => ({
  useDeleteEstimatePoint: () => ({ mutate: state.deletePoint }),
}));
vi.mock("@/hooks/mutations/estimate/use-reorder-estimate-points", () => ({
  useReorderEstimatePoints: () => ({ mutate: state.reorder }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  for (const mock of Object.values(state)) mock.mockReset();
});

function renderList(estimate: ReturnType<typeof makeEstimate>, canEdit = true) {
  return render(
    <RemotePointList
      projectId="project-1"
      estimate={estimate}
      canEdit={canEdit}
    />,
  );
}

const deleteButtons = () =>
  screen.queryAllByRole("button", {
    name: "settings:projectEstimates.values.deleteAria",
  });

function editValue(from: string, to: string) {
  const input = screen.getByDisplayValue(from);
  fireEvent.change(input, { target: { value: to } });
  fireEvent.blur(input);
}

describe("RemotePointList rows", () => {
  it("hides delete at 2 values and explains why", () => {
    renderList(makeEstimate("points", ["1", "2"]));
    expect(deleteButtons()).toHaveLength(0);
    expect(
      screen.getAllByRole("button", {
        name: "settings:projectEstimates.values.minTooltip",
      }),
    ).toHaveLength(2);
  });

  it("offers delete above 2 values", () => {
    renderList(makeEstimate("points", ["1", "2", "3"]));
    expect(deleteButtons()).toHaveLength(3);
  });

  it("swaps the add row for a hint at 10 values", () => {
    renderList(
      makeEstimate(
        "points",
        Array.from({ length: 10 }, (_, index) => String(index + 1)),
      ),
    );
    expect(
      screen.queryByRole("textbox", {
        name: "settings:projectEstimates.values.newAria",
      }),
    ).toBeNull();
    expect(
      screen.getByText("settings:projectEstimates.values.maxHint"),
    ).toBeInTheDocument();
  });

  it("shows the drag grip for categories only", () => {
    renderList(makeEstimate("categories", ["S", "M", "L"]));
    expect(
      screen.getAllByRole("img", {
        name: "settings:projectEstimates.values.dragHandle",
      }),
    ).toHaveLength(3);
    cleanup();
    renderList(makeEstimate("points", ["1", "2", "3"]));
    expect(
      screen.queryAllByRole("img", {
        name: "settings:projectEstimates.values.dragHandle",
      }),
    ).toHaveLength(0);
  });

  it("is read-only without project:update", () => {
    renderList(makeEstimate("points", ["1", "2", "3"]), false);
    expect(deleteButtons()).toHaveLength(0);
    expect(screen.getByDisplayValue("1")).toBeDisabled();
    expect(
      screen.queryByRole("textbox", {
        name: "settings:projectEstimates.values.newAria",
      }),
    ).toBeNull();
  });

  it("shows task counts per value", () => {
    renderList(makeEstimate("points", ["1", "2"], { taskCounts: [4, 0] }));
    expect(
      screen.getAllByText("settings:projectEstimates.values.taskCount"),
    ).toHaveLength(2);
  });
});

describe("RemotePointList validation", () => {
  it.each([
    ["points", ["1", "2"], "abc", "not_numeric"],
    ["points", ["1", "2"], "2.0", "duplicate"],
    ["points", ["1", "2"], "0", "not_positive"],
    ["points", ["1", "2"], "1000", "too_large"],
    ["points", ["1", "2"], "1.555", "too_precise"],
    ["points", ["1", "2"], "", "empty"],
    ["categories", ["S", "M"], "3", "numeric_category"],
    ["categories", ["S", "M"], "m", "duplicate"],
    ["time", ["30", "60"], "soon", "not_numeric_time"],
  ] as const)(
    "%s: %j edited to %j shows %s under the row",
    (type, values, next, code) => {
      renderList(makeEstimate(type, [...values]));
      const shown = type === "time" ? "30m" : values[0];
      editValue(shown, next);
      expect(
        screen.getByText(`settings:projectEstimates.validation.${code}`),
      ).toBeInTheDocument();
      expect(state.updatePoint).not.toHaveBeenCalled();
    },
  );

  it("saves a valid edit, sending minutes for time", async () => {
    state.updatePoint.mockResolvedValue({});
    renderList(makeEstimate("time", ["30", "60"]));
    editValue("30m", "1h 30m");
    await waitFor(() =>
      expect(state.updatePoint).toHaveBeenCalledWith({
        projectId: "project-1",
        estimateId: "estimate-1",
        pointId: "estimate-1-p1",
        value: "90",
      }),
    );
  });

  it("skips saving when the value only changed form", () => {
    renderList(makeEstimate("points", ["2.5", "3"]));
    editValue("2.5", "2.50");
    expect(state.updatePoint).not.toHaveBeenCalled();
  });

  it("maps the API's value code to the row", async () => {
    state.updatePoint.mockRejectedValue(
      new EstimateRequestError(400, "Invalid estimate values", {
        errors: [{ index: 0, code: "duplicate" }],
      }),
    );
    renderList(makeEstimate("points", ["1", "2"]));
    editValue("1", "7");
    expect(
      await screen.findByText("settings:projectEstimates.validation.duplicate"),
    ).toBeInTheDocument();
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("validates a new value before adding it", async () => {
    state.createPoint.mockResolvedValue({});
    renderList(makeEstimate("points", ["1", "2"]));
    const input = screen.getByRole("textbox", {
      name: "settings:projectEstimates.values.newAria",
    });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectEstimates.values.add",
      }),
    );
    expect(
      screen.getByText("settings:projectEstimates.validation.duplicate"),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectEstimates.values.add",
      }),
    );
    await waitFor(() =>
      expect(state.createPoint).toHaveBeenCalledWith({
        projectId: "project-1",
        estimateId: "estimate-1",
        value: "8",
      }),
    );
  });
});

describe("RemotePointList delete", () => {
  it("deletes an unused value right away", () => {
    renderList(makeEstimate("points", ["1", "2", "3"]));
    fireEvent.click(deleteButtons()[0]);
    expect(state.deletePoint).toHaveBeenCalledWith(
      {
        projectId: "project-1",
        estimateId: "estimate-1",
        pointId: "estimate-1-p1",
      },
      expect.any(Object),
    );
  });

  it("asks where the tasks go when tasks use the value", async () => {
    renderList(
      makeEstimate("points", ["1", "2", "3"], { taskCounts: [0, 4, 0] }),
    );
    fireEvent.click(deleteButtons()[1]);
    expect(state.deletePoint).not.toHaveBeenCalled();
    expect(
      await screen.findByText("settings:projectEstimates.deletePoint.title"),
    ).toBeInTheDocument();
  });
});
