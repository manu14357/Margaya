// Time estimates are stored as whole minutes. People type durations such as
// "90", "1h 30m" or "1.5h"; these helpers turn that into minutes and back.

type UnitLetters = {
  /** The localized hour unit; "h" is always accepted too. */
  hour?: string;
  /** The localized minute unit; "m" is always accepted too. */
  minute?: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitPattern(always: string, localized: string | undefined): string {
  const units = new Set([always]);
  const extra = localized?.trim().toLowerCase();
  if (extra) units.add(extra);
  // Longest first, so "min" wins over "m" when both are accepted.
  return [...units]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

/**
 * Minutes for a typed duration, or null when it isn't one. A bare integer
 * is minutes ("90"); otherwise hours and/or minutes with their unit letters,
 * with or without spaces: "1h", "1.5h", "1h 30m", "1h30m", "45m", "2 h".
 * Fractional hours round to the nearest whole minute.
 */
export function parseDurationInput(
  text: string,
  units: UnitLetters = {},
): number | null {
  const input = text.trim().toLowerCase();
  if (input === "") return null;
  if (/^\d+$/.test(input)) return Number(input);

  const hour = unitPattern("h", units.hour);
  const minute = unitPattern("m", units.minute);
  const pattern = new RegExp(
    `^(?:(\\d+(?:\\.\\d+)?|\\.\\d+)\\s*(?:${hour}))?\\s*(?:(\\d+)\\s*(?:${minute}))?$`,
  );
  const match = pattern.exec(input);
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }

  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const total = Math.round(hours * 60) + minutes;
  return Number.isFinite(total) ? total : null;
}

/** Whole hours and the minutes left over, for display. */
export function durationParts(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const whole = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}
