import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useTaskReactions from "@/hooks/queries/reaction/use-task-reactions";
import type { TaskReactions } from "@/types/reaction";
import ReactionBar from "./reaction-bar";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/fetchers/reaction/get-task-reactions", () => ({ default: api.get }));
vi.mock("@/fetchers/reaction/add-reaction", () => ({ default: api.add }));
vi.mock("@/fetchers/reaction/remove-reaction", () => ({ default: api.remove }));
vi.mock("@/lib/toast", () => ({
  toast: { error: api.toastError, success: vi.fn() },
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "me", name: "Mina", image: null } }),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "names" in values
        ? `${values.names} reacted with ${values.label}`
        : key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ana = { id: "ana", name: "Ana", image: null };

function reactions(): TaskReactions {
  return {
    task: [
      { emoji: "eyes", count: 1, reacted: false, users: [ana] },
      {
        emoji: "heart",
        count: 1,
        reacted: true,
        users: [{ ...ana, id: "me", name: "Mina" }],
      },
    ],
    comments: [],
  };
}

function Harness() {
  const { data } = useTaskReactions("task-1");
  return (
    <ReactionBar taskId="task-1" groups={data?.task ?? []} showAddButton />
  );
}

function renderBar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ReactionBar", () => {
  it("renders chips in group order with my highlight", async () => {
    api.get.mockResolvedValue(reactions());
    renderBar();

    const chips = await screen.findAllByRole("button", { pressed: true });
    expect(chips).toHaveLength(1);
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(labels.slice(0, 2)).toEqual([
      "activity:reactions.reactWith",
      "activity:reactions.remove",
    ]);
    expect(screen.getByText("👀")).toBeInTheDocument();
  });

  it("toggles optimistically and keeps the change on success", async () => {
    api.get.mockResolvedValueOnce(reactions());
    const request = deferred<unknown>();
    api.add.mockReturnValue(request.promise);
    renderBar();

    const eyes = await screen.findByRole("button", {
      name: "activity:reactions.reactWith",
    });
    fireEvent.click(eyes);

    await waitFor(() => expect(eyes).toHaveAttribute("aria-pressed", "true"));
    expect(eyes).toHaveTextContent("2");
    expect(api.add).toHaveBeenCalledWith(
      { taskId: "task-1", commentId: undefined },
      "eyes",
    );

    // A second click while the request is in flight is ignored.
    fireEvent.click(eyes);
    expect(api.add).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();

    const next = reactions();
    next.task[0] = { ...next.task[0], count: 2, reacted: true };
    api.get.mockResolvedValue(next);
    await act(async () => request.resolve([]));
    await waitFor(() => expect(eyes).toHaveTextContent("2"));
  });

  it("rolls back and toasts when the toggle fails", async () => {
    api.get.mockResolvedValue(reactions());
    const request = deferred<unknown>();
    api.remove.mockReturnValue(request.promise);
    renderBar();

    const heart = await screen.findByRole("button", {
      name: "activity:reactions.remove",
    });
    fireEvent.click(heart);
    await waitFor(() =>
      expect(screen.queryByText("🧡")).not.toBeInTheDocument(),
    );

    await act(async () => request.reject(new Error("boom")));
    expect(await screen.findByText("🧡")).toBeInTheDocument();
    expect(api.toastError).toHaveBeenCalledWith("activity:reactions.error");
  });

  it("marks my reactions in the picker", async () => {
    api.get.mockResolvedValue(reactions());
    renderBar();

    fireEvent.click(
      await screen.findByRole("button", { name: "activity:reactions.add" }),
    );
    const toolbar = await screen.findByRole("toolbar", {
      name: "activity:reactions.picker",
    });
    const pressed = Array.from(
      toolbar.querySelectorAll('[aria-pressed="true"]'),
    ).map((button) => button.getAttribute("aria-label"));
    expect(pressed).toEqual(["activity:reactions.labels.heart"]);
  });
});
