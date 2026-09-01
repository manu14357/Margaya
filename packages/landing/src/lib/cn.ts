/** Joins class names, skipping falsy values. No merging: keep classes unique. */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
