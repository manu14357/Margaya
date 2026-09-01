type CopyTree = { [key: string]: unknown };

function isTree(value: unknown): value is CopyTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lays a translated `landing` bundle over the English one, key by key, so a
 * locale that hasn't caught up with new copy still renders every string.
 * The English shape always wins: unknown or mistyped translated keys are
 * ignored, and lists keep the English length.
 */
export function mergeLandingCopy<T>(base: T, translated: unknown): T {
  if (isTree(base)) {
    if (!isTree(translated)) return base;
    const merged: CopyTree = {};
    for (const [key, value] of Object.entries(base)) {
      merged[key] = mergeLandingCopy(value, translated[key]);
    }
    return merged as T;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(translated)) return base;
    return base.map((item, index) =>
      mergeLandingCopy(item, translated[index]),
    ) as T;
  }
  if (typeof base === "string") {
    return (
      typeof translated === "string" && translated.trim() ? translated : base
    ) as T;
  }
  return base;
}
