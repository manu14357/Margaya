import { HTTPException } from "hono/http-exception";

// Board settings (B12 K4) and the rules of a settings change (§3.3 P4). Pure.

export const PUBLIC_LAYOUTS = ["board", "list"] as const;
export type PublicLayout = (typeof PUBLIC_LAYOUTS)[number];

export const PUBLICATION_SWITCHES = [
  "commentsEnabled",
  "reactionsEnabled",
  "votesEnabled",
  "requestsEnabled",
  "allowGuests",
  "showAssignees",
  "showBacklog",
] as const;
type Switch = (typeof PUBLICATION_SWITCHES)[number];

export type PublicationSettings = {
  layouts: PublicLayout[];
  defaultLayout: PublicLayout;
} & Record<Switch, boolean>;

export type PublicationSettingsPatch = Partial<PublicationSettings>;

/** A new board: read-only, every participation switch off (K4). */
export const DEFAULT_PUBLICATION_SETTINGS: PublicationSettings = {
  layouts: ["board", "list"],
  defaultLayout: "board",
  commentsEnabled: false,
  reactionsEnabled: false,
  votesEnabled: false,
  requestsEnabled: false,
  allowGuests: false,
  showAssignees: false,
  showBacklog: false,
};

export const SETTINGS_MESSAGES = {
  empty: "Change at least one setting",
  layouts: "Pick at least one layout",
  defaultLayout: "The default layout must be one of the allowed layouts",
  intakeOff: "Turn on Intake for this project first",
} as const;

function sameLayouts(a: readonly string[], b: readonly string[]) {
  return (
    a.length === b.length && a.every((layout, index) => layout === b[index])
  );
}

/**
 * The settings after a change, and the names of the fields that changed.
 * Throws 400 for invalid layouts and 409 for requests without Intake.
 */
export function applySettingsPatch(
  current: PublicationSettings,
  patch: PublicationSettingsPatch,
  { intakeEnabled }: { intakeEnabled: boolean },
): { next: PublicationSettings; changes: string[] } {
  const next: PublicationSettings = {
    ...current,
    layouts: [...current.layouts],
  };

  if (patch.layouts !== undefined) {
    const layouts = patch.layouts;
    if (
      layouts.length === 0 ||
      layouts.length > PUBLIC_LAYOUTS.length ||
      new Set(layouts).size !== layouts.length ||
      layouts.some((layout) => !PUBLIC_LAYOUTS.includes(layout))
    ) {
      throw new HTTPException(400, { message: SETTINGS_MESSAGES.layouts });
    }
    next.layouts = [...layouts];
    if (!next.layouts.includes(next.defaultLayout)) {
      next.defaultLayout = next.layouts[0] as PublicLayout;
    }
  }

  if (patch.defaultLayout !== undefined) {
    if (!next.layouts.includes(patch.defaultLayout)) {
      throw new HTTPException(400, {
        message: SETTINGS_MESSAGES.defaultLayout,
      });
    }
    next.defaultLayout = patch.defaultLayout;
  }

  if (patch.requestsEnabled === true && !intakeEnabled) {
    throw new HTTPException(409, { message: SETTINGS_MESSAGES.intakeOff });
  }
  for (const key of PUBLICATION_SWITCHES) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }

  const changes: string[] = [];
  if (!sameLayouts(current.layouts, next.layouts)) changes.push("layouts");
  if (current.defaultLayout !== next.defaultLayout) {
    changes.push("defaultLayout");
  }
  for (const key of PUBLICATION_SWITCHES) {
    if (current[key] !== next[key]) changes.push(key);
  }
  return { next, changes };
}

/** The settings stored on a publication row. */
export function settingsOf(row: PublicationSettings): PublicationSettings {
  const layouts = (row.layouts ?? []).filter((layout): layout is PublicLayout =>
    PUBLIC_LAYOUTS.includes(layout),
  );
  return {
    layouts:
      layouts.length > 0 ? layouts : [...DEFAULT_PUBLICATION_SETTINGS.layouts],
    defaultLayout: row.defaultLayout,
    commentsEnabled: row.commentsEnabled,
    reactionsEnabled: row.reactionsEnabled,
    votesEnabled: row.votesEnabled,
    requestsEnabled: row.requestsEnabled,
    allowGuests: row.allowGuests,
    showAssignees: row.showAssignees,
    showBacklog: row.showBacklog,
  };
}
