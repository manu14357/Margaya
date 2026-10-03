import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { CONTROL_MESSAGE_TYPE } from "./collab-protocol";
import {
  type CollabProvider,
  FIRST_SYNC_TIMEOUT_MS,
  usePageCollaboration,
} from "./use-page-collaboration";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
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

  /** Delivers a type-100 control frame through the registered handler. */
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

function setup(userId = "me") {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      usePageCollaboration({
        pageId: "page_1",
        userId,
        resolveName: (id) => (id === "ann" ? "Ann" : null),
        createProvider: (doc) => {
          provider = new FakeProvider(doc);
          return provider as unknown as CollabProvider;
        },
      }),
    { wrapper },
  );
  return {
    ...hook,
    queryClient,
    provider: provider as unknown as FakeProvider,
  };
}

beforeEach(() => {
  toastMock.error.mockReset();
  toastMock.info.mockReset();
});

afterEach(() => {
  provider = null;
  vi.useRealTimers();
});

describe("usePageCollaboration", () => {
  it("connects with the palette color as the only user fields", () => {
    const { provider: fake } = setup();
    expect(fake.connect).toHaveBeenCalledTimes(1);
    const user = fake.awareness.getLocalState()?.user as Record<
      string,
      unknown
    >;
    expect(Object.keys(user).sort()).toEqual(["color", "id"]);
    expect(user.id).toBe("me");
  });

  it("follows the server's state control for canWrite", () => {
    const { result, provider: fake } = setup();
    expect(result.current.canWrite).toBe(true);
    act(() =>
      fake.control({
        kind: "state",
        canWrite: false,
        isLocked: true,
        isArchived: false,
        access: "public",
        projectId: "p1",
        contentVersion: 2,
      }),
    );
    expect(result.current.canWrite).toBe(false);
  });

  it("tracks saved and save-error", () => {
    const { result, provider: fake } = setup();
    act(() => fake.control({ kind: "save-error" }));
    expect(result.current.saveError).toBe(true);
    act(() =>
      fake.control({
        kind: "saved",
        at: "2026-10-06T10:00:00.000Z",
        contentVersion: 3,
      }),
    );
    expect(result.current.saveError).toBe(false);
    expect(result.current.lastSavedAt).toBe(
      Date.parse("2026-10-06T10:00:00.000Z"),
    );
  });

  it("shows the offline-rejected toast and clears pending edits", () => {
    const { result, provider: fake } = setup();
    act(() => fake.doc.getText("t").insert(0, "offline"));
    expect(result.current.pendingOffline).toBe(true);
    act(() => fake.control({ kind: "offline-rejected", reason: "locked" }));
    expect(toastMock.error).toHaveBeenCalledWith(
      "pages:collab.offlineRejected.locked",
    );
    expect(result.current.pendingOffline).toBe(false);
  });

  it("names whoever restored a version, but not the restorer", () => {
    const { provider: fake } = setup();
    act(() =>
      fake.control({ kind: "restored", versionId: "v1", actorId: "ann" }),
    );
    expect(toastMock.info).toHaveBeenCalledWith("pages:collab.restoredBy:Ann");
    toastMock.info.mockReset();
    act(() =>
      fake.control({ kind: "restored", versionId: "v1", actorId: "me" }),
    );
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it.each([
    [4401, "signedOut"],
    [4403, "notVisible"],
    [4404, "gone"],
    [4413, "tooLarge"],
    [4429, "roomFull"],
    [1009, "tooLarge"],
    [1008, "protocol"],
  ])("maps close code %i to %s", (code, kind) => {
    const { result, provider: fake } = setup();
    act(() => fake.emit("closed", { code, reason: "" }));
    expect(result.current.terminal).toEqual({ code, kind });
    expect(result.current.tooLarge).toBe(kind === "tooLarge");
  });

  it("asks before unload while offline edits are unsynced", () => {
    const { result, provider: fake } = setup();
    act(() => fake.doc.getText("t").insert(0, "x"));
    expect(result.current.pendingOffline).toBe(true);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    act(() => fake.emit("sync", true));
    expect(result.current.pendingOffline).toBe(false);
    const later = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("does not count updates from the server as offline edits", () => {
    const { result, provider: fake } = setup();
    act(() => {
      fake.doc.transact(() => fake.doc.getText("t").insert(0, "x"), fake);
    });
    expect(result.current.pendingOffline).toBe(false);
  });

  it("falls back to the stored copy after 5 s without a first sync", () => {
    vi.useFakeTimers();
    const { result, provider: fake } = setup();
    expect(result.current.fallback).toBe(false);
    act(() => vi.advanceTimersByTime(FIRST_SYNC_TIMEOUT_MS));
    expect(result.current.fallback).toBe(true);
    act(() => fake.emit("sync", true));
    expect(result.current.fallback).toBe(false);
    expect(result.current.hasSynced).toBe(true);
  });

  it("falls back after five failed connection attempts", () => {
    const { result, provider: fake } = setup();
    act(() => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        fake.emit("connection-close", null);
      }
    });
    expect(result.current.fallback).toBe(true);
  });

  it("lists other members on the page from awareness", () => {
    const { result, provider: fake } = setup();
    const remote = new Awareness(fake.doc);
    act(() => {
      fake.awareness.states.set(999, { user: { id: "ann", color: "rose" } });
      fake.awareness.states.set(998, { user: { id: "ghost", color: "teal" } });
      fake.awareness.emit("change", [
        { added: [999, 998], updated: [], removed: [] },
        "remote",
      ]);
    });
    remote.destroy();
    expect(result.current.presence).toEqual([{ userId: "ann", color: "rose" }]);
  });

  it("clears its awareness and destroys the provider on unmount", () => {
    const { unmount, provider: fake } = setup();
    unmount();
    expect(fake.awareness.getLocalState()).toBeNull();
    expect(fake.destroy).toHaveBeenCalled();
  });
});
