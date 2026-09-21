import { browserTimeZone } from "@/lib/task-query/request";

export { browserTimeZone };

let cachedZones: string[] | null = null;

/** Every IANA zone the browser knows, UTC first. */
export function listTimeZones(): string[] {
  if (cachedZones) return cachedZones;
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  cachedZones = ["UTC", ...zones.filter((zone) => zone !== "UTC")];
  return cachedZones;
}

const offsetCache = new Map<string, string>();

/** "GMT+5:30" style offset of `zone` right now; "" if unknown. */
export function timeZoneOffsetLabel(zone: string): string {
  const cached = offsetCache.get(zone);
  if (cached !== undefined) return cached;
  const label = computeOffsetLabel(zone, new Date());
  offsetCache.set(zone, label);
  return label;
}

function computeOffsetLabel(zone: string, now: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

/** Case-insensitive match on the zone name, its city and its offset. */
export function filterTimeZones(
  zones: readonly string[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!needle) return [...zones];
  return zones.filter(
    (zone) =>
      zone.toLowerCase().includes(needle) ||
      timeZoneOffsetLabel(zone).toLowerCase().includes(needle),
  );
}
