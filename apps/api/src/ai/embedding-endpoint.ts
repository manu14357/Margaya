import { lookup } from "node:dns/promises";
import { isDisallowedAddress } from "../utils/assert-public-destination";
import type { AiInstanceConfig } from "./instance-config";
import { type AiDestination, allowedTarget } from "./router";
import type { DataTier } from "./types";
import type { WorkspaceAiPolicy } from "./workspace-settings";

// Where embeddings go (D1). They always use the instance's OpenAI-compatible
// embeddings endpoint (ai.embeddings.*); the fake provider stands in when it
// is the instance provider and no endpoint is set (development and tests).
//
// The Model Router's tiers apply as for chat: an endpoint on the operator's
// own network (every address private, like the local model) counts as
// local, anything else as cloud. Data whose only allowed destination is
// local is never sent to a cloud embeddings endpoint.

export const FAKE_EMBEDDING_MODEL = "fake-embedding";

/** An embeddings endpoint is set up (or the fake provider stands in). */
export function embeddingsConfigured(instance: AiInstanceConfig): boolean {
  if (instance.embeddings.baseUrl && instance.embeddings.model) return true;
  return instance.provider === "fake";
}

const LOCALITY_TTL_MS = 5 * 60 * 1000;
const locality = new Map<string, { local: boolean; at: number }>();

/** Whether every address of the host is private (the operator's network). */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isDisallowedAddress(bare)) return true;
  const cached = locality.get(bare);
  if (cached && Date.now() - cached.at < LOCALITY_TTL_MS) return cached.local;
  let local = false;
  try {
    const addresses = await lookup(bare, { all: true, verbatim: true });
    local =
      addresses.length > 0 &&
      addresses.every((entry) => isDisallowedAddress(entry.address));
  } catch {
    // Unresolvable: treat as cloud; the adapter then refuses it.
    local = false;
  }
  locality.set(bare, { local, at: Date.now() });
  return local;
}

/** The embeddings destination, or null when none is set up. */
export async function resolveEmbeddingDestination(
  instance: AiInstanceConfig,
): Promise<AiDestination | null> {
  const { baseUrl, model, apiKey } = instance.embeddings;
  if (baseUrl && model) {
    let local = false;
    try {
      local = await isPrivateHost(new URL(baseUrl).hostname);
    } catch {
      return null;
    }
    return {
      kind: local ? "local" : "cloud",
      provider: "openai_compatible",
      model,
      apiKey,
      baseUrl,
      allowPrivate: local,
      workspaceKey: false,
    };
  }
  if (instance.provider === "fake") {
    return {
      kind: "cloud",
      provider: "fake",
      model: FAKE_EMBEDDING_MODEL,
      apiKey: "",
      baseUrl: "",
      allowPrivate: false,
      workspaceKey: false,
    };
  }
  return null;
}

export type EmbeddingRoute =
  | { ok: true; redact: boolean }
  | { ok: false; code: "AI_ROUTE_BLOCKED"; message: string };

/** May data of this tier go to the embeddings destination? Pure. */
export function embeddingRoute(input: {
  destination: AiDestination;
  dataTier: DataTier;
  instance: AiInstanceConfig;
  workspace: Pick<WorkspaceAiPolicy, "localOnly" | "redactPii">;
}): EmbeddingRoute {
  const { destination, dataTier, instance, workspace } = input;
  const target = allowedTarget(dataTier, instance, workspace);
  if (target === "blocked") {
    return {
      ok: false,
      code: "AI_ROUTE_BLOCKED",
      message: "Data from restricted projects may not be sent to AI models",
    };
  }
  if (target === "local" && destination.kind !== "local") {
    return {
      ok: false,
      code: "AI_ROUTE_BLOCKED",
      message:
        "This data may only go to a local model, and the embeddings endpoint is not local",
    };
  }
  return {
    ok: true,
    redact:
      destination.kind === "cloud" &&
      (instance.redaction || workspace.redactPii),
  };
}

/** Test hook: forget resolved host localities. */
export function resetEmbeddingLocality(): void {
  locality.clear();
}
