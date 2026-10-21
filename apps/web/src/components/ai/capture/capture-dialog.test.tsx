import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptureButton from "./capture-button";
import CaptureDialog from "./capture-dialog";

const api = vi.hoisted(() => ({
  analyze: vi.fn(),
  create: vi.fn(),
  attachLabel: vi.fn(),
  assign: vi.fn(),
  upload: vi.fn(),
  toastSuccess: vi.fn(),
  aiAvailable: true,
}));

vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/fetchers/ai/capture", () => ({ analyzeCapture: api.analyze }));
vi.mock("@/fetchers/intake/create-intake-item", () => ({
  default: api.create,
}));
vi.mock("@/fetchers/label/attach-label-to-task", () => ({
  default: api.attachLabel,
}));
vi.mock("@/fetchers/task/update-task-assignees", () => ({
  default: api.assign,
}));
vi.mock("@/lib/upload-task-attachment", () => ({
  uploadTaskAttachment: api.upload,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canUpdateLabels: () => true,
    canAssignTasks: () => true,
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: api.aiAvailable }),
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: api.toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.aiAvailable = true;
});

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

const proposal = (title: string, extra: Record<string, unknown> = {}) => ({
  kind: "action",
  title,
  summary: `${title}.`,
  steps: [],
  expected: null,
  actual: null,
  environment: null,
  priority: "medium",
  priorityReason: null,
  labels: [],
  owner: null,
  ...extra,
});

describe("CaptureButton", () => {
  it("is hidden while AI is unavailable", () => {
    api.aiAvailable = false;
    wrap(<CaptureButton projectId="p1" />);
    expect(
      screen.queryByRole("button", { name: "ai:capture.button" }),
    ).toBeNull();
  });

  it("shows when AI is available", () => {
    wrap(<CaptureButton projectId="p1" />);
    expect(
      screen.getByRole("button", { name: "ai:capture.button" }),
    ).toBeInTheDocument();
  });
});

describe("CaptureDialog", () => {
  it("turns a transcript into reviewed requests, with owners and labels", async () => {
    api.analyze.mockResolvedValue({
      projectId: "p1",
      source: "transcript",
      items: [
        proposal("Send the pricing deck", {
          owner: { userId: "u-mia", name: "Mia", image: null, reason: null },
          labels: [{ labelId: "lab-sales", name: "sales", color: "#4f8a5b" }],
        }),
        proposal("Book the venue"),
        proposal("Order snacks"),
      ],
    });
    api.create
      .mockResolvedValueOnce({ id: "i1", taskId: "t1", projectId: "p1" })
      .mockResolvedValueOnce({ id: "i2", taskId: "t2", projectId: "p1" });
    const onOpenChange = vi.fn();
    wrap(<CaptureDialog projectId="p1" open onOpenChange={onOpenChange} />);

    fireEvent.click(
      screen.getByRole("tab", { name: "ai:capture.tabs.transcript" }),
    );
    fireEvent.change(await screen.findByLabelText("ai:capture.transcript"), {
      target: { value: "Mia sends the deck. Someone books the venue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai:capture.analyze" }));

    const titles = await screen.findAllByRole("textbox", {
      name: "ai:capture.titleLabel",
    });
    expect(titles).toHaveLength(3);
    expect(api.analyze.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      body: { source: "transcript", images: [] },
    });

    // Edit one, leave one out.
    fireEvent.change(titles[1] as HTMLElement, {
      target: { value: "Book the offsite venue" },
    });
    const includes = screen.getAllByRole("checkbox", {
      name: "ai:capture.include",
    });
    fireEvent.click(includes[2] as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "ai:capture.create" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.create).toHaveBeenNthCalledWith(1, "p1", {
      title: "Send the pricing deck",
      description: "Send the pricing deck.",
      priority: "medium",
    });
    expect(api.create.mock.calls[1]?.[1]).toMatchObject({
      title: "Book the offsite venue",
    });
    expect(api.attachLabel).toHaveBeenCalledWith({
      labelId: "lab-sales",
      taskId: "t1",
    });
    expect(api.assign).toHaveBeenCalledWith("t1", { add: ["u-mia"] });
    expect(api.assign).toHaveBeenCalledTimes(1);
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.toastSuccess).toHaveBeenCalled();
  });

  it("shows the AI error and creates nothing", async () => {
    api.analyze.mockRejectedValue(
      Object.assign(new Error('{"code":"AI_DISABLED","message":"off"}'), {
        status: 403,
      }),
    );
    wrap(<CaptureDialog projectId="p1" open onOpenChange={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("tab", { name: "ai:capture.tabs.transcript" }),
    );
    fireEvent.change(await screen.findByLabelText("ai:capture.transcript"), {
      target: { value: "Notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai:capture.analyze" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});
