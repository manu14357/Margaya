import type { ProjectRef } from "./catalog";
import { MAX_DELIVERY_SUMMARY_LENGTH, MAX_WEBHOOK_BODY_BYTES } from "./types";

// The request body (B13a §2.7). It is serialized once per delivery and
// stored, so every attempt sends identical bytes. The actor never carries an
// email.

export const ENVELOPE_VERSION = 1;

export type WorkspaceRef = { id: string; name: string; slug: string };
export type ActorRef = { id: string; name: string };

export type EnvelopeInput = {
  deliveryId: string;
  event: string;
  occurredAt: Date | string;
  webhookId: string;
  workspace: WorkspaceRef;
  project: ProjectRef | null;
  actor: ActorRef | null;
  data: Record<string, unknown>;
  changes: Record<string, unknown> | null;
  redelivery?: boolean;
};

/** `{ id, projectId }` of the data, used when the body is too large. */
export function dataIdentity(
  data: Record<string, unknown>,
  project: ProjectRef | null,
): { id: unknown; projectId: unknown } {
  return {
    id: data.id ?? null,
    projectId: data.projectId ?? project?.id ?? null,
  };
}

function toJson(input: EnvelopeInput, truncated: boolean): string {
  const occurredAt =
    typeof input.occurredAt === "string"
      ? input.occurredAt
      : input.occurredAt.toISOString();
  return JSON.stringify({
    id: input.deliveryId,
    event: input.event,
    version: ENVELOPE_VERSION,
    occurredAt,
    webhookId: input.webhookId,
    workspace: input.workspace,
    project: input.project,
    actor: input.actor,
    data: truncated ? dataIdentity(input.data, input.project) : input.data,
    changes: input.changes,
    ...(truncated ? { dataTruncated: true } : {}),
    ...(input.redelivery ? { redelivery: true } : {}),
  });
}

/**
 * The serialized body. Over 256 KiB, `data` is replaced by its identifiers
 * and `dataTruncated: true` is set.
 */
export function serializeEnvelope(
  input: EnvelopeInput,
  maxBytes: number = MAX_WEBHOOK_BODY_BYTES,
): { body: string; truncated: boolean } {
  const body = toJson(input, false);
  if (Buffer.byteLength(body, "utf8") <= maxBytes) {
    return { body, truncated: false };
  }
  return { body: toJson(input, true), truncated: true };
}

/**
 * A redelivered copy of a stored body: a new envelope id and
 * `redelivery: true`, everything else unchanged.
 */
export function redeliveryBody(storedBody: string, deliveryId: string): string {
  const parsed = JSON.parse(storedBody) as Record<string, unknown>;
  const { id: _id, redelivery: _redelivery, ...rest } = parsed;
  return JSON.stringify({ id: deliveryId, ...rest, redelivery: true });
}

/** Id-only data for a page or view that just became private (P1, P2). */
export function privateData(
  id: string | null,
  projectId: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, projectId, access: "private", ...extra };
}

function clip(text: string): string {
  return text.length > MAX_DELIVERY_SUMMARY_LENGTH
    ? `${text.slice(0, MAX_DELIVERY_SUMMARY_LENGTH - 1)}…`
    : text;
}

/**
 * The delivery log's one-line summary: "WEB-12 · Fix login" for tasks, the
 * entity's name or title, or "{event} {entityId}".
 */
export function deliverySummary(
  event: string,
  entityId: string | null,
  data: Record<string, unknown>,
): string {
  // Intake items nest their task.
  const source =
    typeof data.task === "object" && data.task !== null && !("key" in data)
      ? (data.task as Record<string, unknown>)
      : data;
  const text = (key: string) =>
    typeof source[key] === "string" && (source[key] as string).length > 0
      ? (source[key] as string)
      : null;
  const key = text("key") ?? text("taskKey");
  const title = text("title") ?? text("name");
  if (key && title) return clip(`${key} · ${title}`);
  if (key) return clip(key);
  if (title) return clip(title);
  return clip(entityId ? `${event} ${entityId}` : event);
}
