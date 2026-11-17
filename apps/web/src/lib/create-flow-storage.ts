// Browser-only memory of the create flows: the last template used, unsent
// drafts (30 minutes), the onboarding intent, and the board's "First steps"
// strip. Nothing here reaches the server. Storage can be missing or blocked
// (private windows, blocked site data): reads then return nothing and writes
// are dropped, and every flow still works without restoring.

export const DRAFT_TTL_MS = 30 * 60 * 1000;
/** The strip shows for a person's first projects in a workspace. */
export const FIRST_STEPS_PROJECT_LIMIT = 3;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageKind = "local" | "session";

function storageOf(kind: StorageKind): StorageLike | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(kind: StorageKind, key: string): T | null {
  try {
    const raw = storageOf(kind)?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function write(kind: StorageKind, key: string, value: unknown) {
  try {
    storageOf(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Dropped: the flow keeps working for this visit.
  }
}

function remove(kind: StorageKind, key: string) {
  try {
    storageOf(kind)?.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
}

// ---- Last choice -----------------------------------------------------------

export type LastChoice = {
  categoryId: string | null;
  templateId: string | null;
};

const lastChoiceKey = (userId: string, workspaceId: string) =>
  `margaya:create-flow:last:${userId}:${workspaceId}`;

export function readLastChoice(
  userId: string,
  workspaceId: string,
): LastChoice | null {
  const value = read<Partial<LastChoice>>(
    "local",
    lastChoiceKey(userId, workspaceId),
  );
  if (!value) return null;
  return {
    categoryId: typeof value.categoryId === "string" ? value.categoryId : null,
    templateId: typeof value.templateId === "string" ? value.templateId : null,
  };
}

export function writeLastChoice(
  userId: string,
  workspaceId: string,
  choice: LastChoice,
) {
  write("local", lastChoiceKey(userId, workspaceId), choice);
}

// ---- Drafts ----------------------------------------------------------------

const projectDraftKey = (userId: string, workspaceId: string) =>
  `margaya:create-flow:project-draft:${userId}:${workspaceId}`;
const workspaceDraftKey = (userId: string) =>
  `margaya:create-flow:workspace-draft:${userId}`;

type Stamped<T> = T & { savedAt: number };

function readFresh<T>(key: string, now: number): T | null {
  const value = read<Stamped<T>>("session", key);
  if (!value || typeof value.savedAt !== "number") return null;
  if (now - value.savedAt > DRAFT_TTL_MS) {
    remove("session", key);
    return null;
  }
  return value;
}

export function readProjectDraft<T extends object>(
  userId: string,
  workspaceId: string,
  now = Date.now(),
): T | null {
  return readFresh<T>(projectDraftKey(userId, workspaceId), now);
}

export function writeProjectDraft<T extends object>(
  userId: string,
  workspaceId: string,
  draft: T,
  now = Date.now(),
) {
  write("session", projectDraftKey(userId, workspaceId), {
    ...draft,
    savedAt: now,
  });
}

export function clearProjectDraft(userId: string, workspaceId: string) {
  remove("session", projectDraftKey(userId, workspaceId));
}

export type WorkspaceDraft = {
  name: string;
  description: string;
  intent: string | null;
};

export function readWorkspaceDraft(
  userId: string,
  now = Date.now(),
): WorkspaceDraft | null {
  const value = readFresh<Partial<WorkspaceDraft>>(
    workspaceDraftKey(userId),
    now,
  );
  if (!value) return null;
  return {
    name: typeof value.name === "string" ? value.name : "",
    description: typeof value.description === "string" ? value.description : "",
    intent: typeof value.intent === "string" ? value.intent : null,
  };
}

export function writeWorkspaceDraft(
  userId: string,
  draft: WorkspaceDraft,
  now = Date.now(),
) {
  write("session", workspaceDraftKey(userId), { ...draft, savedAt: now });
}

export function clearWorkspaceDraft(userId: string) {
  remove("session", workspaceDraftKey(userId));
}

// ---- Workspace intent ------------------------------------------------------

const intentKey = (workspaceId: string) =>
  `margaya:create-flow:intent:${workspaceId}`;

/** The gallery category the "What will you track first?" answer maps to. */
export function readWorkspaceIntent(workspaceId: string): string | null {
  const value = read<{ category?: unknown }>("local", intentKey(workspaceId));
  return typeof value?.category === "string" ? value.category : null;
}

export function writeWorkspaceIntent(
  workspaceId: string,
  category: string | null,
) {
  if (category) write("local", intentKey(workspaceId), { category });
  else remove("local", intentKey(workspaceId));
}

// ---- Projects created here -------------------------------------------------

const createdCountKey = (userId: string, workspaceId: string) =>
  `margaya:create-flow:created:${userId}:${workspaceId}`;

/** Counts this person's projects in the workspace; returns the new count. */
export function countCreatedProject(userId: string, workspaceId: string) {
  const value = read<{ count?: unknown }>(
    "local",
    createdCountKey(userId, workspaceId),
  );
  const count = (typeof value?.count === "number" ? value.count : 0) + 1;
  write("local", createdCountKey(userId, workspaceId), { count });
  return count;
}

// ---- First steps on the new board ------------------------------------------

export type FirstStepsItemId =
  | "moveExample"
  | "addTask"
  | "invite"
  | "removeExamples";

export type FirstStepsState = {
  projectName: string;
  sampleTaskCount: number;
  /** This person added the examples, so the API lets them remove them. */
  appliedByMe: boolean;
  /** Labels the server skipped (no label:create). */
  skippedLabels: boolean;
  dismissed: boolean;
  collapsed: boolean;
  done: FirstStepsItemId[];
  /** The examples banner was closed. */
  bannerDismissed: boolean;
};

const firstStepsKey = (projectId: string) =>
  `margaya:create-flow:first-steps:${projectId}`;

export function readFirstSteps(projectId: string): FirstStepsState | null {
  const value = read<Partial<FirstStepsState>>(
    "local",
    firstStepsKey(projectId),
  );
  if (!value) return null;
  return {
    projectName: typeof value.projectName === "string" ? value.projectName : "",
    sampleTaskCount:
      typeof value.sampleTaskCount === "number" ? value.sampleTaskCount : 0,
    appliedByMe: value.appliedByMe === true,
    skippedLabels: value.skippedLabels === true,
    dismissed: value.dismissed === true,
    collapsed: value.collapsed === true,
    done: Array.isArray(value.done)
      ? (value.done.filter(
          (item) => typeof item === "string",
        ) as FirstStepsItemId[])
      : [],
    bannerDismissed: value.bannerDismissed === true,
  };
}

/** Merges the change into the stored state and returns the new state. */
export function writeFirstSteps(
  projectId: string,
  change: Partial<FirstStepsState>,
): FirstStepsState {
  const next: FirstStepsState = {
    projectName: "",
    sampleTaskCount: 0,
    appliedByMe: false,
    skippedLabels: false,
    dismissed: false,
    collapsed: false,
    done: [],
    bannerDismissed: false,
    ...readFirstSteps(projectId),
    ...change,
  };
  write("local", firstStepsKey(projectId), next);
  return next;
}
