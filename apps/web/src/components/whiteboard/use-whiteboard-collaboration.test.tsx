import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { CONTROL_MESSAGE_TYPE } from "@/components/page/collab/collab-protocol";
import type { CollabProvider } from "@/components/page/collab/use-page-collaboration";
import {
  BOARD_FIRST_SYNC_TIMEOUT_MS,
  useWhiteboardCollaboration,
  whiteboardSocketUrl,
} from "./use-whiteboard-collaboration";

const m = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  content: null as null | {
    elements: unknown[];
    settings: unknown;
    contentVersion: number;
  },
  contentEnabled: [] as boolean[],
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: m.toastError, info: m.toastInfo },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
vi.mock("@/hooks/queries/whiteboard/use-whiteboard-content", () => ({
  useWhiteboardContent: (_id: string, enabled: boolean) => {
    m.contentEnabled.push(enabled);
    return {
      data: enabled ? (m.content ?? undefined) : undefined,
      isLoading: enabled && !m.content,
      isError: false,
    };
  },
}));

type Handler = (...args: unknown[]) => void;

class FakeProvider {
  awareness: Awareness;
  messageHandlers: CollabProvider["messageHandlers"] = [];
  wsconnected = false;
  synced = false;
  connect = vi.fn();
  disconnect = vi.fn();
  destroy = vi.fn();
  private handlers = new Map<string, Set<Handler>>();

  constructor(readonly doc: Y.Doc) {
    this.awareness = new Awareness(doc);
  }

  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  control(payload: Record<string, unknown>) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, CONTROL_MESSAGE_TYPE);
    encoding.writeVarString(encoder, JSON.stringify(payload));
    const decoder = decoding.createDecoder(encoding.toUint8Array(encoder));
    const type = decoding.readVarUint(decoder);
    this.messageHandlers[type]?.(
      encoding.createEncoder(),
      decoder,
      this,
      true,
      type,
    );
  }
}

let provider: FakeProvider | null = null;
const members: Record<string, { name: string; image: string | null }> = {
  ann: { name: "Ann", image: null },
};

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useWhiteboardCollaboration({
        whiteboardId: "wb1",
        user: { id: "me", name: "Me", color: "#3b82f6", image: null },
        getMember: (id) => members[id] ?? null,
        createProvider: (doc, id) => {
          expect(id).toBe("wb1");
          provider = new FakeProvider(doc);
          return provider as unknown as CollabProvider;
        },
      }),
    { wrapper },
  );
  return {
    ...hook,
    invalidate,
    provider: provider as unknown as FakeProvider,
  };
}

beforeEach(() => {
  m.toastError.mockReset();
  m.toastInfo.mockReset();
  m.content = null;
  m.contentEnabled = [];
});

afterEach(() => {
  cleanup();
  provider = null;
  vi.useRealTimers();
});

describe("useWhiteboardCollaboration", () => {
  it("connects to the board room as me, with my name and colour", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    expect(whiteboardSocketUrl()).toBe("ws://localhost:1337/api/ws/whiteboard");
    vi.unstubAllEnvs();
    const { result, provider: fake } = setup();
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.awareness.getLocalState()?.user).toEqual({
      id: "me",
      name: "Me",
      color: "#3b82f6",
      image: null,
    });
    expect(result.current.doc).toBe(fake.doc);
    expect(result.current.awareness).toBe(fake.awareness);
  });

  it("goes offline as soon as the browser loses the network, and reconnects when it is back", () => {
    const { provider: fake } = setup();
    expect(fake.connect).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fake.connect).toHaveBeenCalledTimes(2);
    // A board the room closed for good stays closed.
    act(() => fake.emit("closed", { code: 4404 }));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fake.connect).toHaveBeenCalledTimes(2);
  });

  it("follows the room's write access and refreshes the board header", () => {
    const { result, provider: fake, invalidate } = setup();
    expect(result.current.canWrite).toBe(true);
    act(() =>
      fake.control({
        kind: "state",
        canWrite: false,
        isLocked: true,
        isArchived: false,
        contentVersion: 4,
      }),
    );
    expect(result.current.canWrite).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["whiteboard", "wb1"],
      exact: true,
    });
  });

  it("tracks saves, save errors and offline edits the room refused", () => {
    const { result, provider: fake } = setup();
    act(() => fake.control({ kind: "save-error" }));
    expect(result.current.saveError).toBe(true);
    act(() => fake.control({ kind: "saved", at: "2026-11-14T10:00:00Z" }));
    expect(result.current.saveError).toBe(false);
    expect(result.current.lastSavedAt).toBe(Date.parse("2026-11-14T10:00:00Z"));
    act(() => fake.control({ kind: "offline-rejected", reason: "locked" }));
    expect(m.toastError).toHaveBeenCalledWith(
      "whiteboards:collab.offlineRejected.locked",
    );
  });

  it("ignores malformed control messages", () => {
    const { result, provider: fake } = setup();
    act(() => fake.control({ kind: "nonsense" }));
    expect(result.current.canWrite).toBe(true);
    expect(result.current.saveError).toBe(false);
  });

  it("shows members from awareness, never strangers or myself", () => {
    const { result, provider: fake } = setup();
    const other = new Awareness(fake.doc);
    act(() => {
      fake.awareness.getStates().set(101, {
        user: { id: "ann", name: "Not Ann", color: "#ff0000" },
      });
      fake.awareness.getStates().set(102, { user: { id: "stranger" } });
      fake.awareness.emit("change", [
        { added: [101, 102], updated: [], removed: [] },
        "remote",
      ]);
    });
    other.destroy();
    expect(result.current.presence).toEqual([
      { userId: "ann", name: "Ann", image: null, color: "#ff0000" },
    ]);
  });

  it("records a terminal close and the too-large state", () => {
    const { result, provider: fake } = setup();
    act(() => fake.emit("closed", { code: 4413 }));
    expect(result.current.terminal).toEqual({ code: 4413, kind: "tooLarge" });
    expect(result.current.tooLarge).toBe(true);
  });

  it("falls back to the stored copy, read-only, when the room never syncs", () => {
    vi.useFakeTimers();
    m.content = {
      elements: [
        {
          id: "e1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          version: 1,
          nonce: 1,
          order: "a0",
        },
      ],
      settings: { background: "#ffffff", gridSize: 0 },
      contentVersion: 2,
    };
    const { result, provider: fake, rerender } = setup();
    expect(result.current.fallback).toBe(false);
    act(() => {
      vi.advanceTimersByTime(BOARD_FIRST_SYNC_TIMEOUT_MS);
    });
    rerender();
    expect(result.current.fallback).toBe(true);
    expect(m.contentEnabled.at(-1)).toBe(true);
    expect(result.current.awareness).toBeNull();
    expect(result.current.doc).not.toBe(fake.doc);
    expect(result.current.doc).not.toBeNull();

    // The live room syncs later: back to the live document.
    act(() => fake.emit("sync", true));
    expect(result.current.fallback).toBe(false);
    expect(result.current.doc).toBe(fake.doc);
  });

  it("retries: reconnects and restarts the wait", () => {
    vi.useFakeTimers();
    const { result, provider: fake } = setup();
    act(() => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        fake.emit("connection-close");
      }
    });
    expect(result.current.fallback).toBe(true);
    act(() => result.current.retry());
    expect(result.current.fallback).toBe(false);
    expect(fake.connect).toHaveBeenCalledTimes(2);
  });

  it("tears the room down on unmount", () => {
    const { unmount, provider: fake } = setup();
    unmount();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.awareness.getLocalState()).toBeNull();
  });
});
