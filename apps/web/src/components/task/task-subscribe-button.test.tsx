import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskSubscription } from "@/types/subscription";
import TaskSubscribeButton, {
  subscriptionDisplay,
} from "./task-subscribe-button";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/fetchers/subscription/get-task-subscription", () => ({
  default: api.get,
}));
vi.mock("@/fetchers/subscription/subscribe-to-task", () => ({
  default: api.subscribe,
}));
vi.mock("@/fetchers/subscription/unsubscribe-from-task", () => ({
  default: api.unsubscribe,
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: api.toastError, success: api.toastSuccess },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function subscription(
  overrides: Partial<TaskSubscription> = {},
): TaskSubscription {
  return {
    taskId: "task-1",
    subscribed: true,
    reason: "creator",
    isAssignee: false,
    isMuted: false,
    subscriberCount: 3,
    ...overrides,
  };
}

describe("subscriptionDisplay", () => {
  it.each([
    [
      { reason: "creator" as const },
      BellRing,
      "tasks:subscription.reasons.creator",
    ],
    [
      { reason: "assignee" as const },
      BellRing,
      "tasks:subscription.reasons.assignee",
    ],
    [
      { reason: "commenter" as const },
      BellRing,
      "tasks:subscription.reasons.commenter",
    ],
    [
      { reason: "mention" as const },
      BellRing,
      "tasks:subscription.reasons.mention",
    ],
    [
      { reason: "manual" as const },
      BellRing,
      "tasks:subscription.reasons.manual",
    ],
    [
      { reason: null, isAssignee: true },
      BellRing,
      "tasks:subscription.reasons.assignee",
    ],
    [
      { subscribed: false, reason: null },
      Bell,
      "tasks:subscription.notSubscribed",
    ],
    [
      { subscribed: false, reason: null, isAssignee: true, isMuted: true },
      BellOff,
      "tasks:subscription.mutedAssignee",
    ],
  ])("%j", (overrides: Partial<TaskSubscription>, icon, tooltipKey) => {
    const display = subscriptionDisplay(subscription(overrides));
    expect(display.icon).toBe(icon);
    expect(display.tooltipKey).toBe(tooltipKey);
    expect(display.labelKey).toBe(
      overrides.subscribed === false
        ? "tasks:subscription.subscribe"
        : "tasks:subscription.unsubscribe",
    );
  });
});

function renderButton() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskSubscribeButton taskId="task-1" />
    </QueryClientProvider>,
  );
}

describe("TaskSubscribeButton", () => {
  it("renders nothing without a task", () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <TaskSubscribeButton taskId={undefined} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("unsubscribes optimistically and toasts", async () => {
    api.get.mockResolvedValue(subscription());
    let resolve!: (value: TaskSubscription) => void;
    api.unsubscribe.mockReturnValue(
      new Promise<TaskSubscription>((res) => {
        resolve = res;
      }),
    );
    renderButton();

    const button = await screen.findByRole("button", {
      name: "tasks:subscription.unsubscribe",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);

    expect(
      await screen.findByRole("button", {
        name: "tasks:subscription.subscribe",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    const unsubscribed = subscription({
      subscribed: false,
      reason: null,
      isMuted: true,
      subscriberCount: 2,
    });
    api.get.mockResolvedValue(unsubscribed);
    await act(async () => resolve(unsubscribed));
    await waitFor(() =>
      expect(api.toastSuccess).toHaveBeenCalledWith(
        "tasks:subscription.toastUnsubscribed",
      ),
    );
  });

  it("rolls back and toasts on failure", async () => {
    api.get.mockResolvedValue(
      subscription({ subscribed: false, reason: null }),
    );
    api.subscribe.mockRejectedValue(new Error("nope"));
    renderButton();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:subscription.subscribe",
      }),
    );

    await waitFor(() =>
      expect(api.toastError).toHaveBeenCalledWith("tasks:subscription.error"),
    );
    expect(
      screen.getByRole("button", { name: "tasks:subscription.subscribe" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
