import { z } from "zod";

// The A2A 1.0 wire vocabulary Margaya speaks (JSON-RPC binding, ProtoJSON
// field names and enum strings). Pure: no database, no HTTP.

export const A2A_PROTOCOL_VERSION = "1.0";

export const A2A_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  versionNotSupported: -32009,
} as const;

export class A2aError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "A2aError";
  }
}

export const TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

const TERMINAL: readonly TaskState[] = [
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL.includes(state);
}

export const SKILLS = [
  "create_task",
  "triage_request",
  "ask_workspace",
  "run_agent",
] as const;

export type Skill = (typeof SKILLS)[number];

/** An intake request's status as an A2A task state. */
export function intakeState(status: string): TaskState {
  switch (status) {
    case "accepted":
    case "duplicate":
      // The work is tracked: as a new task, or as the one it duplicates.
      return "TASK_STATE_COMPLETED";
    case "declined":
      return "TASK_STATE_REJECTED";
    default:
      // pending and snoozed wait for someone to triage them.
      return "TASK_STATE_SUBMITTED";
  }
}

/** An agent run's status as an A2A task state. */
export function runState(status: string): TaskState {
  switch (status) {
    case "queued":
      return "TASK_STATE_SUBMITTED";
    case "succeeded":
      return "TASK_STATE_COMPLETED";
    case "failed":
      return "TASK_STATE_FAILED";
    case "cancelled":
      return "TASK_STATE_CANCELED";
    default:
      // running, and awaiting_approval: a person in Margaya decides, not
      // the calling agent, so this is not input-required.
      return "TASK_STATE_WORKING";
  }
}

// A2A clients send ProtoJSON enum names; lower-case names are accepted too.
const role = z
  .string()
  .transform((value) => value.toUpperCase().replace(/^(?!ROLE_)/, "ROLE_"))
  .pipe(z.enum(["ROLE_USER", "ROLE_AGENT"]));

const partSchema = z.looseObject({
  text: z.string().max(20_000).optional(),
  data: z.unknown().optional(),
  url: z.string().max(4_096).optional(),
  raw: z.string().optional(),
  mediaType: z.string().max(255).optional(),
  filename: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Part = z.infer<typeof partSchema>;

export const messageSchema = z.looseObject({
  messageId: z.string().min(1).max(256),
  contextId: z.string().min(1).max(256).optional(),
  taskId: z.string().min(1).max(256).optional(),
  role,
  parts: z.array(partSchema).min(1).max(20),
  metadata: z.record(z.string(), z.unknown()).optional(),
  referenceTaskIds: z.array(z.string()).max(20).optional(),
});

export type A2aMessage = z.infer<typeof messageSchema>;

const tenant = z.string().min(1).max(128).optional();

export const sendMessageParams = z.looseObject({
  tenant,
  message: messageSchema,
  configuration: z
    .looseObject({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().min(0).optional(),
      returnImmediately: z.boolean().optional(),
      taskPushNotificationConfig: z.unknown().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SendMessageParams = z.infer<typeof sendMessageParams>;

export const taskIdParams = z.looseObject({
  tenant,
  id: z.string().min(1).max(128),
  historyLength: z.number().int().min(0).optional(),
});

export const listTasksParams = z.looseObject({
  tenant,
  contextId: z.string().min(1).max(256).optional(),
  status: z.enum(TASK_STATES).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().max(512).optional(),
  historyLength: z.number().int().min(0).optional(),
  statusTimestampAfter: z.iso.datetime({ offset: true }).optional(),
  includeArtifacts: z.boolean().optional(),
});

export type ListTasksParams = z.infer<typeof listTasksParams>;

export const tenantParams = z.looseObject({ tenant });

export const jsonRpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
});

export function parseParams<T extends z.ZodType>(
  schema: T,
  params: unknown,
): z.output<T> {
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      z.prettifyError(parsed.error).slice(0, 500),
    );
  }
  return parsed.data;
}

export type SkillInput = {
  skill: Skill;
  text: string;
  data: Record<string, unknown>;
};

/**
 * What a message asks for: the skill (a data part's or the metadata's
 * `skill`, else triage_request), its text parts joined, and the fields of
 * its data parts. File parts are refused rather than silently dropped.
 */
export function skillInput(
  message: A2aMessage,
  requestMetadata?: Record<string, unknown>,
): SkillInput {
  const texts: string[] = [];
  const data: Record<string, unknown> = {};
  for (const part of message.parts) {
    if (typeof part.text === "string") {
      texts.push(part.text);
    } else if (
      part.data !== null &&
      typeof part.data === "object" &&
      !Array.isArray(part.data)
    ) {
      Object.assign(data, part.data);
    } else if (part.url !== undefined || part.raw !== undefined) {
      throw new A2aError(
        A2A_ERRORS.contentTypeNotSupported,
        "Margaya accepts text and JSON data parts, not files",
      );
    }
  }
  const named = data.skill ?? message.metadata?.skill ?? requestMetadata?.skill;
  const skill = named === undefined ? "triage_request" : named;
  if (
    typeof skill !== "string" ||
    !(SKILLS as readonly string[]).includes(skill)
  ) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      `Unknown skill; use one of ${SKILLS.join(", ")}`,
    );
  }
  return { skill: skill as Skill, text: texts.join("\n\n").trim(), data };
}

/** A title and description from free text: the first line is the title. */
export function splitTitle(text: string): {
  title: string;
  description: string;
} {
  const [first = "", ...rest] = text.split(/\r?\n/);
  const title = first.trim().slice(0, 200);
  return { title, description: rest.join("\n").trim() };
}

export function agentMessage(
  text: string,
  ids: { taskId: string; contextId: string },
) {
  return {
    messageId: `${ids.taskId}:status`,
    role: "ROLE_AGENT" as const,
    taskId: ids.taskId,
    contextId: ids.contextId,
    parts: [{ text }],
  };
}

export type A2aArtifact = {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Array<Record<string, unknown>>;
};

export type A2aTask = {
  id: string;
  contextId: string;
  status: {
    state: TaskState;
    message?: ReturnType<typeof agentMessage>;
    timestamp: string;
  };
  artifacts?: A2aArtifact[];
  metadata: Record<string, unknown>;
};

/** Page tokens: the last row's creation instant and id. */
export function encodePageToken(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString(
    "base64url",
  );
}

export function decodePageToken(
  token: string,
): { createdAt: Date; id: string } | null {
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      !Number.isNaN(Date.parse(value[0]))
    ) {
      return { createdAt: new Date(value[0]), id: value[1] };
    }
  } catch {
    // Invalid token.
  }
  return null;
}

/**
 * Whether a request's A2A-Version is one Margaya serves. A missing header
 * means 0.3 to the spec; a 1.0 method name settles it, since 0.3 named its
 * methods like message/send.
 */
export function versionSupported(
  header: string | undefined,
  method: string,
): boolean {
  const value = header?.trim();
  if (!value) return !method.includes("/");
  return /^1\.0(\.\d+)?$/.test(value);
}
